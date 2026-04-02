# Project Posterity

A vinyl collection manager with Discogs integration, DYMO label printing, and BPM/key tracking via the Camelot wheel.

---

## Requirements

| Requirement | Version | Notes |
|-------------|---------|-------|
| [Node.js](https://nodejs.org) | 18+ | Uses ESM modules and `--import` flag |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | any recent | Optional — only needed for YouTube audio analysis fallback |
| [FFmpeg](https://ffmpeg.org/download.html) | any recent | Optional — required alongside yt-dlp for audio analysis |
| [DYMO Connect](https://www.dymo.com/support/dymo-connect-software-dymo-label-v-8-support.html) | desktop app | Optional — only needed for direct label printing |

> **yt-dlp** and **ffmpeg** are only used as a fallback when Beatport doesn't have BPM/key data for a track. The app works fully without them — you can always enter BPM and key manually.

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/your-username/project-posterity.git
cd project-posterity
npm install
```

### 2. Create a `.env` file

```
DISCOGS_TOKEN=your_discogs_personal_access_token
DISCOGS_USERNAME=your_discogs_username
```

Get your token at [discogs.com/settings/developers](https://www.discogs.com/settings/developers) → **Generate new token**.

> Both values are optional — if omitted, you can enter them directly in the app's Discogs tab UI.

### 3. Start the server

```bash
npm start
```

Open **http://localhost:3000** in your browser.

For development with auto-restart on file changes:

```bash
npm run dev
```

---

## Installing system dependencies

### yt-dlp

```bash
# macOS (Homebrew)
brew install yt-dlp

# Linux
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp

# Windows — download yt-dlp.exe from https://github.com/yt-dlp/yt-dlp/releases
# and place it somewhere on your PATH
```

### FFmpeg

```bash
# macOS (Homebrew)
brew install ffmpeg

# Ubuntu / Debian
sudo apt install ffmpeg

# Windows — download from https://ffmpeg.org/download.html
# and add the bin/ folder to your PATH
```

---

## Features

### Search
- Search the Discogs database by artist, album, or track name
- Returns up to 25 vinyl releases with full tracklists, artwork, genre, label, and year
- Click a result to add the full album (all tracks) to your local collection

### Collection
- Sortable table of all tracks across every album you've added
- Columns: Artist, Album, Track, Year, Genre, Label, Position, Duration, BPM, Key
- **BPM and Key** — enter manually using the Camelot wheel autocomplete (type `8A`, `8A — A minor`, or `A minor`)
- Remove individual tracks with ×, or clear the entire collection

### Export

#### Excel (.xlsx)
Full metadata for every track — opens directly in Excel or Numbers.

#### DYMO Labels (.csv)
One row per track, formatted for import via **File → Import Data** in DYMO Connect.

#### Print Labels (direct printing)
Print vinyl stickers directly from the browser:

1. Connect your LabelWriter via USB (or WiFi for the Wireless model)
2. Open the **DYMO Connect** desktop app — it must be running in the background
3. Go to the **Export** tab — the app auto-detects the printer
4. Select your label roll size (LabelWriter 550 series auto-detects the installed roll)
5. Click **Print labels** — one sticker per album, up to 5 tracks per sticker
6. Multi-page albums get split stickers labeled `(1/2)`, `(2/2)`, etc.

Each sticker shows: artist, album, track position + title, and BPM · key · duration.

> The DYMO Label Framework SDK is bundled at `public/js/DYMO.Label.Framework.latest.js` — no internet connection required for printing.

### Discogs Tab
- **Connect** with your Discogs username and token (or rely on `.env` values to auto-connect)
- **Export to Discogs** — push your local collection to your Discogs Wantlist or Collection in one click
- **Wantlist** (left column) — browse your Discogs wantlist, paginated; click any item to pull its full tracklist and add it to your local collection
- **Your Collection** (right column) — browse your Discogs collection, paginated; links back to each release on Discogs

### BPM / Key Detection
BPM and key are fetched automatically when you click **Enrich BPM & Key** on a search result:

1. **Beatport** is checked first (scraped from search results — works for most electronic releases)
2. **YouTube audio analysis** is used as a fallback (requires `yt-dlp` + `ffmpeg`) — downloads the first 90 seconds of a linked video, runs tempo detection and a Krumhansl-Schmuckler key analysis

If neither source returns a result, enter BPM and key manually in the Collection table.

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

## File Structure
```
project-posterity/
├── server.js               # Express API server
├── audioAnalysis.js        # BPM/key detection via yt-dlp + ffmpeg
├── public/
│   ├── index.html          # Full frontend (single-page app)
│   └── js/
│       └── DYMO.Label.Framework.latest.js  # DYMO SDK (bundled, no CDN needed)
├── .env                    # Your secrets — never committed
├── package.json
└── README.md
```

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/config` | Returns server-side config flags (no secrets exposed) |
| POST | `/api/search` | Search Discogs by query string |
| POST | `/api/enrich` | Fetch BPM/key via Beatport or YouTube audio analysis |
| POST | `/api/discogs/verify` | Verify Discogs credentials, returns user profile |
| GET  | `/api/discogs/wantlist` | Paginated wantlist for a user |
| GET  | `/api/discogs/collection` | Paginated Discogs collection for a user |
| GET  | `/api/discogs/release/:id` | Full tracklist + videos for a single release |
| POST | `/api/discogs/export` | Add albums to Discogs wantlist or collection |
