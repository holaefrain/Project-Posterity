import { spawn } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const MusicTempo = require('music-tempo');

const SAMPLE_RATE = 22050;
const DOWNLOAD_SECONDS = 90;

// ── FFT (Cooley-Tukey radix-2) ─────────────────────────────────────────────
function fft(real, imag) {
  const n = real.length;
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  // Butterfly passes
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wCosBase = Math.cos(ang);
    const wSinBase = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wCos = 1, wSin = 0;
      for (let j = 0; j < len / 2; j++) {
        const uR = real[i + j], uI = imag[i + j];
        const vR = real[i + j + len / 2] * wCos - imag[i + j + len / 2] * wSin;
        const vI = real[i + j + len / 2] * wSin + imag[i + j + len / 2] * wCos;
        real[i + j] = uR + vR;
        imag[i + j] = uI + vI;
        real[i + j + len / 2] = uR - vR;
        imag[i + j + len / 2] = uI - vI;
        const newWCos = wCos * wCosBase - wSin * wSinBase;
        wSin = wCos * wSinBase + wSin * wCosBase;
        wCos = newWCos;
      }
    }
  }
}

// ── Chromagram ─────────────────────────────────────────────────────────────
function computeChromagram(samples, sampleRate) {
  const frameSize = 4096;
  const hopSize = 2048;
  const chroma = new Float32Array(12).fill(0);

  // Precompute Hann window
  const hann = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (frameSize - 1)));
  }

  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    const real = new Float32Array(frameSize);
    const imag = new Float32Array(frameSize).fill(0);
    for (let i = 0; i < frameSize; i++) {
      real[i] = samples[start + i] * hann[i];
    }

    fft(real, imag);

    // Map FFT bins to 12 chroma classes (C2–B6: ~65 Hz – ~2000 Hz)
    for (let k = 1; k < frameSize / 2; k++) {
      const freq = k * sampleRate / frameSize;
      if (freq < 65 || freq > 2000) continue;
      const midi = Math.round(12 * Math.log2(freq / 440) + 69);
      const c = ((midi % 12) + 12) % 12;
      const mag = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]);
      chroma[c] += mag;
    }
  }

  // Normalize to [0, 1]
  const max = Math.max(...chroma);
  if (max > 0) for (let i = 0; i < 12; i++) chroma[i] /= max;
  return chroma;
}

// ── Key detection (Krumhansl-Schmuckler) ───────────────────────────────────
function detectKey(samples, sampleRate) {
  // Krumhansl-Kessler tonal hierarchy profiles
  const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const NOTE_NAMES  = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  const chroma = computeChromagram(samples, sampleRate);

  function pearson(a, b) {
    const n = a.length;
    const meanA = a.reduce((s, v) => s + v, 0) / n;
    const meanB = b.reduce((s, v) => s + v, 0) / n;
    let num = 0, denA = 0, denB = 0;
    for (let i = 0; i < n; i++) {
      const da = a[i] - meanA, db = b[i] - meanB;
      num += da * db;
      denA += da * da;
      denB += db * db;
    }
    return num / (Math.sqrt(denA * denB) + 1e-10);
  }

  let bestCorr = -Infinity, bestKey = '';
  for (let root = 0; root < 12; root++) {
    const majorRot = [...majorProfile.slice(root), ...majorProfile.slice(0, root)];
    const minorRot = [...minorProfile.slice(root), ...minorProfile.slice(0, root)];
    const chromaArr = Array.from(chroma);

    const mj = pearson(chromaArr, majorRot);
    const mn = pearson(chromaArr, minorRot);

    if (mj > bestCorr) { bestCorr = mj; bestKey = `${NOTE_NAMES[root]} major`; }
    if (mn > bestCorr) { bestCorr = mn; bestKey = `${NOTE_NAMES[root]} minor`; }
  }

  return bestKey;
}

// ── Video-to-track title matching ──────────────────────────────────────────
function normalize(str) {
  return str
    .toLowerCase()
    .replace(/feat\.?.*$/i, '')        // strip "feat. X"
    .replace(/\(.*?\)/g, '')           // strip parentheses
    .replace(/\[.*?\]/g, '')           // strip brackets
    .replace(/^[a-z]\d*[\.\s:–\-]+/i, '') // strip side/position prefix: A1. B2: etc.
    .replace(/^side\s+[ab]\s*[-:.]?\s*/i, '') // strip "Side A/B"
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchVideoToTrack(trackTitle, videos) {
  if (!videos?.length) return null;
  const trackNorm = normalize(trackTitle);
  if (!trackNorm) return null;

  let bestUrl = null;
  let bestScore = 0;

  for (const video of videos) {
    if (!video?.uri || !video?.title) continue;

    // Strip "Artist - " prefix common in video titles
    const stripped = video.title.replace(/^[^–\-]+(–|-)\s*/, '');
    const videoNorm = normalize(stripped);
    if (!videoNorm) continue;

    // Exact match — return immediately
    if (videoNorm === trackNorm) return video.uri;

    // Substring containment — score by length ratio to penalise over-broad matches
    if (videoNorm.includes(trackNorm) || trackNorm.includes(videoNorm)) {
      const score = Math.min(videoNorm.length, trackNorm.length) /
                    Math.max(videoNorm.length, trackNorm.length);
      if (score > bestScore) { bestScore = score; bestUrl = video.uri; }
      continue;
    }

    // Word-overlap fallback (threshold ≥ 0.6)
    const tw = new Set(trackNorm.split(' ').filter(w => w.length > 2));
    const vw = new Set(videoNorm.split(' ').filter(w => w.length > 2));
    if (tw.size === 0) continue;
    let overlap = 0;
    for (const w of tw) if (vw.has(w)) overlap++;
    const score = overlap / Math.max(tw.size, vw.size);
    if (score >= 0.6 && score > bestScore) { bestScore = score; bestUrl = video.uri; }
  }

  return bestUrl;
}

// ── Audio download via yt-dlp | ffmpeg ────────────────────────────────────
function downloadAudioPCM(url) {
  return new Promise((resolve, reject) => {
    const ytdlp = spawn('yt-dlp', [
      '-x', '-f', 'bestaudio',
      '--download-sections', `*0-${DOWNLOAD_SECONDS}`,
      '--no-playlist',
      '-o', '-',
      '--quiet',
      url
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    const ffmpeg = spawn('ffmpeg', [
      '-i', 'pipe:0',
      '-f', 's16le',
      '-ac', '1',
      '-ar', String(SAMPLE_RATE),
      '-loglevel', 'error',
      'pipe:1'
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    ytdlp.stdout.pipe(ffmpeg.stdin);
    ytdlp.stderr.on('data', () => {});  // suppress yt-dlp output

    const chunks = [];
    ffmpeg.stdout.on('data', chunk => chunks.push(chunk));

    const timeout = setTimeout(() => {
      ytdlp.kill('SIGKILL');
      ffmpeg.kill('SIGKILL');
      reject(new Error('Audio download timed out'));
    }, 90_000);

    ffmpeg.stdout.on('end', () => {
      clearTimeout(timeout);
      const buf = Buffer.concat(chunks);
      if (buf.length < 2) return reject(new Error('Empty audio buffer'));

      // Convert S16LE → Float32
      const samples = new Float32Array(buf.length / 2);
      for (let i = 0; i < samples.length; i++) {
        samples[i] = buf.readInt16LE(i * 2) / 32768.0;
      }
      resolve(samples);
    });

    ffmpeg.on('error', err => { clearTimeout(timeout); reject(err); });
    ytdlp.on('error', err => { clearTimeout(timeout); reject(err); });
  });
}

// ── Public: analyze a YouTube URL → { bpm, key } ──────────────────────────
export async function analyzeAudio(url) {
  const samples = await downloadAudioPCM(url);

  const mt = new MusicTempo(samples);
  const bpm = Math.round(mt.tempo);
  const key = detectKey(samples, SAMPLE_RATE);

  return { bpm, key };
}
