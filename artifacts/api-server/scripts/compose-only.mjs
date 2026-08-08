/**
 * Compose-only: runs FFmpeg batch compositing using already-rendered PNGs.
 * Run with: TEST_TEMPLATE=viral_stack tsx scripts/compose-only.mjs
 */
import path from "path";
import fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import axios from "axios";
import { fileURLToPath } from "url";
import { getBrowserTemplate, buildCaptionCues } from "@workspace/caption-templates";

const execFileAsync = promisify(execFile);
const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ID  = process.env.TEST_TEMPLATE || "viral_stack";
const TMP_DIR      = `/tmp/template_test_${TEMPLATE_ID}`;
const OUTPUT       = `/tmp/template_test_${TEMPLATE_ID}.mp4`;
const MAX_BATCH    = 15;
const DURATION_SECONDS = 61;

const SUBTITLE_URL = process.env.TEST_SUBTITLE_URL || null;
const SCRIPT = `¿Y si tu próximo video no necesitara cámaras, luces ni una hora frente al espejo? No te estoy diciendo que contratar y crear videos profesionales sea una pérdida de tiempo y dinero. De hecho, ese contenido puede transmitir mucha confianza y personalidad. Pero si cada publicación depende de una producción completa, tu calendario puede quedarse más vacío que una bandeja de entrada un lunes. Ahí entra un avatar digital tuyo. Puedes alternarlo con tus videos habituales para explicar automatizaciones, responder preguntas frecuentes, presentar un chatbot o compartir consejos de inteligencia artificial en minutos. Así mantienes la constancia sin convertir cada Reel en una producción de cine. La clave no es reemplazarte, sino darte otra forma de aparecer y comunicar. Este video fue creado con mi avatar con inteligencia artificial. Sígueme y te ayudo a crear algo así para tu negocio.`;

function parseSRT(srt) {
  const blocks = srt.trim().split(/\n\n+/);
  const out = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length < 3) continue;
    const m = lines[1].match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/);
    if (!m) continue;
    const startMs = (+m[1]*3600 + +m[2]*60 + +m[3]) * 1000 + +m[4];
    const endMs   = (+m[5]*3600 + +m[6]*60 + +m[7]) * 1000 + +m[8];
    const words   = lines.slice(2).join(" ").trim().split(/\s+/).filter(Boolean);
    const msEach  = (endMs - startMs) / Math.max(words.length, 1);
    words.forEach((text, i) => out.push({ text, startMs: Math.round(startMs + i * msEach), endMs: Math.round(startMs + (i+1) * msEach) }));
  }
  return out;
}

function buildFallback(script, dur) {
  const tokens = script.split(/\s+/).filter(Boolean);
  const msEach = (dur * 1000) / Math.max(tokens.length, 1);
  return tokens.map((text, i) => ({ text, startMs: Math.round(i * msEach), endMs: Math.round((i+1) * msEach) }));
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`=== Compose-only: ${TEMPLATE_ID} ===`);

const videoPath = path.join(TMP_DIR, "input.mp4");
await fs.access(videoPath).catch(() => { throw new Error(`Video not found at ${videoPath}`); });

// Rebuild cue timing (same logic as render script)
let wordTimings = [];
if (SUBTITLE_URL) {
  try {
    const r = await axios.get(SUBTITLE_URL, { timeout: 15_000 });
    wordTimings = parseSRT(r.data);
    console.log(`SRT: ${wordTimings.length} words`);
  } catch(e) { console.warn(`SRT failed: ${e.message}`); }
}
if (!wordTimings.length) {
  wordTimings = buildFallback(SCRIPT, DURATION_SECONDS);
  console.log(`Fallback timings: ${wordTimings.length} words`);
}

const template = getBrowserTemplate(TEMPLATE_ID);
const cues     = buildCaptionCues(wordTimings, template).slice(0, 400);
console.log(`${cues.length} cues`);

const segments = cues.map((cue, i) => ({
  pngPath : path.join(TMP_DIR, `cue_${String(i).padStart(4,"0")}.png`),
  startSec: cue.startMs / 1000,
  endSec  : (i + 1 < cues.length ? cues[i+1].startMs : cue.endMs) / 1000,
}));

// Verify PNGs exist
let missing = 0;
for (const s of segments) { try { await fs.access(s.pngPath); } catch { missing++; } }
if (missing) throw new Error(`${missing} PNG files missing — run full render first`);
console.log(`✓ All ${segments.length} PNGs present`);

// Source dimensions
const { stdout: probeOut } = await execFileAsync("ffprobe", ["-v","quiet","-print_format","json","-show_streams", videoPath]);
const vstream = JSON.parse(probeOut).streams.find(s => s.codec_type === "video");
const VW = vstream.width, VH = vstream.height;
console.log(`Source: ${VW}×${VH}`);

// Process each batch sequentially
const batches = [];
for (let i = 0; i < segments.length; i += MAX_BATCH) batches.push(segments.slice(i, i + MAX_BATCH));
console.log(`${batches.length} batches`);

const segFiles = [];
for (let b = 0; b < batches.length; b++) {
  const segOut = path.join(TMP_DIR, `seg_${String(b).padStart(3,"0")}.mp4`);

  // Skip if already done (resume after crash)
  try {
    await fs.access(segOut);
    const stat = await fs.stat(segOut);
    if (stat.size > 10_000) {
      console.log(`  Batch ${b+1}/${batches.length} already done (skip)`);
      segFiles.push(segOut);
      continue;
    }
  } catch {}

  const batch = batches[b];
  const bStart = batch[0].startSec;
  const bEnd   = batches[b+1] ? batches[b+1][0].startSec : batch[batch.length-1].endSec;
  const bDur   = bEnd - bStart;

  const extraInputs = [], filterParts = [];
  let prevLabel = "[base]";
  batch.forEach(({ pngPath, startSec, endSec }, i) => {
    extraInputs.push("-i", pngPath);
    const relS = (startSec - bStart).toFixed(3), relE = (endSec - bStart).toFixed(3);
    const inL = `[cap${i}]`, outL = i < batch.length-1 ? `[ov${i}]` : "[out]";
    filterParts.push(`[${i+1}:v]scale=${VW}:${VH}${inL}`);
    filterParts.push(`${prevLabel}${inL}overlay=0:0:enable='between(t,${relS},${relE})'${outL}`);
    prevLabel = outL;
  });

  await execFileAsync("ffmpeg", [
    "-ss", String(bStart), "-t", String(bDur), "-i", videoPath,
    ...extraInputs,
    "-filter_complex", `[0:v]setpts=PTS-STARTPTS[base]; ${filterParts.join("; ")}`,
    "-map", "[out]", "-map", "0:a?",
    "-c:v", "libx264", "-preset", "fast", "-crf", "21",
    "-c:a", "aac", "-b:a", "128k", "-y", segOut,
  ], { maxBuffer: 100 * 1024 * 1024 });
  segFiles.push(segOut);
  console.log(`  Batch ${b+1}/${batches.length} done`);
}

// Concatenate
const segList = path.join(TMP_DIR, "seg_list.txt");
await fs.writeFile(segList, segFiles.map(f => `file '${f}'`).join("\n"));
await execFileAsync("ffmpeg", ["-f","concat","-safe","0","-i",segList,"-c","copy","-y",OUTPUT], { maxBuffer: 200*1024*1024 });

const stat = await fs.stat(OUTPUT);
console.log(`\n✓ Output: ${OUTPUT} (${(stat.size/1024/1024).toFixed(1)}MB)`);

for (const t of [5, 15, 30, 45]) {
  await execFileAsync("ffmpeg", ["-ss", String(t), "-i", OUTPUT, "-vframes","1","-update","1","-y", `/tmp/vs_frame_${t}s.jpg`]);
}
console.log("Frames extracted.");
