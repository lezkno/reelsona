/**
 * Tests any browser caption template on video 20.
 * Usage: TEST_TEMPLATE=viral_stack ../../scripts/node_modules/.bin/tsx scripts/test-template.mjs
 *
 * Reuses /tmp/browser_caption_test_work/input.mp4 if present, otherwise downloads it.
 * Output: /tmp/template_test_<id>.mp4
 */
import path from "path";
import fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import axios from "axios";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEMPLATE_ID  = process.env.TEST_TEMPLATE || "viral_stack";
const TMP_DIR      = `/tmp/template_test_${TEMPLATE_ID}`;
const SRC_VIDEO    = "/tmp/browser_caption_test_work/input.mp4";  // reuse if exists
const VIDEO_URL    = "https://files2.heygen.ai/aws_pacific/avatar_tmp/3c569a30ba7d4d0ca227933ec00d35ac/7c90f0b745e542d397e6c8c02aa5f5be.mp4?Expires=1786808233&Signature=PzR3yIfXa~h31-MZY8yY6ArwdUsp8Hh6jvlijwRgNqCeGR6KH7gP8BCgeVQ47oUe4bmBANguqETTUNcqQImR~2k8rFWxaLNoZDmUzBgfVN9ybaqn7dkUqxj1dHA8nZCQmmXg4p0FzTaZ6Qd3RMCGCiXY9IotnO371MobP2feUsJWfgG9jZYsrQZ3j5NNIc8Np~FGrzT6DZYuas0BG7eBfhfes~ugXWvwKsRqg8Kwr2dO8TsNLO2RFsllKcRxtfcx6lDAwQYI~ZQj~RK7G6Wd5Xc-QMmwohMd0ZonGG0iScnK0NqHR9-nIqfN0PM42vMQzXW~1CkJ5v6uv0Z2Q1pIMQ__&Key-Pair-Id=K38HBHX5LX3X2H";
const SUBTITLE_URL = process.env.TEST_SUBTITLE_URL || null;
const OUTPUT       = `/tmp/template_test_${TEMPLATE_ID}.mp4`;
const FONTS_DIR    = path.join(__dirname, "../src/assets/fonts");
const DURATION_SECONDS = 61;
// Video dimensions are probed dynamically — these are fallback defaults only
const VIDEO_WIDTH_DEFAULT  = 1080;
const VIDEO_HEIGHT_DEFAULT = 1920;
const WORD_GAP_FACTOR = 0.18;
const MAX_BATCH    = 30;

const SCRIPT = `¿Y si tu próximo video no necesitara cámaras, luces ni una hora frente al espejo? No te estoy diciendo que contratar y crear videos profesionales sea una pérdida de tiempo y dinero. De hecho, ese contenido puede transmitir mucha confianza y personalidad. Pero si cada publicación depende de una producción completa, tu calendario puede quedarse más vacío que una bandeja de entrada un lunes. Ahí entra un avatar digital tuyo. Puedes alternarlo con tus videos habituales para explicar automatizaciones, responder preguntas frecuentes, presentar un chatbot o compartir consejos de inteligencia artificial en minutos. Así mantienes la constancia sin convertir cada Reel en una producción de cine. La clave no es reemplazarte, sino darte otra forma de aparecer y comunicar. Este video fue creado con mi avatar con inteligencia artificial. Sígueme y te ayudo a crear algo así para tu negocio.`;

// ── Imports ───────────────────────────────────────────────────────────────────
const { default: canvasMod } = await import("@napi-rs/canvas").catch(() => ({ default: null }));
import {
  getBrowserTemplate, buildCaptionCues, formatWord,
  getBaselineY, getSafeMarginX, scaleToHeight,
} from "@workspace/caption-templates";

// ── Helpers ───────────────────────────────────────────────────────────────────
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

function buildWrappedLines(measurements, wordGap, availableW) {
  const lines = [];
  let cur = [], curW = 0;
  for (let i = 0; i < measurements.length; i++) {
    const ww = measurements[i], gw = cur.length > 0 ? wordGap : 0;
    if (cur.length > 0 && curW + gw + ww > availableW) {
      lines.push({ wordIndices: cur, lineWidth: curW });
      cur = [i]; curW = ww;
    } else { cur.push(i); curW += gw + ww; }
  }
  if (cur.length > 0) lines.push({ wordIndices: cur, lineWidth: curW });
  return lines;
}

/**
 * Render one cue frame at the actual video dimensions.
 * videoW/videoH must match the source video — PNG composited at the same size.
 */
async function renderCueFrame(canvas, template, cue,
  videoW = VIDEO_WIDTH_DEFAULT, videoH = VIDEO_HEIGHT_DEFAULT) {
  const cvs = canvas.createCanvas(videoW, videoH);
  const ctx = cvs.getContext("2d");
  ctx.clearRect(0, 0, videoW, videoH);

  const fontSize    = Math.round(scaleToHeight(template.fontSize, videoH));
  const outlineW    = scaleToHeight(template.outlineWidth, videoH);
  const shadowX     = scaleToHeight(template.shadowOffsetX, videoH);
  const shadowY     = scaleToHeight(template.shadowOffsetY, videoH);
  const shadowBlur  = scaleToHeight(template.shadowBlur, videoH);
  const baselineY   = getBaselineY(template, videoH);
  const marginX     = getSafeMarginX(template, videoW);
  const wordGap     = Math.round(fontSize * WORD_GAP_FACTOR);
  const availableW  = videoW - 2 * marginX;
  const lineSpacing = Math.round(fontSize * template.lineHeight);

  const displayWords = cue.words.map(w => formatWord(w.text, template));

  const measurements = displayWords.map((word, i) => {
    const isActive   = i === cue.activeWordIndex;
    const wordScale  = isActive && template.highlightMode === "scale" ? template.activeWordScale : 1.0;
    ctx.font = `${template.fontWeight} ${Math.round(fontSize * wordScale)}px '${template.fontFamily}'`;
    return ctx.measureText(word).width;
  });

  const lines = buildWrappedLines(measurements, wordGap, availableW);

  for (let li = 0; li < lines.length; li++) {
    const { wordIndices, lineWidth } = lines[li];
    const lineY = baselineY - (lines.length - 1 - li) * lineSpacing;
    const lineX = Math.max(marginX, (videoW - lineWidth) / 2);
    let x = lineX;

    for (const wi of wordIndices) {
      const word       = displayWords[wi];
      const isActive   = wi === cue.activeWordIndex;
      const wordFontSz = Math.round(fontSize * (isActive && template.highlightMode === "scale" ? template.activeWordScale : 1.0));
      const color      = isActive ? template.activeWordColor : template.primaryColor;
      const alpha      = isActive ? 1.0 : template.inactiveOpacity;
      const wordWidth  = measurements[wi];

      ctx.save();
      ctx.font = `${template.fontWeight} ${wordFontSz}px '${template.fontFamily}'`;
      ctx.textBaseline = "alphabetic";
      ctx.shadowColor = template.shadowColor;
      ctx.shadowOffsetX = shadowX; ctx.shadowOffsetY = shadowY; ctx.shadowBlur = shadowBlur;

      // Background box: "word" = all words, "active_word" = active only
      const wantsBox = template.backgroundColor != null &&
        (template.backgroundMode === "word" ||
         (template.backgroundMode === "active_word" && isActive));
      if (wantsBox) {
        const padX = scaleToHeight(template.backgroundPaddingX, videoH);
        const padY = scaleToHeight(template.backgroundPaddingY, videoH);
        const r    = scaleToHeight(template.backgroundRadius,   videoH);
        ctx.save();
        ctx.shadowColor = "transparent";
        ctx.fillStyle   = template.backgroundColor;
        const boxX = x - padX;
        const boxY = lineY - wordFontSz - padY;
        const boxW = wordWidth + padX * 2;
        const boxH = wordFontSz * 1.25 + padY * 2;
        ctx.beginPath();
        if (r > 0 && typeof ctx.roundRect === "function") {
          ctx.roundRect(boxX, boxY, boxW, boxH, r);
        } else {
          ctx.rect(boxX, boxY, boxW, boxH);
        }
        ctx.fill();
        ctx.restore();
      }

      if (outlineW > 0) {
        ctx.strokeStyle = template.outlineColor;
        ctx.lineWidth = outlineW * 2; ctx.lineJoin = "round";
        ctx.globalAlpha = alpha;
        ctx.strokeText(word, x, lineY);
      }
      ctx.fillStyle = color; ctx.globalAlpha = alpha;
      ctx.fillText(word, x, lineY);
      ctx.restore();
      x += wordWidth + wordGap;
    }
  }
  return cvs.encode("png");
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`=== Browser Caption Template Test: ${TEMPLATE_ID} ===`);
if (!canvasMod) { console.error("@napi-rs/canvas not available"); process.exit(1); }

for (const [file, family] of [["Oswald-Bold.ttf","Oswald"],["Oswald.ttf","Oswald"],["Poppins-ExtraBold.ttf","Poppins"],["Bangers-Regular.ttf","Bangers"]]) {
  try { canvasMod.GlobalFonts.registerFromPath(path.join(FONTS_DIR, file), family); } catch {}
}

const template = getBrowserTemplate(TEMPLATE_ID);
if (!template) { console.error(`Template "${TEMPLATE_ID}" not found`); process.exit(1); }
console.log(`Template: ${template.name} | wordsPerLine=${template.wordsPerLine} | fontSize=${template.fontSize} | uppercase=${template.uppercase}`);
console.log(`  yPercent=${template.yPercent}% | activeColor=${template.activeWordColor}`);

await fs.mkdir(TMP_DIR, { recursive: true });

// Video: reuse downloaded copy if available
let videoPath = path.join(TMP_DIR, "input.mp4");
try {
  await fs.access(videoPath);
  console.log("✓ Video already in work dir");
} catch {
  // Try to copy from previous test dir
  try {
    await fs.copyFile(SRC_VIDEO, videoPath);
    console.log("✓ Video copied from previous download");
  } catch {
    console.log("Downloading video...");
    const resp = await axios.get(VIDEO_URL, { responseType: "arraybuffer", timeout: 120_000 });
    await fs.writeFile(videoPath, Buffer.from(resp.data));
    console.log(`✓ Video downloaded (${(resp.data.byteLength/1024/1024).toFixed(1)}MB)`);
  }
}

// SRT timings
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

const cues = buildCaptionCues(wordTimings, template).slice(0, 400);
console.log(`Cues: ${cues.length} (wordsPerLine=${template.wordsPerLine})`);

// Probe video dimensions BEFORE rendering PNGs — PNGs must match source resolution
const { stdout: probeOut } = await execFileAsync("ffprobe", ["-v","quiet","-print_format","json","-show_streams", videoPath]);
const vstream = JSON.parse(probeOut).streams.find(s => s.codec_type === "video");
const VW = vstream?.width  ?? VIDEO_WIDTH_DEFAULT;
const VH = vstream?.height ?? VIDEO_HEIGHT_DEFAULT;
console.log(`Source: ${VW}×${VH} (PNGs will render at this resolution)`);

// Render PNGs at actual video dimensions
console.log("\nRendering PNGs...");
const segments = [];
for (let i = 0; i < cues.length; i++) {
  const cue = cues[i];
  const endMs = i + 1 < cues.length ? cues[i+1].startMs : cue.endMs;
  const png = await renderCueFrame(canvasMod, template, cue, VW, VH);
  const pngPath = path.join(TMP_DIR, `cue_${String(i).padStart(4,"0")}.png`);
  await fs.writeFile(pngPath, png);
  segments.push({ pngPath, startSec: cue.startMs / 1000, endSec: endMs / 1000 });
  if (i % 30 === 0) process.stdout.write(`  ${i}/${cues.length}...\n`);
}
console.log(`✓ ${segments.length} PNGs rendered`);

// Batch-segment composite
console.log("\nCompositing (batch-segment)...");
const batches = [];
for (let i = 0; i < segments.length; i += MAX_BATCH) batches.push(segments.slice(i, i + MAX_BATCH));
console.log(`${batches.length} batches`);

const segFiles = [];
for (let b = 0; b < batches.length; b++) {
  const batch = batches[b];
  const bStart = batch[0].startSec;
  const bEnd   = batches[b+1] ? batches[b+1][0].startSec : batch[batch.length-1].endSec;
  const bDur   = bEnd - bStart;
  const segOut = path.join(TMP_DIR, `seg_${String(b).padStart(3,"0")}.mp4`);

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
  process.stdout.write(`  Batch ${b+1}/${batches.length} done\n`);
}

// Concatenate
const segList = path.join(TMP_DIR, "seg_list.txt");
await fs.writeFile(segList, segFiles.map(f => `file '${f}'`).join("\n"));
await execFileAsync("ffmpeg", ["-f","concat","-safe","0","-i",segList,"-c","copy","-y",OUTPUT], { maxBuffer: 200*1024*1024 });

const stat = await fs.stat(OUTPUT);
console.log(`\n✓ Output: ${OUTPUT} (${(stat.size/1024/1024).toFixed(1)}MB)`);

// Extract frames
console.log("Extracting frames...");
for (const t of [5, 15, 30, 45]) {
  await execFileAsync("ffmpeg", ["-ss", String(t), "-i", OUTPUT, "-vframes","1","-update","1","-y", `/tmp/vs_frame_${t}s.jpg`]);
}
console.log("=== Done ===");
