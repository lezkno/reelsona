import assert from "node:assert/strict";
import test from "node:test";

import {
  pinFastV2AssFont,
  resolveFastV2FontFace,
} from "./render-fast-v2-fonts.js";

const sampleAss = `Style: Caption,Poppins,72,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,2,0,0,260,1`;

test("Render Fast V2 pins each Studio family to its Canvas TTF face", () => {
  assert.deepEqual(resolveFastV2FontFace("Poppins"), {
    sourceFile: "Poppins-ExtraBold.ttf",
    assFontName: "Poppins ExtraBold",
    assBold: 0,
  });
  assert.deepEqual(resolveFastV2FontFace("Oswald"), {
    sourceFile: "Oswald-Bold.ttf",
    assFontName: "Oswald",
    assBold: -1,
  });
  assert.deepEqual(resolveFastV2FontFace("Bangers"), {
    sourceFile: "Bangers-Regular.ttf",
    assFontName: "Bangers Regular",
    assBold: 0,
  });
  assert.deepEqual(resolveFastV2FontFace("Montserrat"), {
    sourceFile: "Montserrat-Black.ttf",
    assFontName: "Montserrat Black",
    assBold: 0,
  });
});

test("Render Fast V2 rewrites only its ASS font face and weight", () => {
  const face = resolveFastV2FontFace("Poppins");
  assert.ok(face);

  const pinned = pinFastV2AssFont(sampleAss, face);
  const columns = pinned.replace("Style: ", "").split(",");

  assert.equal(columns[1], "Poppins ExtraBold");
  assert.equal(columns[7], "0");
  assert.equal(columns[2], "72", "fontSize is not calibrated or multiplied");
  assert.equal(columns[11], "100", "ScaleX remains unchanged");
  assert.equal(columns[12], "100", "ScaleY remains unchanged");
});