/**
 * Test script: renders one caption frame per template using a long word
 * that historically overflowed the right edge ("AUTOMÁTICAMENTE").
 *
 * Run with:
 *   cd artifacts/api-server && npx tsx scripts/test-caption-overflow.ts
 *
 * Saves PNGs to /tmp/caption-overflow-test/ and prints pass/fail per template.
 */
import path from "path";
import fs from "fs/promises";
import { BROWSER_CAPTION_TEMPLATES, getBrowserTemplate } from "@workspace/caption-templates";
import {
  scaleToHeight,
  getBaselineY,
  getSafeMarginX,
  formatWord,
} from "@workspace/caption-templates";

const OUT_DIR = "/tmp/caption-overflow-test";

// ── Video dimensions for this test ──────────────────────────────────────────
const VIDEO_W = 720;
const VIDEO_H = 1280;
const WORD_GAP_FACTOR = 0.18;

// ── Canvas loader (same as engine) ───────────────────────────────────────────
async function loadCanvas() {
  try {
    const mod = await import("@napi-rs/canvas");
    const FONTS_DIR = path.join(__dirname, "../src/assets/fonts");
    const fontFiles = [
      { file: "Oswald-Bold.ttf",       family: "Oswald" },
      { file: "Oswald.ttf",            family: "Oswald" },
      { file: "Poppins-ExtraBold.ttf", family: "Poppins" },
      { file: "Bangers-Regular.ttf",   family: "Bangers" },
    ];
    for (const { file, family } of fontFiles) {
      const fp = path.join(FONTS_DIR, file);
      try { mod.GlobalFonts.registerFromPath(fp, family); } catch {}
    }
    return mod;
  } catch {
    return null;
  }
}

// ── Wrap helper ───────────────────────────────────────────────────────────────
function buildWrappedLines(measurements: number[], wordGap: number, availableW: number) {
  const lines: Array<{ wordIndices: number[]; lineWidth: number }> = [];
  let cur: number[] = [], curW = 0;
  for (let i = 0; i < measurements.length; i++) {
    const w = measurements[i];
    const gap = cur.length > 0 ? wordGap : 0;
    if (cur.length > 0 && curW + gap + w > availableW) {
      lines.push({ wordIndices: cur, lineWidth: curW });
      cur = [i]; curW = w;
    } else {
      cur.push(i); curW += gap + w;
    }
  }
  if (cur.length > 0) lines.push({ wordIndices: cur, lineWidth: curW });
  return lines;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const canvas = await loadCanvas();
  if (!canvas) { console.error("Canvas unavailable"); process.exit(1); }

  // Test cue: the exact long word that caused the bug, shown as the active word
  const testWords = ["AUTOMÁTICAMENTE"];

  let allPassed = true;

  for (const tmpl of BROWSER_CAPTION_TEMPLATES) {
    const template = getBrowserTemplate(tmpl.id)!;
    const cue = {
      index: 0,
      startMs: 0,
      endMs: 1000,
      words: testWords.map(t => ({ text: t })),
      activeWordIndex: 0,
    };

    // ── Render (mirrors renderCueFrame logic exactly) ─────────────────────
    const cvs = canvas.createCanvas(VIDEO_W, VIDEO_H);
    const ctx = cvs.getContext("2d");
    ctx.clearRect(0, 0, VIDEO_W, VIDEO_H);

    const fontSize   = Math.round(scaleToHeight(template.fontSize, VIDEO_H));
    const marginX    = getSafeMarginX(template, VIDEO_W);
    const availableW = VIDEO_W - 2 * marginX;

    const displayWords = cue.words.map(w => formatWord(w.text, template));

    const measureWords = (fs: number) =>
      displayWords.map((word, i) => {
        const isActive  = i === cue.activeWordIndex;
        const scale     = isActive && template.highlightMode === "scale" ? template.activeWordScale : 1.0;
        ctx.font = `${template.fontWeight} ${Math.round(fs * scale)}px '${template.fontFamily}'`;
        return ctx.measureText(word).width;
      });

    let measurements = measureWords(fontSize);
    const maxWordW   = measurements.length > 0 ? Math.max(...measurements) : 0;
    let effectiveFontSize = fontSize;
    if (maxWordW > availableW && maxWordW > 0) {
      effectiveFontSize = Math.max(Math.floor(fontSize * (availableW / maxWordW)), 1);
      measurements = measureWords(effectiveFontSize);
    }

    const wordGap   = Math.round(effectiveFontSize * WORD_GAP_FACTOR);
    const lineSpace = Math.round(effectiveFontSize * template.lineHeight);
    const baselineY = getBaselineY(template, VIDEO_H);
    const outlineW  = scaleToHeight(template.outlineWidth, VIDEO_H);
    const shadowX   = scaleToHeight(template.shadowOffsetX, VIDEO_H);
    const shadowY   = scaleToHeight(template.shadowOffsetY, VIDEO_H);
    const shadowB   = scaleToHeight(template.shadowBlur, VIDEO_H);

    const lines = buildWrappedLines(measurements, wordGap, availableW);

    for (let li = 0; li < lines.length; li++) {
      const { wordIndices, lineWidth } = lines[li];
      const lineY = baselineY - (lines.length - 1 - li) * lineSpace;
      const lineX = Math.max(marginX, (VIDEO_W - lineWidth) / 2);
      let x = lineX;

      for (const wi of wordIndices) {
        const word      = displayWords[wi];
        const isActive  = wi === cue.activeWordIndex;
        const scale     = isActive && template.highlightMode === "scale" ? template.activeWordScale : 1.0;
        const wFontSz   = Math.round(effectiveFontSize * scale);
        const color     = isActive ? template.activeWordColor : template.primaryColor;
        const alpha     = isActive ? 1.0 : template.inactiveOpacity;
        const wordWidth = measurements[wi];

        ctx.save();
        ctx.font = `${template.fontWeight} ${wFontSz}px '${template.fontFamily}'`;
        ctx.textBaseline = "alphabetic";
        ctx.shadowColor   = template.shadowColor;
        ctx.shadowOffsetX = shadowX;
        ctx.shadowOffsetY = shadowY;
        ctx.shadowBlur    = shadowB;

        if (outlineW > 0) {
          ctx.strokeStyle = template.outlineColor;
          ctx.lineWidth   = outlineW * 2;
          ctx.lineJoin    = "round";
          ctx.globalAlpha = alpha;
          ctx.strokeText(word, x, lineY);
        }

        ctx.fillStyle   = color;
        ctx.globalAlpha = alpha;
        ctx.fillText(word, x, lineY);
        ctx.restore();
        x += wordWidth + wordGap;
      }
    }

    // ── Overflow check: verify right edge of drawn text ──────────────────
    const maxLineWidth = Math.max(...lines.map(l => l.lineWidth));
    const firstLineX   = Math.max(marginX, (VIDEO_W - maxLineWidth) / 2);
    const rightEdge    = firstLineX + maxLineWidth;

    const PASSES = rightEdge <= VIDEO_W - marginX + 1; // +1 for rounding

    // ── Save PNG ──────────────────────────────────────────────────────────
    const pngPath = path.join(OUT_DIR, `${template.id}.png`);
    await fs.writeFile(pngPath, await cvs.encode("png"));

    const status = PASSES ? "✅ PASS" : "❌ FAIL";
    console.log(
      `${status}  ${template.name.padEnd(20)}  ` +
      `fontSize=${fontSize}→${effectiveFontSize}  ` +
      `word=${maxWordW.toFixed(0)}px  ` +
      `available=${availableW.toFixed(0)}px  ` +
      `rightEdge=${rightEdge.toFixed(0)}px  ` +
      `limit=${(VIDEO_W - marginX).toFixed(0)}px`
    );

    if (!PASSES) allPassed = false;
  }

  console.log("\nPNGs saved to:", OUT_DIR);
  process.exit(allPassed ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
