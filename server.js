import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';

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
  const { query, token } = req.body;
  if (!query) return res.status(400).json({ error: 'Query required' });

  const authToken = token || DISCOGS_TOKEN;
  if (!authToken) return res.status(400).json({ error: 'Discogs token required. Add it to .env or enter it in the Discogs tab.' });

  try {
    // Search Discogs for releases matching the query
    const searchUrl = `https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&format=vinyl&per_page=4`;
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
            thumb
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

// Enrich tracks with BPM + key via Spotify → MusicBrainz fallback
app.post('/api/enrich', async (req, res) => {
  const { artist, album, tracks } = req.body;
  if (!artist || !album || !tracks?.length) return res.status(400).json({ error: 'artist, album, and tracks required' });

  const results = tracks.map(t => ({ title: t.title, bpm: '', key: '' }));

  // ── Spotify + MusicBrainz enrichment (commented out while figuring out BPM/key source) ──
  // const spotifyToken = await getSpotifyToken();
  // if (spotifyToken) {
  //   try {
  //     const spotifyResults = await enrichWithSpotify(artist, album, tracks, spotifyToken);
  //     if (spotifyResults) {
  //       spotifyResults.forEach((r, i) => {
  //         if (r) {
  //           results[i].bpm = r.bpm;
  //           results[i].key = r.key;
  //           console.log(`[Spotify] ${tracks[i].title} → ${r.bpm} BPM, ${r.key}`);
  //         } else {
  //           console.log(`[Spotify] ${tracks[i].title} → not found`);
  //         }
  //       });
  //     }
  //   } catch (e) {
  //     console.warn('Spotify enrichment error:', e.message);
  //   }
  // } else {
  //   console.log('[Spotify] skipped — no credentials in .env');
  // }
  //
  // for (let i = 0; i < results.length; i++) {
  //   if (results[i].bpm || results[i].key) continue;
  //   console.log(`[MusicBrainz] looking up: ${tracks[i].title}`);
  //   try {
  //     const mb = await enrichWithMusicBrainz(artist, tracks[i].title);
  //     if (mb) {
  //       results[i].bpm = mb.bpm || '';
  //       results[i].key = mb.key || '';
  //       console.log(`[MusicBrainz] ${tracks[i].title} → ${mb.bpm} BPM, ${mb.key}`);
  //     } else {
  //       console.log(`[MusicBrainz] ${tracks[i].title} → not found`);
  //     }
  //   } catch (e) {
  //     console.warn('MusicBrainz enrichment error:', e.message);
  //   }
  //   if (i < results.length - 1) await new Promise(r => setTimeout(r, 1100));
  // }

  res.json({ tracks: results });
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