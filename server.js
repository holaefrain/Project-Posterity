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

// Enrich tracks with BPM + key via Claude AI
app.post('/api/enrich', async (req, res) => {
  const { artist, album, tracks } = req.body;
  if (!artist || !album || !tracks?.length) return res.status(400).json({ error: 'artist, album, and tracks required' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in .env' });

  const trackList = tracks.map((t, i) => `${i + 1}. ${t.title}`).join('\n');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `You are a music expert with deep knowledge of BPM and musical keys. For the album "${album}" by "${artist}", provide the BPM and musical key for each track listed below.

Tracks:
${trackList}

Return ONLY a JSON array with one object per track in the same order, each with:
- "title": exact track title as given
- "bpm": integer BPM (your best estimate based on known recordings or genre/era knowledge)
- "key": musical key (e.g. "A minor", "F# major", "D dorian")

Return ONLY valid JSON, no markdown, no explanation.`
        }]
      })
    });

    const data = await response.json();
    const text = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
    let enriched;
    try { enriched = JSON.parse(text); }
    catch { enriched = JSON.parse(text.replace(/```json|```/g, '').trim()); }
    res.json({ tracks: enriched });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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