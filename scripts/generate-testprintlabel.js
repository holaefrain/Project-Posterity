import puppeteer from 'puppeteer';
import path from 'path';

const outputPath = path.resolve('testprintlabel.png');
const wMm = 54;
const hMm = 102;
const scale = 3; // px per mm for screenshot clarity
const widthPx = Math.round(wMm * scale);
const heightPx = Math.round(hMm * scale);

const sampleInfo = {
  artist: 'Black Sheep',
  album: 'Strobelite Honey (Special Edition Remixes)',
  year: '1992',
  genre: 'House',
  label: 'Mercury'
};
const sampleTracks = [
  { position: 'A1', title: 'Strobelite Honey (Hot Mix)', bpm: '115', key: '2A', duration: '6:37' },
  { position: 'A2', title: 'Strobelite Honey (Dance Radio Mix)', bpm: '115', key: '2A', duration: '3:32' },
  { position: 'B1', title: 'Strobelite Honey (Def Version)', bpm: '115', key: '2A', duration: '8:42' },
  { position: 'B2', title: 'Strobelite Honey (Momo Beats)', bpm: '115', key: '2A', duration: '6:15' }
];

const getLabelLayout = (wMm, hMm) => {
  let maxTracks;
  if (hMm >= 140) maxTracks = 6;
  else if (hMm >= 100 && wMm >= 50) maxTracks = 4;
  else if (hMm >= 85) maxTracks = 3;
  else if (hMm >= 50) maxTracks = 2;
  else if (hMm >= 45) maxTracks = 2;
  else maxTracks = 1;

  const showMeta = wMm >= 25;
  let fonts;
  if (wMm >= 50) {
    fonts = { artist: 13, album: 11, divider: 9, title: 9, meta: 8, footer: 8 };
  } else if (wMm >= 25) {
    fonts = { artist: 11, album: 10, divider: 8, title: 8, meta: 7, footer: 7 };
  } else {
    fonts = { artist: 9, album: 8, divider: 7, title: 7, meta: 6, footer: 6 };
  }

  return { maxTracks, showMeta, fonts };
};

const getLabelFontSizesForLines = (wMm, hMm, lineDefs, layout) => {
  const MM_TO_PT = 72 / 25.4;
  const topPadMm = Math.max(9, Math.min(wMm, hMm) * 0.05);
  const bottomPadMm = Math.max(1, Math.min(wMm, hMm) * 0.02);
  const innerHeight = Math.max(1, hMm - topPadMm - bottomPadMm);
  const typeFactor = { artist: 1.35, album: 1.2, divider: 0.9, title: 1.15, meta: 1.0, footer: 1.05 };

  const totalHeight = lineDefs.reduce((sum, line) => {
    const font = layout.fonts[line.type] || layout.fonts.title;
    return sum + font * (typeFactor[line.type] || 1);
  }, 0);

  const scale = Math.min(2.5, Math.max(0.65, (innerHeight * MM_TO_PT) / Math.max(totalHeight, 1)));
  return {
    artist: Math.max(6, Math.round(layout.fonts.artist * scale)),
    album: Math.max(6, Math.round(layout.fonts.album * scale)),
    divider: Math.max(5, Math.round(layout.fonts.divider * scale)),
    title: Math.max(6, Math.round(layout.fonts.title * scale)),
    meta: Math.max(5, Math.round(layout.fonts.meta * scale)),
    footer: Math.max(5, Math.round(layout.fonts.footer * scale))
  };
};

const ptToCss = pt => `${pt}pt`;

const run = async () => {
  const layout = getLabelLayout(wMm, hMm);
  const lineDefs = [];
  lineDefs.push({ type: 'artist', text: sampleInfo.artist, bold: true });
  lineDefs.push({ type: 'album', text: sampleInfo.album });
  lineDefs.push({ type: 'divider', text: '––––––––––––––––––––––––' });
  for (const t of sampleTracks) {
    lineDefs.push({ type: 'title', text: `${t.position} ${t.title}` });
    if (layout.showMeta) {
      lineDefs.push({ type: 'meta', text: `${t.bpm} BPM · ${t.key} · ${t.duration}` });
    }
  }
  lineDefs.push({ type: 'divider', text: '––––––––––––––––––––––––' });
  lineDefs.push({ type: 'footer', text: `${sampleInfo.year} · ${sampleInfo.genre}` });
  lineDefs.push({ type: 'footer', text: sampleInfo.label });

  const fonts = getLabelFontSizesForLines(wMm, hMm, lineDefs, layout);
  const topPadMm = Math.max(9, Math.min(wMm, hMm) * 0.05);
  const sidePadMm = Math.max(1, Math.min(wMm, hMm) * 0.02);
  const bottomPadMm = Math.max(1, Math.min(wMm, hMm) * 0.02);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; padding: 0; background: #f0e8d8; display:flex; align-items:center; justify-content:center; min-height:100vh; }
    .label-shell { width: ${wMm}mm; height: ${hMm}mm; background: #fff; border: 0.2mm solid #ccc; box-sizing: border-box; position: relative; }
    .print-area { position: absolute; top: ${topPadMm}mm; left: ${sidePadMm}mm; right: ${sidePadMm}mm; bottom: ${bottomPadMm}mm; display: flex; flex-direction: column; gap: 0.4mm; }
    .line { white-space: pre-wrap; word-break: break-word; }
    .artist { font-size: ${ptToCss(fonts.artist)}; font-weight: 700; line-height: 1.1; }
    .album { font-size: ${ptToCss(fonts.album)}; line-height: 1.1; }
    .divider { font-size: ${ptToCss(fonts.divider)}; color: #888; }
    .title { font-size: ${ptToCss(fonts.title)}; line-height: 1.15; }
    .meta { font-size: ${ptToCss(fonts.meta)}; color: #444; margin-left: 2mm; line-height: 1.1; }
    .footer { font-size: ${ptToCss(fonts.footer)}; color: #333; line-height: 1.2; }
  </style>
</head>
<body>
  <div class="label-shell">
    <div class="print-area">
      ${lineDefs.map(def => `<div class="line ${def.type}">${def.text}</div>`).join('')}
    </div>
  </div>
</body>
</html>`;

  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: widthPx + 40, height: heightPx + 40 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const shell = await page.$('.label-shell');
  if (!shell) throw new Error('Label element not found');
  await shell.screenshot({ path: outputPath });
  await browser.close();
  console.log(`Saved test label PNG to ${outputPath}`);
};

run().catch(err => {
  console.error(err);
  process.exit(1);
});
