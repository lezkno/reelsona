/**
 * Composes caption PNGs from /tmp/browser_caption_test_work/ into a video.
 *
 * Strategy: batch-segment compositing
 * - Splits 140 cues into batches of MAX_BATCH_SIZE
 * - For each batch: runs FFmpeg on the video time range with those overlays
 * - Each PNG is scaled to match the source video resolution before overlay
 * - Concatenates all segments into the final output
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

const SUBTITLE_URL      = process.env.TEST_SUBTITLE_URL || null;
const DURATION_SECONDS  = 61;
const MAX_BATCH_SIZE    = 15;   // max overlays per FFmpeg call

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

async function getVideoInfo(videoPath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet", "-print_format", "json", "-show_streams", videoPath,
  ]);
  const info = JSON.parse(stdout);
  const v = info.streams.find(s => s.codec_type === "video");
  return { width: v.width, height: v.height };
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log("=== Browser Caption Composer (batch-segment) ===");

const pngs = (await fs.readdir(TMP_DIR)).filter(f => f.match(/^cue_\d{4}\.png$/)).sort();
console.log(`Found ${pngs.length} PNG frames in ${TMP_DIR}`);
if (pngs.length === 0) { console.error("No PNGs — run test-browser-captions.mjs first"); process.exit(1); }

// Get source video dimensions
const { width: VW, height: VH } = await getVideoInfo(VIDEO_IN);
console.log(`Source video: ${VW}×${VH}`);

// Rebuild timing data
const template = getBrowserTemplate("clean_coach");
let wordTimings = [];

if (SUBTITLE_URL) {
  try {
    const r = await axios.get(SUBTITLE_URL, { timeout: 15_000 });
    wordTimings = parseSRT(r.data);
    console.log(`SRT timings: ${wordTimings.length} words`);
  } catch (e) { console.warn(`SRT fetch failed: ${e.message}`); }
}
if (!wordTimings.length) {
  wordTimings = buildFallbackTimings(SCRIPT, DURATION_SECONDS);
  console.log(`Fallback timings: ${wordTimings.length} words`);
}

const allCues = buildCaptionCues(wordTimings, template);
const cues    = allCues.slice(0, 400);
console.log(`Cues: ${cues.length}`);

// Build segments with absolute timing
const segments = cues.map((cue, i) => ({
  pngPath:  path.join(TMP_DIR, `cue_${String(i).padStart(4, "0")}.png`),
  startSec: cue.startMs / 1000,
  endSec:   (i + 1 < cues.length ? cues[i + 1].startMs : cue.endMs) / 1000,
}));

const totalDuration = segments[segments.length - 1].endSec;

// Split cues into batches
const batches = [];
for (let i = 0; i < segments.length; i += MAX_BATCH_SIZE) {
  batches.push(segments.slice(i, i + MAX_BATCH_SIZE));
}
console.log(`Split into ${batches.length} batches (max ${MAX_BATCH_SIZE} overlays each)`);

// Process each batch: cut the video time range + apply overlays
const segmentFiles = [];
const segListFile  = path.join(TMP_DIR, "seg_list.txt");

await fs.mkdir(TMP_DIR, { recursive: true });

for (let b = 0; b < batches.length; b++) {
  const batch     = batches[b];
  const batchStart = batch[0].startSec;
  const batchEnd   = batches[b + 1] ? batches[b + 1][0].startSec : totalDuration;
  const batchDur   = batchEnd - batchStart;
  const segOut     = path.join(TMP_DIR, `seg_${String(b).padStart(3, "0")}.mp4`);

  process.stdout.write(`  Batch ${b + 1}/${batches.length} [${batchStart.toFixed(2)}s–${batchEnd.toFixed(2)}s]...`);

  // Build overlay filter: scale each PNG to video size, then chain overlays
  // Timestamps are adjusted to be relative to batchStart
  const extraInputs = [];
  const filterParts = [];
  let prevLabel = "[base]";

  batch.forEach(({ pngPath, startSec, endSec }, i) => {
    const relStart = (startSec - batchStart).toFixed(3);
    const relEnd   = (endSec   - batchStart).toFixed(3);
    const inLabel  = `[cap${i}]`;
    const outLabel = i < batch.length - 1 ? `[ov${i}]` : "[out]";

    extraInputs.push("-i", pngPath);
    // Scale PNG from its native size (1080×1920) to video size (VW×VH)
    filterParts.push(`[${i + 1}:v]scale=${VW}:${VH}${inLabel}`);
    filterParts.push(`${prevLabel}${inLabel}overlay=0:0:enable='between(t,${relStart},${relEnd})'${outLabel}`);
    prevLabel = outLabel;
  });

  // [base] is the trimmed video segment (use setpts to reset timestamps)
  const fullFilter = `[0:v]setpts=PTS-STARTPTS[base]; ${filterParts.join("; ")}`;

  await execFileAsync("ffmpeg", [
    "-ss", String(batchStart),
    "-t",  String(batchDur),
    "-i",  VIDEO_IN,
    ...extraInputs,
    "-filter_complex", fullFilter,
    "-map", "[out]",
    "-map", "0:a?",
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "21",
    "-c:a", "aac",
    "-b:a", "128k",
    "-y", segOut,
  ], { maxBuffer: 100 * 1024 * 1024 });

  segmentFiles.push(segOut);
  process.stdout.write(" done\n");
}

// Concatenate all segments
console.log(`\nConcatenating ${segmentFiles.length} segments...`);
const segListContent = segmentFiles.map(f => `file '${f}'`).join("\n");
await fs.writeFile(segListFile, segListContent);

await execFileAsync("ffmpeg", [
  "-f", "concat",
  "-safe", "0",
  "-i", segListFile,
  "-c", "copy",
  "-y", OUTPUT,
], { maxBuffer: 200 * 1024 * 1024 });

const outStat = await fs.stat(OUTPUT);
console.log(`✓ Output: ${OUTPUT} (${(outStat.size / 1024 / 1024).toFixed(1)}MB)`);

// Extract sample frames
console.log("\nExtracting sample frames...");
for (const t of [5, 15, 30, 45]) {
  await execFileAsync("ffmpeg", ["-ss", String(t), "-i", OUTPUT, "-vframes", "1", "-update", "1", "-y", `/tmp/bc_frame_${t}s.jpg`]);
  console.log(`  /tmp/bc_frame_${t}s.jpg`);
}

// Clean up segment files
for (const f of segmentFiles) await fs.unlink(f).catch(() => {});

console.log("\n=== Done ===");
