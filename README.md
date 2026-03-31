# Vinyl Manager

AI-powered vinyl collection manager with DYMO label export and Discogs integration.

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment variables
```bash
cp .env.example .env
```
Open `.env` and fill in your keys:

| Variable | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| `DISCOGS_TOKEN` | [discogs.com/settings/developers](https://www.discogs.com/settings/developers) → Generate new token |
| `DISCOGS_USERNAME` | Your Discogs username |

### 3. Run the app
```bash
npm start
```
Then open **http://localhost:3000** in your browser.

For development with auto-restart on file changes:
```bash
npm run dev
```

---

## Features

### Search & Add
- Type any artist, album, or track name
- Claude AI returns up to 4 matching albums with full track listings
- Each track includes: Artist, Album, Title, Year, Genre, Label, BPM, Key
- Click a result to add the entire album to your collection

### Collection
- View all tracks in a table
- Remove individual tracks with ×

### Export
- **Excel (.xlsx)** — all 8 metadata columns, ready to open in Excel/Numbers
- **DYMO Labels (.csv)** — formatted for DYMO 30323 (2⅛″ × 4″)
  - In DYMO Connect: File → Import Data → select the CSV

### Discogs
- Enter your Discogs username + personal access token
- Add albums to your **Wantlist** or **Collection**
- Searches Discogs for each album automatically
- Rate-limited to stay within Discogs API rules
- You can also set `DISCOGS_TOKEN` and `DISCOGS_USERNAME` in `.env` to skip the form

---

## File Structure
```
vinyl-manager/
├── server.js          # Express API server
├── public/
│   └── index.html     # Full frontend app
├── .env               # Your secrets (not committed)
├── .env.example       # Template
├── package.json
└── README.md
```
