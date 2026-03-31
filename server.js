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
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const DISCOGS_TOKEN = process.env.DISCOGS_TOKEN;

// Search records via Claude AI
app.post('/api/search', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Query required' });
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in .env' });

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
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `You are a vinyl record metadata expert. The user searched: "${query}". Return a JSON array of up to 4 matching albums. For each album return: artist (string), album (string), year (number), genre (string), label (string), tracks (array of objects with: title, bpm (accurate number for the genre/era), key (musical key e.g. "A minor")). Include 4-8 tracks per album. Return ONLY valid JSON, no markdown, no explanation.`
        }]
      })
    });

    const data = await response.json();
    const text = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
    let results;
    try { results = JSON.parse(text); }
    catch { results = JSON.parse(text.replace(/```json|```/g, '').trim()); }
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Export to Discogs wantlist (uses Discogs API)
app.post('/api/discogs/export', async (req, res) => {
  const { collection, username } = req.body;
  if (!DISCOGS_TOKEN) return res.status(400).json({ error: 'DISCOGS_TOKEN not set in .env' });
  if (!username) return res.status(400).json({ error: 'Discogs username required' });

  const results = [];
  const albums = [...new Map(collection.map(t => [t.artist + t.album, t])).values()];

  for (const item of albums) {
    try {
      // Search Discogs for the release
      const searchRes = await fetch(
        `https://api.discogs.com/database/search?artist=${encodeURIComponent(item.artist)}&release_title=${encodeURIComponent(item.album)}&format=vinyl&per_page=1`,
        { headers: { 'Authorization': `Discogs token=${DISCOGS_TOKEN}`, 'User-Agent': 'VinylManager/1.0' } }
      );
      const searchData = await searchRes.json();
      const release = searchData.results?.[0];

      if (release) {
        // Add to wantlist
        const wantRes = await fetch(
          `https://api.discogs.com/users/${username}/wants/${release.id}`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `Discogs token=${DISCOGS_TOKEN}`,
              'User-Agent': 'VinylManager/1.0',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ notes: `Added via Vinyl Manager | BPM tracked locally` })
          }
        );
        results.push({ album: `${item.artist} - ${item.album}`, status: wantRes.ok ? 'added' : 'failed', discogsId: release.id });
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

app.listen(PORT, () => console.log(`\n🎵 Vinyl Manager running at http://localhost:${PORT}\n`));
