import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeAudio, matchVideoToTrack } from './audioAnalysis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const DISCOGS_TOKEN = process.env.DISCOGS_TOKEN;

// Return server-side config availability (no secrets exposed)
app.get('/api/config', (_req, res) => {
  res.json({
    hasDiscogsToken: !!DISCOGS_TOKEN,
    discogsUsername: process.env.DISCOGS_USERNAME || ''
  });
});

// Search records via Discogs API
app.post('/api/search', async (req, res) => {
  const { query, token, filters = {}, perPage = 10 } = req.body;
  if (!query) return res.status(400).json({ error: 'Query required' });

  const authToken = token || DISCOGS_TOKEN;
  if (!authToken) return res.status(400).json({ error: 'Discogs token required. Add it to .env or enter it in the Discogs tab.' });

  try {
    const params = new URLSearchParams({
      q: query,
      type: 'release',
      format: 'vinyl',
      per_page: Math.min(Math.max(parseInt(perPage) || 10, 1), 25)
    });
    if (filters.label)   params.set('label',   filters.label);
    if (filters.country) params.set('country',  filters.country);
    if (filters.year)    params.set('year',     filters.year);
    if (filters.genre)   params.set('genre',    filters.genre);

    const searchUrl = `https://api.discogs.com/database/search?${params}`;
    const searchRes = await fetch(searchUrl, {
      headers: {
        'Authorization': `Discogs token=${authToken}`,
        'User-Agent': 'VinylManager/1.0'
      }
    });

    if (!searchRes.ok) {
      const err = await searchRes.json();
      return res.status(searchRes.status).json({ error: err.message || 'Discogs search failed' });
    }

    const searchData = await searchRes.json();
    const releases = searchData.results || [];

    if (!releases.length) return res.json([]);

    // Fetch full release details (including tracklist) for each result
    const results = await Promise.all(
      releases.map(async (release) => {
        try {
          const detailRes = await fetch(`https://api.discogs.com/releases/${release.id}`, {
            headers: {
              'Authorization': `Discogs token=${authToken}`,
              'User-Agent': 'VinylManager/1.0'
            }
          });
          const detail = await detailRes.json();

          const tracks = (detail.tracklist || [])
            .filter(t => t.type_ === 'track')
            .map(t => ({
              title: t.title,
              artist: t.artists ? t.artists.map(a => a.name).join(', ').replace(/\s*\(\d+\)/g, '') : '',
              duration: t.duration || '',
              position: t.position || '',
              bpm: '',
              key: ''
            }));

          const artistName = (detail.artists || release.title?.split(' - ') || [])
            .map(a => a.name || a)
            .join(', ')
            .replace(/\s*\(\d+\)$/, ''); // strip Discogs disambiguation numbers

          const album = detail.title || release.title || '';
          const year = detail.year || release.year || '';
          const genres = (detail.genres || release.genre || []).join(', ');
          const styles = (detail.styles || release.style || []).join(', ');
          const label = (detail.labels || []).map(l => l.name).join(', ') || '';
          const discogsUrl = `https://www.discogs.com/release/${release.id}`;
          const thumb = release.thumb || '';

          return {
            artist: artistName,
            album,
            year,
            genre: styles || genres,
            label,
            tracks,
            discogsId: release.id,
            discogsUrl,
            thumb,
            videos: (detail.videos || []).map(v => ({ uri: v.uri, title: v.title || '' }))
          };
        } catch {
          // If detail fetch fails, return basic info with no tracks
          return {
            artist: release.title?.split(' - ')[0] || '',
            album: release.title?.split(' - ').slice(1).join(' - ') || release.title || '',
            year: release.year || '',
            genre: (release.genre || []).join(', '),
            label: '',
            tracks: [],
            discogsId: release.id,
            discogsUrl: `https://www.discogs.com/release/${release.id}`,
            thumb: release.thumb || ''
          };
        }
      })
    );

    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Spotify helpers ──────────────────────────────────────
let _spotifyToken = null;
let _spotifyTokenExpiry = 0;

async function getSpotifyToken() {
  if (_spotifyToken && Date.now() < _spotifyTokenExpiry) return _spotifyToken;
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  const creds = Buffer.from(`${id}:${secret}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  if (!res.ok) return null;
  const data = await res.json();
  _spotifyToken = data.access_token;
  _spotifyTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return _spotifyToken;
}

const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');

async function spotifyAudioFeatures(trackIds, token) {
  const featRes = await fetch(`https://api.spotify.com/v1/audio-features?ids=${trackIds.join(',')}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!featRes.ok) return [];
  return (await featRes.json()).audio_features || [];
}

async function enrichWithSpotify(artist, album, tracks, token) {
  // ── Try album search first (most efficient: 3 total API calls) ──
  const albumRes = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(`album:${album} artist:${artist}`)}&type=album&limit=1`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const albumData = albumRes.ok ? await albumRes.json() : null;
  const spotifyAlbum = albumData?.albums?.items?.[0];

  if (spotifyAlbum) {
    const tracksRes = await fetch(`https://api.spotify.com/v1/albums/${spotifyAlbum.id}/tracks?limit=50`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (tracksRes.ok) {
      const spotifyTracks = (await tracksRes.json()).items || [];
      const features = await spotifyAudioFeatures(spotifyTracks.map(t => t.id), token);
      const featureMap = {};
      spotifyTracks.forEach((t, i) => { featureMap[norm(t.name)] = features[i]; });

      const mapped = tracks.map(track => {
        const feat = featureMap[norm(track.title)];
        if (!feat || feat.key === undefined) return null;
        return {
          title: track.title,
          bpm: Math.round(feat.tempo),
          key: feat.key >= 0 ? `${PITCH_CLASSES[feat.key]} ${feat.mode === 1 ? 'major' : 'minor'}` : ''
        };
      });
      // Return if we enriched at least one track
      if (mapped.some(r => r)) return mapped;
    }
  }

  // ── Fallback: search each track individually (handles singles/EPs) ──
  return await Promise.all(tracks.map(async track => {
    // Use track-level artist from Discogs if available, otherwise fall back to release artist
    const trackArtist = track.artist || artist;
    // Try progressively looser queries until something is found
    const queries = [
      `track:${track.title} artist:${trackArtist}`,
      `${track.title} ${trackArtist}`,
      track.title  // title only — catches releases where Spotify artist/album name differs from Discogs
    ];
    let spotifyTrack = null;
    for (const q of queries) {
      const res = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=1`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) continue;
      spotifyTrack = (await res.json()).tracks?.items?.[0];
      if (spotifyTrack) break;
    }
    if (!spotifyTrack) return null;

    const [feat] = await spotifyAudioFeatures([spotifyTrack.id], token);
    if (!feat || feat.key === undefined) return null;
    return {
      title: track.title,
      bpm: Math.round(feat.tempo),
      key: feat.key >= 0 ? `${PITCH_CLASSES[feat.key]} ${feat.mode === 1 ? 'major' : 'minor'}` : ''
    };
  }));
}

// ── Camelot wheel conversion ──────────────────────────────
const CAMELOT_MAP = {
  'C major': '8B',  'C minor': '5A',
  'C# major': '3B', 'C# minor': '12A',
  'Db major': '3B', 'Db minor': '12A',
  'D major': '10B', 'D minor': '7A',
  'D# major': '5B', 'D# minor': '2A',
  'Eb major': '5B', 'Eb minor': '2A',
  'Ab major': '4B', 'Ab minor': '1A',
  'E major': '12B', 'E minor': '9A',
  'F major': '7B',  'F minor': '4A',
  'F# major': '2B', 'F# minor': '11A',
  'Gb major': '2B', 'Gb minor': '11A',
  'G major': '9B',  'G minor': '6A',
  'G# major': '4B', 'G# minor': '1A',
  'A major': '11B', 'A minor': '8A',
  'A# major': '6B', 'A# minor': '3A',
  'Bb major': '6B', 'Bb minor': '3A',
  'B major': '1B',  'B minor': '10A',
};

function toCamelot(keyName) {
  if (!keyName) return '';
  const normalised = keyName.trim()
    .replace(/\bmaj(or)?\b/i, 'major')
    .replace(/\bmin(or)?\b/i, 'minor');
  for (const [k, v] of Object.entries(CAMELOT_MAP)) {
    if (k.toLowerCase() === normalised.toLowerCase()) return `${v} - ${keyName.trim()}`;
  }
  return keyName; // already Camelot or unrecognised — pass through
}

// ── Beatport scraper ──────────────────────────────────────
const BEATPORT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'DNT': '1'
};

// Recursively find the first array whose items have a numeric `bpm` field
function findTrackArray(obj, depth = 0) {
  if (depth > 12 || !obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    if (obj.length > 0 && typeof obj[0]?.bpm === 'number') return obj;
    for (const item of obj) {
      const found = findTrackArray(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const val of Object.values(obj)) {
    const found = findTrackArray(val, depth + 1);
    if (found) return found;
  }
  return null;
}

function extractBeatportKey(track) {
  // Beatport stores key as key_name (e.g. "D Major") and key_id (numeric)
  if (track.key_name) return track.key_name;
  // Fallback: legacy object form
  const k = track.key;
  if (!k) return '';
  if (typeof k === 'object') return k.name || k.shortname || k.camelot_value || '';
  return String(k);
}

async function enrichWithBeatport(artist, title) {
  const q = encodeURIComponent(`${artist} ${title}`);
  const url = `https://www.beatport.com/search/tracks?q=${q}`;

  let html;
  try {
    const res = await fetch(url, { headers: BEATPORT_HEADERS });
    if (!res.ok) { console.warn(`[Beatport] HTTP ${res.status} for "${title}"`); return null; }
    html = await res.text();
  } catch (e) {
    console.warn(`[Beatport] fetch error for "${title}":`, e.message);
    return null;
  }

  const scriptMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!scriptMatch) { console.warn(`[Beatport] no __NEXT_DATA__ for "${title}"`); return null; }

  let data;
  try { data = JSON.parse(scriptMatch[1]); }
  catch (e) { console.warn(`[Beatport] JSON parse error: ${e.message}`); return null; }

  const tracks = findTrackArray(data);
  if (!tracks?.length) { console.warn(`[Beatport] no tracks in response for "${title}"`); return null; }

  // Find best-matching track by normalized title + artist
  const titleNorm = norm(title);
  const artistNorm = norm(artist);
  const match = tracks.find(t => {
    const tName = norm(t.track_name || t.name || t.title || '');
    const tArtists = (t.artists || []).map(a => norm(a.name || a.artist_name || '')).join(' ');
    return tName === titleNorm || (tName.includes(titleNorm) && tArtists.includes(artistNorm));
  }) || tracks.find(t => norm(t.track_name || t.name || t.title || '').includes(titleNorm))
    || tracks[0]; // best-effort first result

  if (!match) return null;

  const bpm = match.bpm ? Math.round(match.bpm) : null;
  const key = extractBeatportKey(match);
  console.log(`[Beatport] "${title}" → ${bpm} BPM, ${key}`);
  if (!bpm && !key) return null;

  return { bpm, key };
}

// ── MusicBrainz helpers ───────────────────────────────────
async function enrichWithMusicBrainz(artist, title) {
  const query = `recording:"${title.replace(/"/g, '')}" AND artist:"${artist.replace(/"/g, '')}"`;
  const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(query)}&fmt=json&inc=tags&limit=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'VinylManager/1.0 (vinyl@manager.local)' }
  });
  if (!res.ok) return null;
  const data = await res.json();
  const recording = data.recordings?.[0];
  if (!recording) return null;

  // BPM and key are stored as community-submitted tags on MusicBrainz
  const tags = recording.tags || [];
  let bpm = null, key = null;
  for (const tag of tags) {
    const name = tag.name.toLowerCase().trim();
    const bpmMatch = name.match(/^(\d{2,3})\s*bpm$/) || name.match(/^bpm[:\s]+(\d{2,3})$/);
    if (bpmMatch) bpm = parseInt(bpmMatch[1]);
    if (/^[a-g][#b]?\s*(major|minor|maj|min)$/i.test(name)) key = tag.name;
  }
  return (bpm || key) ? { bpm, key } : null;
}

// Enrich tracks: Beatport first, YouTube audio analysis as fallback
app.post('/api/enrich', async (req, res) => {
  const { artist, album, tracks, videos } = req.body;
  if (!artist || !album || !tracks?.length) return res.status(400).json({ error: 'artist, album, and tracks required' });

  const results = tracks.map(t => ({ title: t.title, bpm: '', key: '' }));

  await Promise.all(tracks.map(async (track, i) => {
    const trackArtist = track.artist || artist;

    // ── 1. Beatport (human-verified BPM + key) ──
    try {
      const bp = await enrichWithBeatport(trackArtist, track.title);
      if (bp?.bpm || bp?.key) {
        results[i].bpm = bp.bpm || '';
        results[i].key = toCamelot(bp.key);
        return; // done — skip audio analysis
      }
    } catch (e) {
      console.warn(`[Beatport] error for "${track.title}":`, e.message);
    }

    // ── 2. YouTube audio analysis fallback ──
    if (!videos?.length) return;
    const url = matchVideoToTrack(track.title, videos);
    if (!url) {
      console.log(`[YouTube] ${track.title} → no matching video`);
      return;
    }
    console.log(`[YouTube] ${track.title} → ${url}`);
    try {
      const { bpm, key } = await analyzeAudio(url);
      results[i].bpm = bpm;
      results[i].key = toCamelot(key);
      console.log(`[YouTube] ${track.title} → ${bpm} BPM, ${toCamelot(key)}`);
    } catch (e) {
      console.warn(`[YouTube] ${track.title} analysis failed:`, e.message);
    }
  }));

  res.json({ tracks: results });
});

// Verify Discogs credentials and return user profile
app.post('/api/discogs/verify', async (req, res) => {
  const { username, token } = req.body;
  const authToken = token || DISCOGS_TOKEN;
  if (!authToken || !username) return res.status(400).json({ error: 'Username and token required' });
  try {
    const r = await fetch(`https://api.discogs.com/users/${encodeURIComponent(username)}`, {
      headers: { 'Authorization': `Discogs token=${authToken}`, 'User-Agent': 'VinylManager/1.0' }
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return res.status(r.status).json({ error: err.message || 'Invalid credentials' });
    }
    const d = await r.json();
    res.json({
      username: d.username,
      name: d.name || d.username,
      avatar_url: d.avatar_url || '',
      num_collection: d.num_collection || 0,
      num_wantlist: d.num_wantlist || 0
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Fetch paginated wantlist
app.get('/api/discogs/wantlist', async (req, res) => {
  const { username, token, page = 1, perPage = 25 } = req.query;
  const authToken = token || DISCOGS_TOKEN;
  if (!authToken || !username) return res.status(400).json({ error: 'Username and token required' });
  try {
    const r = await fetch(
      `https://api.discogs.com/users/${encodeURIComponent(username)}/wants?page=${page}&per_page=${perPage}&sort=added&sort_order=desc`,
      { headers: { 'Authorization': `Discogs token=${authToken}`, 'User-Agent': 'VinylManager/1.0' } }
    );
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return res.status(r.status).json({ error: err.message || 'Failed to fetch wantlist' });
    }
    const data = await r.json();
    res.json({
      items: (data.wants || []).map(w => {
        const info = w.basic_information;
        return {
          discogsId: info.id,
          artist: (info.artists || []).map(a => a.name).join(', ').replace(/\s*\(\d+\)/g, ''),
          album: info.title,
          year: info.year || '',
          genre: (info.genres || []).join(', '),
          styles: (info.styles || []).join(', '),
          label: (info.labels || []).map(l => l.name).join(', '),
          thumb: info.thumb || info.cover_image || '',
          formats: (info.formats || []).map(f => f.name).join(', '),
          discogsUrl: `https://www.discogs.com/release/${info.id}`
        };
      }),
      pagination: {
        page: data.pagination?.page || 1,
        pages: data.pagination?.pages || 1,
        items: data.pagination?.items || 0,
        perPage: data.pagination?.per_page || 25
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Fetch full release details (tracklist + videos) for wantlist add
app.get('/api/discogs/release/:id', async (req, res) => {
  const { id } = req.params;
  const { token } = req.query;
  const authToken = token || DISCOGS_TOKEN;
  if (!authToken) return res.status(400).json({ error: 'Token required' });
  try {
    const r = await fetch(`https://api.discogs.com/releases/${id}`, {
      headers: { 'Authorization': `Discogs token=${authToken}`, 'User-Agent': 'VinylManager/1.0' }
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return res.status(r.status).json({ error: err.message || 'Failed to fetch release' });
    }
    const detail = await r.json();
    res.json({
      tracks: (detail.tracklist || [])
        .filter(t => t.type_ === 'track')
        .map(t => ({
          title: t.title,
          artist: t.artists ? t.artists.map(a => a.name).join(', ').replace(/\s*\(\d+\)/g, '') : '',
          duration: t.duration || '',
          position: t.position || '',
          bpm: '',
          key: ''
        })),
      videos: (detail.videos || []).map(v => ({ uri: v.uri, title: v.title || '' }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Export to Discogs wantlist or collection
app.post('/api/discogs/export', async (req, res) => {
  const { collection, username, token, mode } = req.body;
  const authToken = token || DISCOGS_TOKEN;
  if (!authToken) return res.status(400).json({ error: 'Discogs token required' });
  if (!username) return res.status(400).json({ error: 'Discogs username required' });

  const results = [];
  const albums = [...new Map(collection.map(t => [t.artist + t.album, t])).values()];

  for (const item of albums) {
    try {
      let releaseId = item.discogsId;

      // If we don't already have a Discogs ID, search for it
      if (!releaseId) {
        const searchRes = await fetch(
          `https://api.discogs.com/database/search?artist=${encodeURIComponent(item.artist)}&release_title=${encodeURIComponent(item.album)}&format=vinyl&per_page=1`,
          { headers: { 'Authorization': `Discogs token=${authToken}`, 'User-Agent': 'VinylManager/1.0' } }
        );
        const searchData = await searchRes.json();
        releaseId = searchData.results?.[0]?.id;
      }

      if (releaseId) {
        let exportRes;
        if (mode === 'collection') {
          exportRes = await fetch(
            `https://api.discogs.com/users/${username}/collection/folders/1/releases/${releaseId}`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Discogs token=${authToken}`,
                'User-Agent': 'VinylManager/1.0',
                'Content-Type': 'application/json'
              }
            }
          );
        } else {
          exportRes = await fetch(
            `https://api.discogs.com/users/${username}/wants/${releaseId}`,
            {
              method: 'PUT',
              headers: {
                'Authorization': `Discogs token=${authToken}`,
                'User-Agent': 'VinylManager/1.0',
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ notes: 'Added via Vinyl Manager' })
            }
          );
        }
        results.push({
          album: `${item.artist} - ${item.album}`,
          status: exportRes.ok ? 'added' : 'failed',
          discogsId: releaseId
        });
      } else {
        results.push({ album: `${item.artist} - ${item.album}`, status: 'not_found' });
      }

      await new Promise(r => setTimeout(r, 1000)); // Discogs rate limit
    } catch (e) {
      results.push({ album: `${item.artist} - ${item.album}`, status: 'error', error: e.message });
    }
  }

  res.json({ results });
});

app.listen(PORT, () => console.log(`\n Project Posterity running at http://localhost:${PORT}\n`));