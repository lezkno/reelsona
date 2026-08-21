import { buildRenderFastV2Graph } from "./render-fast-v2.js";

export type PictureLockGraph = {
  inputArgs: string[];
  filterComplex: string;
  videoMap: string;
  audioMap: string;
};

/**
 * Reuse the proven Fast V2 normalization/zoom/B-roll graph while removing only
 * the terminal ASS/libass filter. The resulting video is the picture lock that
 * Canvas captions are composited onto in the hybrid pipeline.
 */
export function buildPictureLockGraph(input: Parameters<typeof buildRenderFastV2Graph>[0]): PictureLockGraph {
  const fast = buildRenderFastV2Graph(input);
  const parts = fast.filterComplex.split(";");
  const terminal = parts.at(-1) ?? "";
  const match = terminal.match(/^(\[[^\]]+\])ass=.*\[renderedv\]$/);
  if (!match) {
    throw new Error("Fast V2 graph contract changed: terminal ASS filter was not found");
  }

  const sourceLabel = match[1];
  parts[parts.length - 1] = `${sourceLabel}null[picturelockv]`;

  return {
    inputArgs: fast.inputArgs,
    filterComplex: parts.join(";"),
    videoMap: "[picturelockv]",
    audioMap: fast.audioMap,
  };
}
