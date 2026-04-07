# Security Policy

## Supported Versions

Project Posterity is an actively maintained personal project. Only the latest version on the `main` branch receives security updates.

| Version | Supported |
| ------- | --------- |
| latest (main) | Yes |
| older commits | No |

## Sensitive Data

This project handles credentials that should never be committed to version control:

- **`DISCOGS_TOKEN`** — your Discogs personal access token
- **`DISCOGS_USERNAME`** — your Discogs username

These are loaded from a `.env` file which is listed in `.gitignore`. Never hardcode these values in source files or commit them to the repository.

## Reporting a Vulnerability

If you discover a security vulnerability in Project Posterity, please open an issue on the [GitHub repository](https://github.com/holaefrain/Project-Posterity/issues) and label it **security**.

For sensitive disclosures (e.g., credential leaks), you can reach out directly through GitHub instead of opening a public issue.

You can expect an acknowledgment within a few days. If the vulnerability is confirmed, a fix will be prioritized accordingly. If it is not accepted, you will receive an explanation.

## Known Security Considerations

- The server runs locally on `localhost:3000` and is not intended to be exposed to the public internet.
- The Beatport BPM/key enrichment feature scrapes a third-party site — use it responsibly.
- The YouTube audio analysis fallback uses `yt-dlp` and `ffmpeg` locally; no audio data is sent to external servers beyond what `yt-dlp` fetches.
- The DYMO Label Framework SDK (`public/js/DYMO.Label.Framework.latest.js`) is bundled locally — no CDN or external network request is made for printing.
