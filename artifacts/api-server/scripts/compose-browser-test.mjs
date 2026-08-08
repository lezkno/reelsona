/**
 * Composes the already-rendered caption PNGs from /tmp/browser_caption_test_work/
 * into a full video using the FFmpeg concat demuxer approach (avoids 140-input limit).
 *
 * Usage: ../../scripts/node_modules/.bin/tsx scripts/compose-browser-test.mjs
 */

import path from "path";
import fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import axios from "axios";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TMP_DIR    = "/tmp/browser_caption_test_work";
const OUTPUT     = "/tmp/browser_caption_test.mp4";
const VIDEO_IN   = path.join(TMP_DIR, "input.mp4");
const CONCAT_TXT = path.join(TMP_DIR, "concat.txt");
const CAP_VIDEO  = path.join(TMP_DIR, "captions.mp4");

const SUBTITLE_URL = process.env.TEST_SUBTITLE_URL || null;
const DURATION_SECONDS = 61;

const SCRIPT = `¿Y si tu próximo video no necesitara cámaras, luces ni una hora frente al espejo? No te estoy diciendo que contratar y crear videos profesionales sea una pérdida de tiempo y dinero. De hecho, ese contenido puede transmitir mucha confianza y personalidad. Pero si cada publicación depende de una producción completa, tu calendario puede quedarse más vacío que una bandeja de entrada un lunes. Ahí entra un avatar digital tuyo. Puedes alternarlo con tus videos habituales para explicar automatizaciones, responder preguntas frecuentes, presentar un chatbot o compartir consejos de inteligencia artificial en minutos. Así mantienes la constancia sin convertir cada Reel en una producción de cine. La clave no es reemplazarte, sino darte otra forma de aparecer y comunicar. Este video fue creado con mi avatar con inteligencia artificial. Sígueme y te ayudo a crear algo así para tu negocio.`;

import {
  getBrowserTemplate,
  buildCaptionCues,
} from "@workspace/caption-templates";

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseSRT(srt) {
  const blocks = srt.trim().split(/\n\n+/);
  const timings = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length < 3) continue;
    const m = lines[1].match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/);
    if (!m) continue;
    const startMs = (+m[1]*3600 + +m[2]*60 + +m[3]) * 1000 + +m[4];
    const endMs   = (+m[5]*3600 + +m[6]*60 + +m[7]) * 1000 + +m[8];
    const words   = lines.slice(2).join(" ").trim().split(/\s+/).filter(Boolean);
    const msEach  = (endMs - startMs) / Math.max(words.length, 1);
    words.forEach((text, i) => timings.push({
      text,
      startMs: Math.round(startMs + i * msEach),
      endMs:   Math.round(startMs + (i + 1) * msEach),
    }));
  }
  return timings;
}

function buildFallbackTimings(script, durationSeconds) {
  const tokens = script.split(/\s+/).filter(Boolean);
  const msEach = (durationSeconds * 1000) / Math.max(tokens.length, 1);
  return tokens.map((text, i) => ({
    text,
    startMs: Math.round(i * msEach),
    endMs:   Math.round((i + 1) * msEach),
  }));
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log("=== Browser Caption Composer ===");

// 1. Check PNGs exist
const pngs = (await fs.readdir(TMP_DIR)).filter(f => f.match(/^cue_\d{4}\.png$/)).sort();
console.log(`Found ${pngs.length} PNG frames in ${TMP_DIR}`);
if (pngs.length === 0) { console.error("No PNG frames found — run test-browser-captions.mjs first"); process.exit(1); }

// 2. Rebuild timing data
const template = getBrowserTemplate("clean_coach");
let wordTimings = [];

if (SUBTITLE_URL) {
  try {
    const r = await axios.get(SUBTITLE_URL, { timeout: 15_000 });
    wordTimings = parseSRT(r.data);
    console.log(`SRT timings: ${wordTimings.length} words`);
  } catch (e) {
    console.warn(`SRT fetch failed: ${e.message}`);
  }
}
if (!wordTimings.length) {
  wordTimings = buildFallbackTimings(SCRIPT, DURATION_SECONDS);
  console.log(`Fallback timings: ${wordTimings.length} words`);
}

const allCues = buildCaptionCues(wordTimings, template);
const cues    = allCues.slice(0, 400);
console.log(`Cues: ${cues.length}`);

// 3. Build segments with timing
const segments = cues.map((cue, i) => ({
  pngPath:  path.join(TMP_DIR, `cue_${String(i).padStart(4, "0")}.png`),
  startSec: cue.startMs / 1000,
  endSec:   (i + 1 < cues.length ? cues[i + 1].startMs : cue.endMs) / 1000,
}));

// 4. Write concat.txt — each PNG shown for its duration
// Pad with a 1×1 transparent PNG before first cue if it doesn't start at 0
const lines = [];

// If first cue doesn't start at 0, add a gap (blank frame)
if (segments[0].startSec > 0.05) {
  // Use the first cue PNG as a placeholder but hidden won't work with concat — just start from 0
  // Instead, duplicate the first PNG and trim duration
}

for (let i = 0; i < segments.length; i++) {
  const { pngPath, startSec, endSec } = segments[i];
  const dur = Math.max(endSec - startSec, 0.033);
  lines.push(`file '${pngPath}'`);
  lines.push(`duration ${dur.toFixed(3)}`);
}
// FFmpeg concat demuxer needs the last file listed twice (last entry has no duration)
lines.push(`file '${segments[segments.length - 1].pngPath}'`);

await fs.writeFile(CONCAT_TXT, lines.join("\n"));
console.log(`\nConcat file written: ${CONCAT_TXT} (${lines.length} lines)`);

// 5. Build caption overlay video from PNG sequence
console.log("\nStep 1/2: Building caption overlay video from PNGs...");
await execFileAsync("ffmpeg", [
  "-f", "concat",
  "-safe", "0",
  "-i", CONCAT_TXT,
  "-vf", "scale=720:1280,format=yuva420p",
  "-c:v", "libvpx-vp9",
  "-b:v", "0",
  "-crf", "10",
  "-auto-alt-ref", "0",  // required for alpha
  "-y", CAP_VIDEO,
], { maxBuffer: 50 * 1024 * 1024 });
const capStat = await fs.stat(CAP_VIDEO);
console.log(`✓ Caption overlay video: ${(capStat.size / 1024).toFixed(0)}KB`);

// 6. Composite caption video onto source video
console.log("\nStep 2/2: Compositing onto source video...");
await execFileAsync("ffmpeg", [
  "-i", VIDEO_IN,
  "-i", CAP_VIDEO,
  "-filter_complex", "[0:v][1:v]overlay=0:0:shortest=1[out]",
  "-map", "[out]",
  "-map", "0:a?",
  "-c:v", "libx264",
  "-preset", "fast",
  "-crf", "21",
  "-c:a", "copy",
  "-y", OUTPUT,
], { maxBuffer: 200 * 1024 * 1024 });

const outStat = await fs.stat(OUTPUT);
console.log(`✓ Output: ${OUTPUT} (${(outStat.size / 1024 / 1024).toFixed(1)}MB)`);

// 7. Extract sample frames
console.log("\nExtracting sample frames...");
for (const t of [5, 15, 30, 45]) {
  await execFileAsync("ffmpeg", ["-ss", String(t), "-i", OUTPUT, "-vframes", "1", "-update", "1", "-y", `/tmp/bc_frame_${t}s.jpg`]);
  console.log(`  /tmp/bc_frame_${t}s.jpg`);
}

console.log("\n=== Done ===");
