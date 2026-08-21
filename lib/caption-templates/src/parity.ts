import { BROWSER_CAPTION_TEMPLATES } from "./templates";

export type AssParityLevel = "high" | "limited";

export interface AssTemplateParity {
  level: AssParityLevel;
  /** Plain-language limitations that remain when V2 uses libass rather than Canvas. */
  limitations: readonly string[];
}

/**
 * Render Fast V2 uses libass while the Browser renderer uses Canvas/CSS. This
 * registry keeps that boundary honest in the product and gives tests a single
 * coverage target for every shipped template.
 */
export const ASS_TEMPLATE_PARITY: Record<string, AssTemplateParity> = {
  authority_bold: { level: "high", limitations: [] },
  viral_stack: { level: "limited", limitations: ["La entrada zoom se aproxima con ASS; la transición CSS no es idéntica."] },
  clean_coach: { level: "high", limitations: [] },
  hormozi: { level: "limited", limitations: ["ASS usa la fuente disponible más cercana a Montserrat Black."] },
  dimidium_mix: { level: "limited", limitations: ["El stacking progresivo y el peso mixto se aproximan con diálogos ASS."] },
  zoom_in: { level: "high", limitations: [] },
  bold_stack: { level: "limited", limitations: ["El apilado vertical se conserva, pero la escala por palabra se aproxima."] },
  bangers_comic: { level: "limited", limitations: ["El peso y el rebote de entrada dependen de la rasterización de la fuente."] },
  neon_glow: { level: "limited", limitations: ["ASS aproxima el glow con sombra; no reproduce el desenfoque cyan de Canvas."] },
  cinematic: { level: "high", limitations: [] },
  scale_pop: { level: "limited", limitations: ["La escala activa se aproxima con el modo pop de ASS."] },
  broadcast: { level: "limited", limitations: ["ASS no admite radios ni padding de caja por línea equivalentes a Canvas."] },
  hot_box: { level: "limited", limitations: ["ASS no puede dibujar una caja redondeada independiente detrás de cada palabra."] },
  dimigium: { level: "limited", limitations: ["ASS no puede dibujar el pill redondeado solo detrás de la palabra activa."] },
};

export function getAssTemplateParity(templateId: string | null | undefined): AssTemplateParity | null {
  if (!templateId) return null;
  return ASS_TEMPLATE_PARITY[templateId] ?? null;
}

export function hasAssParityCoverage(): boolean {
  return BROWSER_CAPTION_TEMPLATES.every((template) => ASS_TEMPLATE_PARITY[template.id] !== undefined)
    && Object.keys(ASS_TEMPLATE_PARITY).length === BROWSER_CAPTION_TEMPLATES.length;
}