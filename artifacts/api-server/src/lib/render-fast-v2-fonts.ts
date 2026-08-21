import fs from "fs/promises";
import path from "path";

import { CAPTION_FONTS_DIR } from "./caption-engine";

/**
 * Fast V2 uses libass, while Caption Studio and the Browser Caption Engine use
 * @napi-rs/canvas. Pin each supported Studio family to the same bundled source
 * file Canvas registers rather than letting fontconfig choose a similarly named
 * system face.
 */
export type FastV2FontFace = {
  sourceFile: string;
  assFontName: string;
  assBold: 0 | -1;
};

const FAST_V2_FONT_FACES: Record<string, FastV2FontFace> = {
  Poppins: {
    sourceFile: "Poppins-ExtraBold.ttf",
    assFontName: "Poppins ExtraBold",
    assBold: 0,
  },
  Oswald: {
    // Oswald-Bold.ttf and Oswald.ttf are byte-identical variable fonts. The
    // Browser engine registers both and asks Canvas for Oswald 700; keeping
    // only this source file in libass's directory guarantees the same TTF.
    sourceFile: "Oswald-Bold.ttf",
    assFontName: "Oswald",
    assBold: -1,
  },
  Bangers: {
    sourceFile: "Bangers-Regular.ttf",
    assFontName: "Bangers Regular",
    assBold: 0,
  },
  Montserrat: {
    sourceFile: "Montserrat-Black.ttf",
    assFontName: "Montserrat Black",
    assBold: 0,
  },
};

export function resolveFastV2FontFace(fontFamily: string): FastV2FontFace | null {
  return FAST_V2_FONT_FACES[fontFamily] ?? null;
}

/**
 * libass considers every file in fontsdir a candidate. Give each Fast V2
 * render a directory containing only its intended Canvas TTF so no bundled or
 * system sibling can win font matching.
 */
export async function stageFastV2Font(face: FastV2FontFace, renderTmpDir: string): Promise<string> {
  const fontsDir = path.join(renderTmpDir, "fonts");
  await fs.mkdir(fontsDir, { recursive: true });
  await fs.copyFile(
    path.join(CAPTION_FONTS_DIR, face.sourceFile),
    path.join(fontsDir, face.sourceFile),
  );
  return fontsDir;
}

/**
 * Caption artifacts are shared with the legacy renderer. Rewrite only the
 * Fast V2 copy so legacy ASS generation and its font resolution are untouched.
 * All generated styles in an ASS artifact use the selected template family.
 */
export function pinFastV2AssFont(ass: string, face: FastV2FontFace): string {
  return ass.split("\n").map((line) => {
    if (!line.startsWith("Style: ")) return line;

    const fields = line.slice("Style: ".length).split(",");
    if (fields.length < 8) return line;

    // ASS V4+ style format: Name, Fontname, …, BackColour, Bold, …
    fields[1] = face.assFontName;
    fields[7] = String(face.assBold);
    return `Style: ${fields.join(",")}`;
  }).join("\n");
}