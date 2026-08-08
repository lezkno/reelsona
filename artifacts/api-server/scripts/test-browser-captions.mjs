/**
 * Direct test of the Browser Caption Engine on an existing HeyGen video.
 * Saves output to /tmp/browser_caption_test.mp4 — no Object Storage needed.
 *
 * Usage: node --enable-source-maps scripts/test-browser-captions.mjs
 * Or:    cd artifacts/api-server && pnpm exec tsx scripts/test-browser-captions.mjs
 */

import path from "path";
import fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import axios from "axios";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);
const __dirname   = path.dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────
const TEMPLATE_ID = "clean_coach";
const VIDEO_URL   = process.env.TEST_VIDEO_URL ||
  // Video 20 — existing HeyGen video, no generation needed
  "https://files2.heygen.ai/aws_pacific/avatar_tmp/3c569a30ba7d4d0ca227933ec00d35ac/7c90f0b745e542d397e6c8c02aa5f5be.mp4?Expires=1786808233&Signature=PzR3yIfXa~h31-MZY8yY6ArwdUsp8Hh6jvlijwRgNqCeGR6KH7gP8BCgeVQ47oUe4bmBANguqETTUNcqQImR~2k8rFWxaLNoZDmUzBgfVN9ybaqn7dkUqxj1dHA8nZCQmmXg4p0FzTaZ6Qd3RMCGCiXY9IotnO371MobP2feUsJWfgG9jZYsrQZ3j5NNIc8Np~FGrzT6DZYuas0BG7eBfhfes~ugXWvwKsRqg8Kwr2dO8TsNLO2RFsllKcRxtfcx6lDAwQYI~ZQj~RK7G6Wd5Xc-QMmwohMd0ZonGG0iScnK0NqHR9-nIqfN0PM42vMQzXW~1CkJ5v6uv0Z2Q1pIMQ__&Key-Pair-Id=K38HBHX5LX3X2H";

const SUBTITLE_URL = process.env.TEST_SUBTITLE_URL || null;

const SCRIPT = `¿Y si tu próximo video no necesitara cámaras, luces ni una hora frente al espejo? No te estoy diciendo que contratar y crear videos profesionales sea una pérdida de tiempo y dinero. De hecho, ese contenido puede transmitir mucha confianza y personalidad. Pero si cada publicación depende de una producción completa, tu calendario puede quedarse más vacío que una bandeja de entrada un lunes. Ahí entra un avatar digital tuyo. Puedes alternarlo con tus videos habituales para explicar automatizaciones, responder preguntas frecuentes, presentar un chatbot o compartir consejos de inteligencia artificial en minutos. Así mantienes la constancia sin convertir cada Reel en una producción de cine. La clave no es reemplazarte, sino darte otra forma de aparecer y comunicar. Este video fue creado con mi avatar con inteligencia artificial. Sígueme y te ayudo a crear algo así para tu negocio.`;

const DURATION_SECONDS = 61;
const OUTPUT_PATH      = "/tmp/browser_caption_test.mp4";
const TMP_DIR          = "/tmp/browser_caption_test_work";
const VIDEO_WIDTH      = 1080;
const VIDEO_HEIGHT     = 1920;
const WORD_GAP_FACTOR  = 0.18;
const FONTS_DIR        = path.join(__dirname, "../src/assets/fonts");

// ── Canvas & templates (same imports as browser-caption-engine.ts) ────────────
const { default: canvasMod } = await import("@napi-rs/canvas").catch(() => ({ default: null }));

import {
  getBrowserTemplate,
  buildCaptionCues,
  formatWord,
  getBaselineY,
  getSafeMarginX,
  scaleToHeight,
} from "@workspace/caption-templates";

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseSRT(srt) {
  const blocks = srt.trim().split(/\n\n+/);
  const timings = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length < 3) continue;
    const timeLine = lines[1];
    const m = timeLine.match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/);
    if (!m) continue;
    const startMs = (+m[1]*3600 + +m[2]*60 + +m[3]) * 1000 + +m[4];
    const endMs   = (+m[5]*3600 + +m[6]*60 + +m[7]) * 1000 + +m[8];
    const text    = lines.slice(2).join(" ").trim();
    const words   = text.split(/\s+/).filter(Boolean);
    const msEach  = (endMs - startMs) / Math.max(words.length, 1);
    words.forEach((word, i) => {
      timings.push({ text: word, startMs: Math.round(startMs + i * msEach), endMs: Math.round(startMs + (i+1) * msEach) });
    });
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

async function renderCueFrame(canvas, template, cue) {
  const cvs = canvas.createCanvas(VIDEO_WIDTH, VIDEO_HEIGHT);
  const ctx = cvs.getContext("2d");
  ctx.clearRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);

  const fontSize   = Math.round(scaleToHeight(template.fontSize, VIDEO_HEIGHT));
  const outlineW   = scaleToHeight(template.outlineWidth, VIDEO_HEIGHT);
  const shadowX    = scaleToHeight(template.shadowOffsetX, VIDEO_HEIGHT);
  const shadowY    = scaleToHeight(template.shadowOffsetY, VIDEO_HEIGHT);
  const shadowBlur = scaleToHeight(template.shadowBlur, VIDEO_HEIGHT);
  const baselineY  = getBaselineY(template, VIDEO_HEIGHT);
  const marginX    = getSafeMarginX(template, VIDEO_WIDTH);
  const wordGap    = Math.round(fontSize * WORD_GAP_FACTOR);

  const displayWords = cue.words.map(w => formatWord(w.text, template));

  const measurements = displayWords.map((word, i) => {
    const isActive   = i === cue.activeWordIndex;
    const wordScale  = isActive && template.highlightMode === "scale" ? template.activeWordScale : 1.0;
    const wordFontSz = Math.round(fontSize * wordScale);
    ctx.font = `${template.fontWeight} ${wordFontSz}px '${template.fontFamily}'`;
    return ctx.measureText(word).width;
  });

  const totalWidth = measurements.reduce((sum, w, i) => sum + w + (i < measurements.length - 1 ? wordGap : 0), 0);
  let x = Math.max(marginX, (VIDEO_WIDTH - totalWidth) / 2);

  displayWords.forEach((word, i) => {
    const isActive   = i === cue.activeWordIndex;
    const wordScale  = isActive && template.highlightMode === "scale" ? template.activeWordScale : 1.0;
    const wordFontSz = Math.round(fontSize * wordScale);
    const color      = isActive ? template.activeWordColor : template.primaryColor;
    const alpha      = isActive ? 1.0 : template.inactiveOpacity;
    const wordWidth  = measurements[i];

    ctx.save();
    ctx.font         = `${template.fontWeight} ${wordFontSz}px '${template.fontFamily}'`;
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor  = template.shadowColor;
    ctx.shadowOffsetX = shadowX;
    ctx.shadowOffsetY = shadowY;
    ctx.shadowBlur   = shadowBlur;

    if (outlineW > 0) {
      ctx.strokeStyle = template.outlineColor;
      ctx.lineWidth   = outlineW * 2;
      ctx.lineJoin    = "round";
      ctx.globalAlpha = alpha;
      ctx.strokeText(word, x, baselineY);
    }

    ctx.fillStyle   = color;
    ctx.globalAlpha = alpha;
    ctx.fillText(word, x, baselineY);
    ctx.restore();

    x += wordWidth + wordGap;
  });

  return cvs.encode("png");
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log("=== Browser Caption Engine Test ===");
console.log(`Template: ${TEMPLATE_ID}`);

if (!canvasMod) {
  console.error("ERROR: @napi-rs/canvas not available");
  process.exit(1);
}
console.log("✓ @napi-rs/canvas loaded");

// Register fonts
const fontFiles = [
  { file: "Oswald-Bold.ttf", family: "Oswald" },
  { file: "Oswald.ttf",      family: "Oswald" },
  { file: "Poppins-ExtraBold.ttf", family: "Poppins" },
  { file: "Bangers-Regular.ttf",   family: "Bangers" },
];
for (const { file, family } of fontFiles) {
  const fontPath = path.join(FONTS_DIR, file);
  try {
    await fs.access(fontPath);
    canvasMod.GlobalFonts.registerFromPath(fontPath, family);
    console.log(`  ✓ Font registered: ${family} (${file})`);
  } catch {
    console.warn(`  ⚠ Font not found: ${fontPath}`);
  }
}

const template = getBrowserTemplate(TEMPLATE_ID);
if (!template) {
  console.error(`ERROR: Template "${TEMPLATE_ID}" not found`);
  process.exit(1);
}
console.log(`✓ Template loaded: ${template.name}`);
console.log(`  primaryColor: ${template.primaryColor}  activeWordColor: ${template.activeWordColor}`);
console.log(`  fontSize: ${template.fontSize}  wordsPerLine: ${template.wordsPerLine}  uppercase: ${template.uppercase}`);
console.log(`  yPercent: ${template.yPercent}%  → baselineY at 1920h = ${getBaselineY(template, 1920)}px`);

await fs.mkdir(TMP_DIR, { recursive: true });

// Download video
console.log("\nDownloading video...");
const videoResp = await axios.get(VIDEO_URL, { responseType: "arraybuffer", timeout: 120_000 });
const videoPath = path.join(TMP_DIR, "input.mp4");
await fs.writeFile(videoPath, Buffer.from(videoResp.data));
const stat = await fs.stat(videoPath);
console.log(`✓ Video downloaded: ${(stat.size / 1024 / 1024).toFixed(1)}MB`);

// Get word timings
let wordTimings = [];
if (SUBTITLE_URL) {
  console.log("\nFetching subtitle SRT...");
  try {
    const srtResp = await axios.get(SUBTITLE_URL, { timeout: 15_000 });
    wordTimings = parseSRT(srtResp.data);
    console.log(`✓ SRT timings parsed: ${wordTimings.length} words`);
  } catch (e) {
    console.warn(`  ⚠ SRT fetch failed: ${e.message}`);
  }
}
if (wordTimings.length === 0) {
  wordTimings = buildFallbackTimings(SCRIPT, DURATION_SECONDS);
  console.log(`✓ Fallback proportional timings: ${wordTimings.length} words`);
}

// Build caption cues
const allCues = buildCaptionCues(wordTimings, template);
const cues    = allCues.slice(0, 400);
console.log(`✓ Caption cues built: ${cues.length} (of ${allCues.length} total)`);

// Render PNG frames
console.log("\nRendering PNG frames...");
const segments = [];
for (let i = 0; i < cues.length; i++) {
  const cue    = cues[i];
  const endMs  = i + 1 < cues.length ? cues[i + 1].startMs : cue.endMs;
  const png    = await renderCueFrame(canvasMod, template, cue);
  const pngPath = path.join(TMP_DIR, `cue_${String(i).padStart(4, "0")}.png`);
  await fs.writeFile(pngPath, png);
  segments.push({ pngPath, startSec: cue.startMs / 1000, endSec: endMs / 1000 });
  if (i % 50 === 0) process.stdout.write(`  ${i}/${cues.length}...\n`);
}
console.log(`✓ ${segments.length} frames rendered`);

// FFmpeg composite
console.log("\nRunning FFmpeg composite...");
const extraInputs  = [];
const filterParts  = [];
let prevLabel      = "[0:v]";

segments.forEach(({ pngPath, startSec, endSec }, i) => {
  extraInputs.push("-i", pngPath);
  const outLabel = i < segments.length - 1 ? `[ov${i}]` : "[vout]";
  filterParts.push(
    `${prevLabel}[${i + 1}:v]overlay=0:0:enable='between(t,${startSec.toFixed(3)},${endSec.toFixed(3)})'${outLabel}`
  );
  prevLabel = outLabel;
});

await execFileAsync("ffmpeg", [
  "-i", videoPath,
  ...extraInputs,
  "-filter_complex", filterParts.join("; "),
  "-map", "[vout]",
  "-map", "0:a?",
  "-c:v", "libx264",
  "-preset", "fast",
  "-crf", "23",
  "-c:a", "copy",
  "-y", OUTPUT_PATH,
], { maxBuffer: 200 * 1024 * 1024 });

const outStat = await fs.stat(OUTPUT_PATH);
console.log(`✓ Output saved: ${OUTPUT_PATH} (${(outStat.size / 1024 / 1024).toFixed(1)}MB)`);
console.log("\nDone! Extracting sample frames...");

// Extract 3 frames for inspection
for (const t of [5, 20, 40]) {
  await execFileAsync("ffmpeg", ["-ss", String(t), "-i", OUTPUT_PATH, "-vframes", "1", "-y", `/tmp/bc_frame_${t}s.jpg`]);
  console.log(`  Frame saved: /tmp/bc_frame_${t}s.jpg`);
}

console.log("\n=== Test complete ===");
