export interface CreatorProfileInput {
  niche?: string | null;
  nicheDescription?: string | null;
  topicKeywords?: string[] | null;
  offer?: string | null;
  idealAudience?: string | null;
  uniqueValueProp?: string | null;
  voiceStyle?: string | null;
  commonObjections?: string | null;
  customCta?: string | null;
  tone?: string | null;
  language?: string | null;
}

export interface CreatorSemanticContext {
  offer: string;
  audience: string;
  problemsAndDesires: string;
  mechanism: string;
  promisedResult: string;
  style: string;
  language: string;
  keywords: string[];
  customCta: string;
}

export const STRATEGIC_CONTEXT_VERSION = "commercial-strategy-v1";

const MECHANISM_WORDS = /avatar|clon|chatbot|inteligencia artificial|\bia\b|\bai\b|automatiza|software|herramienta|bot|reel|contenido/i;

export function normalizeCreatorProfile(input: CreatorProfileInput): CreatorSemanticContext {
  const description = input.nicheDescription?.trim() ?? "";
  const audience = input.idealAudience?.trim() || "personas interesadas en el nicho configurado";
  const offer = input.offer?.trim() || input.uniqueValueProp?.trim() || "No hay un producto o servicio explícitamente configurado";
  const problemsAndDesires = [description, input.commonObjections?.trim()].filter(Boolean).join(" ");
  const mechanisms = (input.topicKeywords ?? []).filter((keyword) => MECHANISM_WORDS.test(keyword)).join(", ");
  const result = input.uniqueValueProp?.trim() || description || "resultado no configurado explícitamente";

  return {
    offer,
    audience,
    problemsAndDesires: problemsAndDesires || "problemas y deseos no configurados explícitamente",
    mechanism: mechanisms || "mecanismo no configurado explícitamente",
    promisedResult: result,
    style: [input.tone, input.voiceStyle].filter(Boolean).join(" / ") || "conversacional y directo",
    language: input.language || "es",
    keywords: (input.topicKeywords ?? []).filter(Boolean),
    customCta: input.customCta?.trim() ?? "",
  };
}

export function buildSemanticContext(profile: CreatorSemanticContext): string {
  return `
JERARQUÍA SEMÁNTICA OBLIGATORIA DEL PERFIL:
1. OFERTA / PRODUCTO QUE SE VENDE: ${profile.offer}
2. AUDIENCIA A LA QUE SE HABLA: ${profile.audience}
3. PROBLEMAS Y DESEOS DE ESA AUDIENCIA: ${profile.problemsAndDesires}
4. MECANISMO / HERRAMIENTAS UTILIZADAS: ${profile.mechanism}
5. RESULTADO O BENEFICIO CONFIGURADO: ${profile.promisedResult}
6. ESTILO Y TONO: ${profile.style}
7. IDIOMA: ${profile.language}
8. PALABRAS CLAVE SECUNDARIAS: ${profile.keywords.join(", ") || "ninguna"}

REGLAS DE INTERPRETACIÓN:
- La OFERTA CONFIGURADA es la única propuesta que puedes presentar como producto o servicio ofrecido. Nunca conviertas una keyword o un mecanismo en una oferta.
- Avatar, clon digital, chatbot, inteligencia artificial, automatización y cualquier herramienta son mecanismos o conceptos, salvo que la OFERTA diga explícitamente que se venden.
- Habla a la AUDIENCIA configurada y conecta sus PROBLEMAS/DESEOS con el RESULTADO configurado.
- Las keywords solo sirven para elegir subtemas y vocabulario relevante. No las enumeres ni las conviertas automáticamente en ofertas.
- No inventes productos, clientes, audiencias, promesas de ingresos ni resultados que no estén en el perfil.
`.trim();
}

export interface SemanticValidationResult {
  valid: boolean;
  reasons: string[];
}

export function validateSemanticOutput(
  output: { script?: string; cta?: string; topic?: string },
  profile: CreatorSemanticContext,
): SemanticValidationResult {
  const text = `${output.topic ?? ""} ${output.script ?? ""} ${output.cta ?? ""}`.toLowerCase();
  const reasons: string[] = [];
  const offer = profile.offer.toLowerCase();
  const explicitOfferTerms = offer.split(/\W+/).filter((word) => word.length >= 5);
  const mechanismTerms = ["avatar", "avatares", "clon digital", "chatbot", "chatbots", "inteligencia artificial", "automatización"];
  const offerExplicitlySells = (term: string) =>
    new RegExp(`\\b(?:vende|vender|venta|ofrece|oferta|servicio|consultor[ií]a|curso|producto)\\b[^.!?]{0,24}\\b${term.replace(" ", "\\s+")}\\b`, "i").test(offer)
    || new RegExp(`^\\s*${term.replace(" ", "\\s+")}\\b`, "i").test(offer);

  for (const mechanism of mechanismTerms) {
    const escapedMechanism = mechanism.replace(" ", "\\s+");
    if (new RegExp(`\\b(?:vend(?:er|es|e|emos|ido|iendo)|venta\\s+de)\\b[^.!?]{0,24}\\b${escapedMechanism}\\b`, "i").test(text)
      && !offerExplicitlySells(mechanism)) {
      reasons.push(`Presenta el mecanismo "${mechanism}" como producto vendido, pero no aparece en la oferta.`);
    }
    if (new RegExp(`\\b${escapedMechanism}\\b[^.!?]{0,30}\\bpara\\s+vender\\b`, "i").test(text)
      && !offerExplicitlySells(mechanism)) {
      reasons.push(`Usa "${mechanism}" como eje de una oferta comercial no configurada; debe presentarse como mecanismo de ${profile.offer}.`);
    }
  }
  if (/\b(chatbots?|avatares?)\s+(?:son|es)\s+(?:el|la)\s+producto\b/i.test(text) && !mechanismTerms.some((term) => offer.includes(term))) {
    reasons.push("Declara un mecanismo como producto principal.");
  }
  if (/\bganar dinero|ganarás|vas a ganar|ingresos garantizados|duplicar tus ventas\b/i.test(text)
    && !/ganar dinero|ingresos|ventas|vender/i.test(profile.promisedResult)) {
    reasons.push("Incluye una promesa económica que no está configurada.");
  }
  if (profile.audience.toLowerCase().includes("dueñ") && !/\bnegocio|empresa|emprend|cliente|ventas\b/i.test(text)) {
    reasons.push("No habla de forma reconocible a la audiencia de dueños de negocios.");
  }
  if (profile.customCta && output.cta && output.cta.trim() !== profile.customCta.trim()) {
    reasons.push("No respeta el CTA explícito configurado.");
  }
  if (!profile.customCta && output.cta && explicitOfferTerms.length > 0
    && !explicitOfferTerms.some((term) => output.cta!.toLowerCase().includes(term))
    && !/\bseguir|sígueme|guardar|comentar|compartir\b/i.test(output.cta)) {
    reasons.push("El CTA no conecta con la oferta ni con una acción editorial válida.");
  }
  return { valid: reasons.length === 0, reasons };
}