# Project Posterity

With hopes of maintaining my vinyl collection for generations on end, I've created a vinyl collection manager with Discogs integration, DYMO label printing, and manual BPM/key tracking using the Camelot wheel.

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Create a `.env` file
```
DISCOGS_TOKEN=your_discogs_personal_access_token
DISCOGS_USERNAME=your_discogs_username
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
```

Get your Discogs token at [discogs.com/settings/developers](https://www.discogs.com/settings/developers) → Generate new token.

Get Spotify credentials at [developer.spotify.com](https://developer.spotify.com) → Create an app (Client Credentials flow — no redirect URI needed).

> `DISCOGS_TOKEN` and `DISCOGS_USERNAME` in `.env` skip the token form in the app. If not set, you can enter them directly in the UI.

### 3. Run the app
```bash
npm start
```
Then open **http://localhost:3000** in your browser.

For development with auto-restart:
```bash
npm run dev
```

---

## Features

### Search
- Search by artist, album, or track name via the **Discogs** database
- Returns up to 4 vinyl releases with full tracklists, artwork, genre, label, and year
- Each track includes position, title, and per-track artist where available
- Click a result to add the entire album to your collection

### Collection
- View all tracks in a sortable table
- Columns: Artist, Album, Track, Year, Genre, Label, Position, Duration, BPM, Key
- **BPM and Key** — enter manually using the Camelot wheel autocomplete (e.g. `8A`, `8A — A minor`, or `A minor`)
- Remove individual tracks with ×, or clear all

### Export

#### Excel (.xlsx)
Full metadata for every track — opens directly in Excel or Numbers.

#### DYMO Labels (.csv)
One row per track, formatted for import via **File → Import Data** in DYMO Connect.

#### Print Labels (direct printing)
Print vinyl stickers directly from the browser without leaving the app:

1. Connect your LabelWriter via USB (or WiFi for the Wireless model)
2. Open the **DYMO Connect** desktop app (must be running)
3. Go to the **Export** tab — the printer auto-detects and the model dropdown updates
4. Select your label roll size (LabelWriter 550 series can auto-detect the installed roll)
5. Click **Print labels** — one sticker per album, up to 5 tracks per sticker
6. Multi-page albums get split stickers labeled `(1/2)`, `(2/2)`, etc.

Each sticker shows: artist, album, track position + title, and a meta line with BPM · key · duration.

> The DYMO Label Framework SDK is bundled locally at `public/js/DYMO.Label.Framework.latest.js` — no internet connection required.

### Discogs Export
- Add albums to your Discogs **Wantlist** or **Collection** in one click
- Uses the Discogs ID from the search result when available, otherwise searches by artist + title
- Rate-limited to stay within Discogs API rules
- Token and username can be set in `.env` or entered in the Discogs tab

---

## DYMO Supported Models
- LabelWriter 450
- LabelWriter 450 Turbo
- LabelWriter 550 *(auto-detects installed roll)*
- LabelWriter 550 Turbo *(auto-detects installed roll)*
- LabelWriter 4XL
- LabelWriter Wireless

## Supported Label Sizes
| Part # | Size | Dimensions |
|--------|------|------------|
| 30323  | 2⅛″ × 4″  | 54 × 101 mm |
| 30252  | 1⅛″ × 3½″ | 28 × 89 mm  |
| 30257  | 2⅛″ × 2⅛″ | 54 × 54 mm  |
| 30336  | 1″ × 2⅛″  | 25 × 54 mm  |
| 30332  | ¾″ × 2″   | 19 × 51 mm  |
| 30370  | 2¼″ × 4″  | 57 × 101 mm |
| Custom | —         | enter mm manually |

---

## BPM / Key
Automated BPM and key detection is not currently active (Spotify's audio-features endpoint was deprecated for new apps in November 2024). Enter BPM and key manually in the Collection table. The key field has full Camelot wheel autocomplete — type a code like `8A` or a key name like `A minor`. This is a work in progress. As soon as we find a new alternative, we will try our best to get it up and working. 

---

## File Structure
```
project-posterity/
├── server.js               # Express API server
├── public/
│   ├── index.html          # Full frontend app
│   └── js/
│       └── DYMO.Label.Framework.latest.js  # DYMO SDK (local copy)
├── .env                    # Your secrets (not committed)
├── package.json
└── README.md
```

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/config` | Returns server-side config flags (no secrets exposed) |
| POST | `/api/search` | Search Discogs by query string |
| POST | `/api/enrich` | Returns BPM/key for tracks (currently returns empty — manual input) |
| POST | `/api/discogs/export` | Add albums to Discogs wantlist or collection |
