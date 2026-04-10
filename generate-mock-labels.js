import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Sample data for a label
const sampleInfo = {
  artist: 'The Beatles',
  album: 'Abbey Road',
  year: '1969',
  genre: 'Rock',
  label: 'Apple Records'
};

const sampleTracks = [
  { title: 'Come Together', position: '1', duration: '4:20', bpm: '120', key: 'A' },
  { title: 'Something', position: '2', duration: '3:03', bpm: '130', key: 'C' },
  { title: 'Maxwell\'s Silver Hammer', position: '3', duration: '3:27', bpm: '140', key: 'G' },
  { title: 'Oh! Darling', position: '4', duration: '3:26', bpm: '125', key: 'A' },
  { title: 'Octopus\'s Garden', position: '5', duration: '2:51', bpm: '135', key: 'D' }
];

// Label sizes
const sizes = [
  { name: '54x102', w: 54, h: 102 },
  { name: '29x89', w: 29, h: 89 },
  { name: '54x54', w: 54, h: 54 },
  { name: '25x54', w: 25, h: 54 },
  { name: '19x51', w: 19, h: 51 },
  { name: '59x102', w: 59, h: 102 },
  { name: '25x25', w: 25, h: 25 },
  { name: '102x152', w: 102, h: 152 }
];

// Function to get layout (copied from HTML)
function getLabelLayout(wMm, hMm) {
  let maxTracks;
  if      (hMm >= 140) maxTracks = 8;
  else if (hMm >= 100 && wMm >= 50) maxTracks = 6;
  else if (hMm >= 85)               maxTracks = 5;
  else if (hMm >= 50)               maxTracks = 4;
  else if (hMm >= 45)               maxTracks = 3;
  else                              maxTracks = 2;

  const showMeta = wMm >= 25;

  let fonts;
  if (wMm >= 50) {
    fonts = { artist: 12, album: 10, divider: 8, title: 9, meta: 8, footer: 8 };
  } else if (wMm >= 25) {
    fonts = { artist: 10, album: 9, divider: 7, title: 8, meta: 7, footer: 7 };
  } else {
    fonts = { artist: 8, album: 7, divider: 6, title: 7, meta: 6, footer: 6 };
  }

  return { maxTracks, showMeta, fonts };
}

// Function to render text on canvas
function drawText(ctx, text, x, y, fontSize, maxWidth) {
  ctx.font = `${fontSize}px Arial`;
  const words = text.split(' ');
  let line = '';
  let lines = [];
  for (let i = 0; i < words.length; i++) {
    const testLine = line + words[i] + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && i > 0) {
      lines.push(line);
      line = words[i] + ' ';
    } else {
      line = testLine;
    }
  }
  lines.push(line);

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, y + i * (fontSize + 2));
  }
  return lines.length * (fontSize + 2);
}

async function generateMockLabels() {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  for (const size of sizes) {
    const { w, h } = size;
    const layout = getLabelLayout(w, h);
    const tracks = sampleTracks.slice(0, layout.maxTracks);

    // Create HTML with canvas
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { margin: 0; background: white; }
          canvas { border: 1px solid black; }
        </style>
      </head>
      <body>
        <canvas id="label" width="${w * 4}" height="${h * 4}"></canvas>
        <script>
          const canvas = document.getElementById('label');
          const ctx = canvas.getContext('2d');
          ctx.scale(4, 4); // Scale for higher resolution
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, ${w}, ${h});
          ctx.fillStyle = 'black';

          let y = 2;
          const maxWidth = ${w} - 4;

          // Artist
          ctx.font = '${layout.fonts.artist}pt Arial';
          ctx.fillText('${sampleInfo.artist}', 2, y + ${layout.fonts.artist});
          y += ${layout.fonts.artist} + 4;

          // Album
          ctx.font = '${layout.fonts.album}pt Arial';
          ctx.fillText('${sampleInfo.album}', 2, y + ${layout.fonts.album});
          y += ${layout.fonts.album} + 4;

          // Divider
          ctx.font = '${layout.fonts.divider}pt Arial';
          ctx.fillText('─'.repeat(${Math.floor(w / 2)}), 2, y + ${layout.fonts.divider});
          y += ${layout.fonts.divider} + 4;

          // Tracks
          ${tracks.map(track => `
            ctx.font = '${layout.fonts.title}pt Arial';
            ctx.fillText('${track.position ? track.position + '. ' : ''}${track.title}', 2, y + ${layout.fonts.title});
            y += ${layout.fonts.title} + 2;
            ${layout.showMeta ? `
              const meta = [${track.bpm ? `'${track.bpm} BPM'` : ''}, '${track.key || ''}', '${track.duration || ''}'].filter(Boolean).join(' · ');
              if (meta) {
                ctx.font = '${layout.fonts.meta}pt Arial';
                ctx.fillText(meta, 2, y + ${layout.fonts.meta});
                y += ${layout.fonts.meta} + 2;
              }
            ` : ''}
          `).join('')}

          // Divider
          ctx.font = '${layout.fonts.divider}pt Arial';
          ctx.fillText('─'.repeat(${Math.floor(w / 2)}), 2, y + ${layout.fonts.divider});
          y += ${layout.fonts.divider} + 4;

          // Footer
          const yearGenre = ['${sampleInfo.year}', '${sampleInfo.genre}'].filter(Boolean).join(' · ');
          if (yearGenre) {
            ctx.font = '${layout.fonts.footer}pt Arial';
            ctx.fillText(yearGenre, 2, y + ${layout.fonts.footer});
            y += ${layout.fonts.footer} + 2;
          }
          if ('${sampleInfo.label}') {
            ctx.font = '${layout.fonts.footer}pt Arial';
            ctx.fillText('${sampleInfo.label}', 2, y + ${layout.fonts.footer});
          }
        </script>
      </body>
      </html>
    `;

    await page.setContent(html);
    await page.waitForSelector('canvas');

    const canvas = await page.$('canvas');
    await canvas.screenshot({ path: path.join(__dirname, `mock-label-${size.name}.png`) });

    console.log(`Generated mock-label-${size.name}.png`);
  }

  await browser.close();
}

generateMockLabels().catch(console.error);