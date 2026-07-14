# Bug Log

## 2026-07-14 — Server fails to start: `Cannot find module 'music-tempo'`

**Problem**
`npm start` / `node --import dotenv/config server.js` crashed immediately with:

```
Error: Cannot find module 'music-tempo'
Require stack:
- audioAnalysis.js
```

The app never got past startup, so nothing built or ran.

**Diagnosis**
1. Confirmed there's no `build` script in `package.json` — this is a plain Node/Express app with no build step, so "not building" meant the server process itself was crashing on start.
2. Ran the start command directly (`node --import dotenv/config server.js`) to capture the raw error instead of relying on `npm start` output.
3. Error pointed to `audioAnalysis.js:5` requiring `music-tempo`.
4. Checked `node_modules` — `music-tempo` was listed in `package.json` dependencies but the folder was missing from `node_modules` (only 85 packages present).
5. Checked `.gitignore` and recent git log — `node_modules/` had previously been accidentally committed, then removed from tracking (`76f1d51 somehow node_modules got committed, removing`, `b75e771 Remove node_modules from tracking`). That cleanup likely left a stale/incomplete `node_modules` on disk missing this package.

**Fix**
Ran `npm install`, which added the missing `music-tempo` package (1 package added, 88 audited). Re-ran the server and confirmed clean startup:

```
Project Posterity running at http://localhost:3000
```

**Follow-up / not yet addressed**
`npm audit` reports 4 vulnerabilities (3 moderate, 1 high) — not investigated yet.
