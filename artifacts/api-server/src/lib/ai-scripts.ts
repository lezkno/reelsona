import { makeOpenAIClient } from "./openai-client";
import { logger } from "./logger";
import type { StrategyContext } from "./ai-strategy";

// ── Editorial Base — injected into ALL prompts ────────────────────────────────

/**
 * EDITORIAL_BASE: The shared editorial constitution for all AI-generated content.
 * Injected at the top of every prompt to enforce quality, safety, and originality.
 */
const EDITORIAL_BASE = `
CONSTITUCIÓN EDITORIAL — OBLIGATORIA EN TODO CONTENIDO:

VALORES FUNDAMENTALES:
• Originalidad real: cada pieza debe aportar un ángulo, dato o perspectiva que no exista ya en los primeros 10 resultados de búsqueda del tema.
• Valor concreto: el espectador debe poder aplicar algo o entender algo nuevo en menos de 60 segundos. Sin relleno, sin intro genérica.
• Retención desde el primer segundo: la primera frase debe crear tensión, curiosidad o contradicción — no presentar, no saludar, no anunciar el tema.
• Compartibilidad: el contenido debe hacer que el espectador quiera enviárselo a alguien específico ("esto es justo lo que le pasa a mi amigo").

PROHIBICIONES ABSOLUTAS (penalización máxima si se detectan):
❌ NUNCA prometer resultados garantizados de salud, dinero, relaciones o rendimiento ("vas a ganar X", "cura X", "perderás X kilos").
❌ NUNCA fabricar estadísticas, porcentajes o datos sin fuente verificable implícita ("el 87% de los expertos dicen…" sin base real).
❌ NUNCA usar sensacionalismo falso ("lo que el gobierno oculta", "la verdad que nadie dice") sin evidencia real detrás.
❌ NUNCA reutilizar o parafrasear contenido ajeno sin valor agregado original.
❌ NUNCA usar clichés de contenido: "tips", "consejos", "guía paso a paso", "tutorial", "todo lo que necesitas saber".
❌ NUNCA usar palabras de alerta: "garantizado", "cura", "secreto que ocultan", "te hacen pobre", "método infalible".

ESTÁNDAR DE CALIDAD:
✅ Cada título debe sonar como la primera frase que diría una persona real mirando a cámara — no un artículo de blog.
✅ Cada guion debe terminar dejando al espectador con una acción concreta o una idea que no tenía antes.
✅ El tono debe ser conversacional y directo — nunca corporativo, nunca artificial.
`.trim();

// ── Talking-head format constraint — injected into all topic + script prompts ─

/**
 * TALKING_HEAD_CONSTRAINT: Format rules for avatar-only production.
 * Injected into generateContentTopics and generateScript prompts.
 */
const TALKING_HEAD_CONSTRAINT = `
FORMATO OBLIGATORIO — AVATAR TALKING-HEAD (estilo podcast/experto):
El contenido será producido por un avatar de IA mirando directamente a cámara. NO existe pantalla compartida, NO hay grabación de escritorio, NO hay tutorial visual en tiempo real.

MEDIOS DISPONIBLES:
✅ Avatar hablando a cámara · Captions / subtítulos animados · Punch text grande en pantalla
✅ B-roll simple (imágenes de stock, cortes) · Overlays de texto (listas, estadísticas, preguntas)
✅ Zoom dramático · Hook card visual · CTA card al final

PROHIBIDO — estas ideas/frases NO son producibles:
❌ "te muestro en pantalla" · "hacemos clic aquí" · "mira este gráfico" · "te enseño en vivo"
❌ "en mi pantalla ves" · "voy a abrir la herramienta" · "paso a paso en el software"
❌ Tutoriales de interfaz, walkthroughs de configuración, análisis de dashboard en vivo
❌ Cualquier idea que REQUIERA ver una pantalla para entenderse

CONVERSIÓN OBLIGATORIA de ideas dependientes de pantalla:
  "Cómo configurar [X] paso a paso" → "El error que hace que [X] falle aunque creas que está bien configurado"
  "Te muestro cómo crear una campaña" → "3 decisiones que tomar ANTES de crear una campaña o quemas presupuesto"
  "Tutorial de [software]" → "Si vas a usar [software], evita estos errores antes de invertir tiempo"
  "Análisis de dashboard" → "Qué métricas ignora el 90% de los que usan [herramienta] — y por qué les cuesta ventas"

FORMATOS ÓPTIMOS para talking-head/podcast:
  Opinión experta contundente · Errores + consecuencias reales · Mitos vs realidad · Framework verbal
  Checklist verbal · Historia corta con lección · Comparación A vs B en palabras · Objeciones + respuesta
  "Lo que nadie te dice sobre X" · "Antes de hacer X entiende Y" · Lección de caso real
`.trim();

// ── Language-aware prompt helpers ─────────────────────────────────────────────

/** Returns a per-language style instruction injected at the top of every prompt. */
function getLanguageInstruction(language: string): string {
  const l = language.toLowerCase().trim();
  if (l.startsWith("es") || l === "español")
    return `IMPORTANTE: Usa español neutro (sin voseo, sin modismos regionales). Tutea al espectador ("tú", "te", "tu"), no uses "vos" ni conjugaciones del voseo. El contenido debe ser comprensible para cualquier hispanohablante.
REGLAS DE ESCRITURA PARA SÍNTESIS DE VOZ: El guion será leído por un avatar de voz clonada. Para que suene natural: (1) Escribe oraciones cortas y directas. (2) NUNCA uses puntos suspensivos (...) — generan pausas artificiales largas. (3) NUNCA uses raya o guion largo (—) — genera cortes abruptos. (4) NUNCA uses punto y coma (;) — causa pausas raras. (5) Usa solo comas y puntos finales para pausas. (6) Evita los dos puntos (:) dentro de oraciones; en su lugar usa una coma o "por ejemplo". (7) NUNCA uses siglas ni abreviaturas — el avatar las lee letra por letra: escribe "inteligencia artificial" (no "IA" ni "AI"), "retorno de inversión" (no "ROI"), "indicadores clave" (no "KPIs"), "director ejecutivo" (no "CEO"), "llamada a la acción" (no "CTA"), "etcétera" (no "etc."), "versus" (no "vs.") — todo debe sonar natural al escucharse. (8) NUNCA uses diminutivos ni jerga informal: escribe palabras completas y claras.`;
  if (l.startsWith("en") || l === "english" || l === "inglés")
    return `IMPORTANT: Write entirely in clear, natural English. Use second person ("you"). Keep it conversational and accessible to any English-speaking audience.`;
  if (l.startsWith("pt") || l === "português" || l === "portuguese")
    return `IMPORTANTE: Use português neutro e natural. Use segunda pessoa ("você"). O conteúdo deve ser compreensível para qualquer falante de português.`;
  if (l.startsWith("fr") || l === "français" || l === "french")
    return `IMPORTANT : Rédigez entièrement en français naturel et courant. Utilisez le tutoiement ou le vouvoiement selon le ton choisi. Le contenu doit être compréhensible pour tout francophone.`;
  if (l.startsWith("de") || l === "deutsch" || l === "german")
    return `WICHTIG: Schreiben Sie vollständig auf natürlichem, klarem Deutsch. Verwenden Sie "du" oder "Sie" je nach Ton. Der Inhalt sollte für alle deutschsprachigen Zuschauer verständlich sein.`;
  if (l.startsWith("it") || l === "italiano" || l === "italian")
    return `IMPORTANTE: Scrivi interamente in italiano naturale e scorrevole. Usa il "tu" per rivolgerti allo spettatore. Il contenuto deve essere comprensibile per qualsiasi italofono.`;
  return `IMPORTANT: Write the entire content in ${language}. Keep it natural and conversational for native speakers.`;
}

/** Returns AI-avatar disclosure CTAs translated to the given language. */
function getAvatarCTAs(language: string): string[] {
  const l = language.toLowerCase().trim();

  if (l.startsWith("en") || l === "english" || l === "inglés") return [
    "Follow me and I'll show you how to create an AI avatar just like this one.",
    "Can you imagine having your own AI avatar? Follow me and I'll show you how.",
    "I'm an avatar created with artificial intelligence. Follow me and learn how to build yours.",
    "Everything you see here is artificial intelligence in action. Follow me and discover how to use it in your business.",
    "Wondering how this is made? Follow me — I'll explain everything about AI avatars.",
    "This entire video was made with artificial intelligence. Follow me to learn how to use it too.",
    "I'm a digital avatar generated with AI. Follow me for more content like this.",
    "This was built with artificial intelligence. Follow me and I'll help you create something like this for your business.",
  ];

  if (l.startsWith("pt") || l === "português" || l === "portuguese") return [
    "Me siga e te ensino a criar um avatar de inteligência artificial como este.",
    "Consegue imaginar ter seu próprio avatar de inteligência artificial? Me siga e te conto como.",
    "Sou um avatar criado com inteligência artificial. Me siga e aprenda a criar o seu.",
    "Isso que você vê é inteligência artificial em ação. Me siga e descubra como usá-la no seu negócio.",
    "Se você se pergunta como isso é feito, me siga — explico tudo sobre avatares de inteligência artificial.",
    "Todo este vídeo foi criado com inteligência artificial. Me siga para aprender a usá-la também.",
  ];

  if (l.startsWith("fr") || l === "français" || l === "french") return [
    "Abonnez-vous et je vous montre comment créer un avatar d'intelligence artificielle comme celui-ci.",
    "Vous imaginez avoir votre propre avatar IA ? Abonnez-vous et je vous explique tout.",
    "Je suis un avatar créé avec l'intelligence artificielle. Suivez-moi et apprenez à créer le vôtre.",
    "Tout ce que vous voyez ici est de l'IA en action. Abonnez-vous pour découvrir comment l'utiliser.",
  ];

  if (l.startsWith("de") || l === "deutsch" || l === "german") return [
    "Folge mir und ich zeige dir, wie du einen KI-Avatar wie diesen erstellen kannst.",
    "Kannst du dir vorstellen, deinen eigenen KI-Avatar zu haben? Folge mir und ich erkläre alles.",
    "Ich bin ein Avatar, der mit künstlicher Intelligenz erstellt wurde. Folge mir und lerne, deinen eigenen zu bauen.",
    "Alles, was du hier siehst, ist KI in Aktion. Folge mir und entdecke, wie du sie in deinem Business nutzt.",
  ];

  if (l.startsWith("it") || l === "italiano" || l === "italian") return [
    "Seguimi e ti insegno a creare un avatar di intelligenza artificiale come questo.",
    "Ti immagini avere il tuo avatar di intelligenza artificiale? Seguimi e ti spiego come.",
    "Sono un avatar creato con l'intelligenza artificiale. Seguimi e scopri come creare il tuo.",
    "Quello che vedi è intelligenza artificiale in azione. Seguimi e scopri come usarla nel tuo business.",
  ];

  // Default: Spanish
  return [
    "Sígueme y te enseño a crear un avatar de inteligencia artificial como este.",
    "¿Te imaginas tener tu propio avatar de inteligencia artificial? Sígueme y te cuento cómo.",
    "Soy un avatar creado con inteligencia artificial. Sígueme y aprende a crear el tuyo.",
    "Esto que ves es inteligencia artificial en acción. Sígueme y descubre cómo usarla en tu negocio.",
    "Si te preguntas cómo se hace esto, sígueme — te explico todo sobre los avatares de inteligencia artificial.",
    "Todo lo que ves en este video es inteligencia artificial. Sígueme para aprender a usarla tú también.",
    "Soy un avatar digital generado con inteligencia artificial. Sígueme para más contenido como este.",
    "Este video fue creado con inteligencia artificial. Sígueme y te ayudo a crear algo así para tu negocio.",
  ];
}

// ── Shared types ──────────────────────────────────────────────────────────────

/** Audit insights fed into generation to improve relevance. */
export interface AuditInsights {
  topCaptions: string[];
  recommendedTopics: string[];
  avgEngagement: number;
  contentInsights?: string;
}

export interface ScriptOutput {
  topic: string;
  hook: string;
  script: string;
  cta: string;
  caption: string;
  hashtags: string;
  estimated_duration_seconds: number;
  /** 3 hook candidates generated before picking the winner */
  hook_candidates: string[];
  /** Why the winning hook was chosen over alternatives */
  hook_selection_reason: string;
}

// ── Hook multi-candidate generation ──────────────────────────────────────────

interface HookCandidate {
  hook: string;
  selection_reason: string;
}

const GENERIC_HOOK_PHRASES = [
  "te voy a enseñar",
  "hoy hablamos de",
  "en este video",
  "bienvenidos",
  "hola a todos",
  "hoy vamos a",
  "en este reel",
  "i'm going to show you",
  "today we're talking",
  "in this video",
];

/** Penalize hooks with generic filler phrases; reward specificity and numbers. */
function scoreHook(hook: string): number {
  let score = 50;
  const lower = hook.toLowerCase();

  for (const phrase of GENERIC_HOOK_PHRASES) {
    if (lower.includes(phrase)) score -= 25;
  }

  // Reward: contains a number
  if (/\d/.test(hook)) score += 10;
  // Reward: contains a question
  if (/[?¿]/.test(hook)) score += 10;
  // Reward: short and punchy (< 80 chars)
  if (hook.length < 80) score += 5;
  // Reward: specificity markers
  if (/\b(exactamente|específicamente|concretamente|en \d+|sin )\b/i.test(hook)) score += 10;

  return score;
}

/** Generate 3 hook candidates and pick the best one programmatically. */
async function generateHookCandidates(
  topic: string,
  niche: string,
  tone: string,
  language: string,
  auditInsights?: AuditInsights,
  openaiApiKey?: string | null,
  nicheDescription?: string | null,
  topicKeywords?: string[],
  offer?: string | null,
  idealAudience?: string | null,
  voiceStyle?: string | null,
): Promise<{ candidates: string[]; winner: string; selectionReason: string }> {
  const client = makeOpenAIClient(openaiApiKey);

  const auditContext = auditInsights?.topCaptions.length
    ? `\nCaptions que funcionaron bien en esta cuenta (solo como referencia de estilo de apertura):\n${auditInsights.topCaptions.slice(0, 3).map((c, i) => `${i + 1}. ${c.substring(0, 120)}`).join("\n")}`
    : "";

  const nicheContext = [
    nicheDescription ? `Descripción del creador: ${nicheDescription}` : "",
    offer ? `Oferta del creador: ${offer}` : "",
    idealAudience ? `Audiencia ideal: ${idealAudience}` : "",
    voiceStyle ? `Estilo de voz: ${voiceStyle}` : "",
    topicKeywords?.length ? `Palabras clave del creador: ${topicKeywords.join(", ")}` : "",
  ].filter(Boolean).join("\n");

  const prompt = `${EDITORIAL_BASE}

${getLanguageInstruction(language)}

Genera 3 hooks alternativos para el primer segundo de un Reel de Instagram.

Nicho: ${niche}
Tema: ${topic}
Tono: ${tone}${nicheContext ? `\n${nicheContext}` : ""}${auditContext}

CRITERIOS PARA UN HOOK GANADOR:
• Claridad en el primer segundo: sin preámbulo, directamente al conflicto o revelación
• Curiosidad o tensión: el espectador NECESITA saber qué sigue
• Especificidad: cifras, nombre de algo concreto, situación reconocible
• Promesa creíble: nada de "esto cambiará tu vida" — algo alcanzable y real
• Potencial de retención: alguien viendo scrollear debería detenerse en esa frase

PROHIBIDO en los hooks:
❌ "Te voy a enseñar...", "Hoy hablamos de...", "En este video...", "Bienvenidos..."
❌ Promesas de resultados garantizados
❌ Palabras de clickbait vacío ("increíble", "lo que nadie te dijo")

Devuelve SOLO un JSON válido:
{
  "candidates": [
    { "hook": "primera frase exacta del reel", "selection_reason": "por qué este hook funciona" },
    { "hook": "segunda alternativa distinta", "selection_reason": "por qué este hook funciona" },
    { "hook": "tercera alternativa distinta", "selection_reason": "por qué este hook funciona" }
  ]
}`;

  try {
    const res = await client.chat.completions.create({
      model: "gpt-5.6-luna",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const content = res.choices[0]?.message?.content;
    if (!content) throw new Error("Empty hook candidates response");

    const parsed = JSON.parse(content) as { candidates: HookCandidate[] };
    const candidates = parsed.candidates ?? [];

    if (candidates.length === 0) throw new Error("No candidates returned");

    // Programmatic scoring — pick the highest-scoring hook
    const scored = candidates.map((c) => ({ ...c, score: scoreHook(c.hook) }));
    scored.sort((a, b) => b.score - a.score);
    const winner = scored[0];

    return {
      candidates: candidates.map((c) => c.hook),
      winner: winner.hook,
      selectionReason: winner.selection_reason,
    };
  } catch (err) {
    logger.warn({ err, topic }, "Hook candidate generation failed — fallback to single-call");
    throw err; // caller handles fallback
  }
}

// ── Script generation ─────────────────────────────────────────────────────────

/** Maps a criterion to an emphasis instruction injected into the script prompt. */
const CRITERION_EMPHASIS: Record<string, string> = {
  educational: "ÉNFASIS EDUCATIONAL: prioriza datos concretos, takeaways accionables y razonamiento claro. Cada afirmación debe enseñar algo aplicable. Estructura: dato sorprendente → explicación → acción concreta.",
  controversial: "ÉNFASIS CONTROVERSIAL (SEGURO): elige el ángulo contra-intuitivo o la posición minoritaria que tiene evidencia real detrás. NO fabricar polémica ni sensacionalismo — la controversia debe ser honesta y respaldada.",
  storytelling: "ÉNFASIS STORYTELLING: estructura narrativa clara: situación → conflicto → giro → resolución. El espectador debe sentir que vivió algo, no que recibió información.",
  sales: "ÉNFASIS VENTAS: beneficio claro en el primer tercio, urgencia real (no ficticia) en el segundo, CTA específico y con consecuencia concreta en el cierre. Sin presión falsa.",
  emotional: "ÉNFASIS EMOCIONAL: historia personal o situación con la que el espectador se identifica. Muestra vulnerabilidad real. La empatía debe sentirse genuina, no calculada.",
};

export async function generateScript(
  topic: string,
  niche: string,
  tone: string,
  language: string,
  durationSeconds: number,
  options?: {
    criterion?: string;
    auditInsights?: AuditInsights;
    openaiApiKey?: string | null;
    nicheDescription?: string | null;
    topicKeywords?: string[];
    offer?: string | null;
    idealAudience?: string | null;
    uniqueValueProp?: string | null;
    voiceStyle?: string | null;
    commonObjections?: string | null;
    customCta?: string | null;
  }
): Promise<ScriptOutput> {
  const client = makeOpenAIClient(options?.openaiApiKey);
  const wordCount = Math.round((durationSeconds / 60) * 130);

  const avatarCTAs = getAvatarCTAs(language);
  const ctaList = avatarCTAs.map((c) => `   - "${c}"`).join("\n");

  // Step 1: Generate hook candidates (with fallback)
  let hookWinner: string | null = null;
  let hookCandidatesList: string[] = [];
  let hookSelectionReason = "";

  try {
    const hookResult = await generateHookCandidates(
      topic, niche, tone, language, options?.auditInsights, options?.openaiApiKey,
      options?.nicheDescription, options?.topicKeywords,
      options?.offer, options?.idealAudience, options?.voiceStyle,
    );
    hookWinner = hookResult.winner;
    hookCandidatesList = hookResult.candidates;
    hookSelectionReason = hookResult.selectionReason;
  } catch {
    logger.warn({ topic }, "Hook candidates failed — proceeding with single-pass script generation");
  }

  const criterionInstruction = options?.criterion
    ? `\n${CRITERION_EMPHASIS[options.criterion] ?? ""}\n`
    : "";

  const hookInstruction = hookWinner
    ? `\nHOOK GANADOR (ÚSALO COMO PRIMERA FRASE EXACTA DEL GUION): "${hookWinner}"\nEl hook ya fue seleccionado — NO lo cambies ni reescribas. Úsalo tal cual como la primera oración del script.\n`
    : "";

  const auditContext = options?.auditInsights?.contentInsights
    ? `\nInsight de audiencia (basado en análisis de la cuenta): ${options.auditInsights.contentInsights}\n`
    : "";

  const nicheContext = [
    options?.nicheDescription ? `- Descripción del creador: ${options.nicheDescription}` : "",
    options?.topicKeywords?.length ? `- Palabras clave del creador: ${options.topicKeywords.join(", ")}` : "",
  ].filter(Boolean).join("\n");

  const creatorBrainLines = [
    options?.offer            ? `- Oferta del creador: ${options.offer}` : "",
    options?.idealAudience    ? `- Audiencia ideal: ${options.idealAudience}` : "",
    options?.uniqueValueProp  ? `- Propuesta de valor única: ${options.uniqueValueProp}` : "",
    options?.voiceStyle       ? `- Estilo de comunicación y voz: ${options.voiceStyle}` : "",
    options?.commonObjections ? `- Objeciones frecuentes de la audiencia (úsalas para anticipar dudas en el guion): ${options.commonObjections}` : "",
  ].filter(Boolean);
  const creatorBrainContext = creatorBrainLines.length
    ? `\nCONTEXTO DEL CREADOR — usá esta información para personalizar el guion con su voz, oferta y audiencia real:\n${creatorBrainLines.join("\n")}\n`
    : "";

  const ctaInstruction = options?.customCta
    ? `2. La ÚLTIMA oración del guion DEBE ser EXACTAMENTE esta frase del creador (no la modifiques, no la parafrasees, úsala tal cual):\n   "${options.customCta}"`
    : `2. La ÚLTIMA oración del guion SIEMPRE debe ser una de estas frases — elige UNA distinta cada vez (varía, no repitas siempre la misma):\n${ctaList}`;

  const prompt = `${EDITORIAL_BASE}

${TALKING_HEAD_CONSTRAINT}

${getLanguageInstruction(language)}
${criterionInstruction}${auditContext}${creatorBrainContext}
Crea un guion de video para un Reel de Instagram con estas especificaciones:
- Nicho: ${niche}
- Tema: ${topic}
- Tono: ${tone}
- Idioma: ${language}
- Duración aproximada: ${durationSeconds} segundos (~${wordCount} palabras)
${nicheContext}
${hookInstruction}
REGLAS OBLIGATORIAS para el campo "script":
1. El guion DEBE terminar con una llamada a la acción clara y directa hablada por el avatar.
${ctaInstruction}
3. El hook debe ser la primera frase del guion (ya incluida dentro de "script").
4. Sin indicaciones de escena, sin corchetes, sin asteriscos — solo texto hablado corrido.
5. El tono debe sentirse conversacional, no como un comercial.
6. NUNCA escribas frases que requieran que el espectador vea una pantalla o demostración en vivo: "como ves aquí", "hacemos clic en", "en esta captura verás", "voy a mostrarte en pantalla", "ahora en mi pantalla". El avatar habla directamente a cámara — el espectador solo ve su cara.
6. NUNCA uses abreviaturas que el avatar leería mal: escribe "inteligencia artificial" (no "IA" ni "AI"), "retorno de inversión" (no "ROI"), "indicadores clave" (no "KPIs"), "director ejecutivo" (no "CEO"), etc. — todo debe sonar natural cuando se lee en voz alta.
7. NUNCA uses diminutivos, jerga o frases incompletas. Las oraciones deben ser completas y claras para que el avatar las lea correctamente.

Devuelve SOLO un JSON válido con esta estructura exacta:
{
  "hook": "Primera frase gancho (primeros 3 segundos, que detenga el scroll)",
  "script": "El guion completo que leerá el avatar. Debe incluir: hook al inicio → desarrollo → CTA hablado → divulgación IA al final.",
  "cta": "La llamada a la acción principal (la misma que está dentro del script, extraída aquí brevemente)",
  "caption": "Caption para Instagram (2-3 oraciones atractivas que complementen el video)",
  "hashtags": "#hashtag1 #hashtag2 #hashtag3 (10-15 hashtags relevantes y específicos al tema)",
  "estimated_duration_seconds": ${durationSeconds}
}`;

  const res = await client.chat.completions.create({
    model: "gpt-5.6-luna",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const content = res.choices[0]?.message?.content;
  if (!content) throw new Error("Empty response from AI");

  const parsed = JSON.parse(content) as Omit<ScriptOutput, "topic" | "hook_candidates" | "hook_selection_reason">;

  // If hook candidates were generated, override the AI's hook with the winner
  if (hookWinner) {
    parsed.hook = hookWinner;
    // Ensure script starts with the winning hook
    if (!parsed.script.startsWith(hookWinner)) {
      parsed.script = hookWinner + " " + parsed.script.replace(/^[^.!?]+[.!?]\s*/, "");
    }
  }

  logger.info({ topic, criterion: options?.criterion, hasHookCandidates: hookCandidatesList.length > 0 }, "Script generated by AI");

  return {
    topic,
    ...parsed,
    hook_candidates: hookCandidatesList,
    hook_selection_reason: hookSelectionReason,
  };
}

// ── Caption regeneration ──────────────────────────────────────────────────────

export interface RegenerateCaptionOutput {
  caption: string;
  hashtags: string;
}

export async function regenerateCaption(
  topic: string,
  script: string,
  niche: string,
  tone: string,
  language: string,
  topCaptions?: string[],
  openaiApiKey?: string | null,
): Promise<RegenerateCaptionOutput> {
  const client = makeOpenAIClient(openaiApiKey);

  // Build examples block from top-performing captions
  const examplesBlock = topCaptions?.length
    ? `\nEjemplos de captions que funcionaron bien en esta cuenta (úsalos SOLO como referencia de estilo y longitud — NO los copies ni parafrasees):\n${topCaptions.slice(0, 3).map((c, i) => `${i + 1}. "${c.substring(0, 200)}"`).join("\n")}\n`
    : "";

  const prompt = `${EDITORIAL_BASE}

${getLanguageInstruction(language)}

Eres un experto en copywriting para Instagram Reels. Tu trabajo es escribir la descripción del post (caption) para acompañar el video.

Nicho: ${niche}
Tono: ${tone}
Idioma: ${language}
Tema: ${topic}
${examplesBlock}
Guion del video (úsalo como base para que el caption esté directamente relacionado con lo que dice el video):
"""
${script}
"""

REGLAS ESTRICTAS:
1. El caption debe tener 3-5 oraciones. Primera oración: hook que llame la atención y haga querer ver el video (puede empezar con emoji). Segunda/tercera: complementa o amplía lo más valioso del video. Última oración OBLIGATORIA: un llamado a la acción claro y específico.
2. ${getLanguageInstruction(language)}
3. El caption debe sentirse escrito por una persona real, no por una IA.
4. HASHTAGS — mezcla estratégica OBLIGATORIA:
   - 3-4 hashtags de nicho específico (menos de 500 mil posts) — máxima especificidad, alcance medio-alto por segmentación
   - 4-5 hashtags de tema general del nicho (500 mil a 5 millones de posts) — equilibrio entre alcance y competencia
   - 2-3 hashtags amplios (más de 5 millones de posts) — visibilidad general
   - Total: 9-12 hashtags, sin espacios entre ellos

Devuelve SOLO un JSON válido con esta estructura exacta:
{
  "caption": "...",
  "hashtags": "#tag1 #tag2 #tag3 ..."
}`;

  const res = await client.chat.completions.create({
    model: "gpt-5.6-luna",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const content = res.choices[0]?.message?.content;
  if (!content) throw new Error("Empty response from AI");

  const parsed = JSON.parse(content) as RegenerateCaptionOutput;
  logger.info({ topic }, "Caption regenerated by AI");
  return parsed;
}

// ── Content topic generation ──────────────────────────────────────────────────

export interface ContentPlanTopicMeta {
  topic: string;
  scheduled_at: string;
  viral_score: number;
  editorial_angle: string;
  audience_pain: string;
  share_reason: string;
  novelty_level: "low" | "medium" | "high";
  specific_promise: string;
  // ── Talking-head format fields ──────────────────────────────────────────────
  /** How much this topic depends on screen / external visuals */
  visual_dependency: "low" | "medium" | "high";
  /** 0-100: how well this topic fits the avatar talking-head format */
  format_fit_score: number;
  /** Why this topic works (or not) without screen sharing — 1 sentence */
  avatar_talking_head_fit_reason: string;
  /** Visual supports recommended: captions, punch text, b-roll, zoom, overlay, etc. */
  suggested_visual_support: string[];
}

// Keep backwards compat alias
export type ContentPlanTopic = ContentPlanTopicMeta;

// Topic categories and hook formats for high-performing Reels content
const TOPIC_CATEGORIES = `
MEZCLA DE CONTENIDO (proporciones aproximadas):
  - 30% GANCHO EMOCIONAL: frustraciones reales, errores costosos, miedos del nicho
  - 25% REVELACIÓN: algo que la audiencia no sabe o cree equivocado
  - 25% RESULTADO CONCRETO: caso real, número específico, transformación visible
  - 20% TENDENCIA URGENTE: algo que cambia ahora y afecta al nicho

FORMATOS DE TÍTULO — rota entre todos estos, NUNCA uses el mismo formato más de 2 veces en el mismo plan:
  A) Pregunta provocadora:     "¿Por qué [problema que todos tienen pero nadie admite]?"
  B) Error costoso:            "El error que [consecuencia negativa concreta] — y cómo evitarlo"
  C) Dato que sorprende:       "[Número o porcentaje] de [audiencia] [hecho inesperado] — aquí por qué"
  D) Revelación:               "Lo que [plataforma/empresa famosa] no quiere que sepas sobre [X]"
  E) Contraintuitivo:          "Dejar de [hacer X] fue lo mejor que hice para [resultado del nicho]"
  F) Caso real sin nombre:     "De [estado inicial] a [resultado] en [tiempo] — sin [recurso que la gente cree necesitar]"
  G) Urgencia de tendencia:    "[Plataforma] acaba de cambiar [cosa específica] — esto te afecta si [descripción audiencia]"
  H) Desmitificación:          "No necesitas [cosa cara/compleja] para [resultado deseado] — esto es lo que sí funciona"
  I) Lista corta accionable:   "[2-4] cosas que [audiencia] hace diferente para [resultado concreto]"
  J) Provocación directa:      "Tu [X] está perdiendo dinero ahora mismo — y probablemente ni lo sabes"

REGLA CRÍTICA DE TÍTULOS:
  ❌ PROHIBIDO: títulos que empiecen con "Cómo crear", "Guía para", "Tutorial de", "Paso a paso"
  ❌ PROHIBIDO: mencionar nombres de herramientas técnicas en el título a menos que sean marcas conocidas (WhatsApp, Instagram, ChatGPT)
  ✅ OBLIGATORIO: el título debe sonar como la primera frase que diría una persona real mirando a cámara
  ✅ OBLIGATORIO: debe generar curiosidad o incomodidad en los primeros 3 segundos
`.trim();

/** Words that indicate a low-quality or unsafe topic title. */
const PENALTY_WORDS = ["garantizado", "cura", "secreto que ocultan", "te hacen pobre", "método infalible", "infalible", "milagroso"];
const GENERIC_WORDS = ["tips", "consejos", "guía", "tutorial", "cómo hacer"];

/** Apply programmatic scoring adjustments to a list of AI-generated topics. */
function scoreTopics(
  topics: Array<{ topic: string; viral_score: number; editorial_angle: string; novelty_level: string; share_reason: string; visual_dependency?: string; format_fit_score?: number }>,
  existingAngles: string[] = []
): Array<typeof topics[0] & { adjusted_score: number }> {
  // Count angle occurrences in this batch + existing
  const angleCounts: Record<string, number> = {};
  for (const a of existingAngles) angleCounts[a] = (angleCounts[a] ?? 0) + 1;

  return topics.map((t) => {
    let score = t.viral_score ?? 50;

    // (a) Penalize repeated angles (> 2 times in plan)
    const angle = t.editorial_angle ?? "";
    const currentCount = angleCounts[angle] ?? 0;
    if (currentCount >= 2) score -= 15;
    angleCounts[angle] = currentCount + 1;

    // (b) Penalize low novelty
    if (t.novelty_level === "low") score -= 20;

    // (c) Penalize generic title words
    const lowerTopic = t.topic.toLowerCase();
    for (const w of GENERIC_WORDS) {
      if (lowerTopic.includes(w)) { score -= 10; break; }
    }

    // (d) Penalize safety-risk words
    for (const w of PENALTY_WORDS) {
      if (lowerTopic.includes(w)) { score -= 30; break; }
    }

    // (e) Bonus for specific share_reason (> 30 chars = more thought out)
    if ((t.share_reason?.length ?? 0) > 30) score += 10;

    // (f) Penalize visual dependency — topics requiring screen sharing are not producible
    if (t.visual_dependency === "high") score -= 25;
    else if (t.visual_dependency === "medium") score -= 8;

    // (g) Bonus for confirmed strong talking-head fit
    if ((t.format_fit_score ?? 0) >= 80) score += 8;

    return { ...t, adjusted_score: Math.max(0, Math.min(100, score)) };
  });
}

/** Balance topic ordering: no more than 2 consecutive same-angle topics. */
function balanceAngles<T extends { editorial_angle: string; adjusted_score: number }>(topics: T[]): T[] {
  const sorted = [...topics].sort((a, b) => b.adjusted_score - a.adjusted_score);
  const result: T[] = [];
  const lastTwoAngles: string[] = [];

  for (const t of sorted) {
    const angle = t.editorial_angle ?? "";
    if (lastTwoAngles.length === 2 && lastTwoAngles[0] === angle && lastTwoAngles[1] === angle) {
      // Push to end of result to break streak
      result.push(t);
      continue;
    }
    result.splice(result.length - (result.length > 0 ? 0 : 0), 0, t);
    lastTwoAngles.push(angle);
    if (lastTwoAngles.length > 2) lastTwoAngles.shift();
  }

  return result;
}

export async function generateContentTopics(
  niche: string,
  keywords: string[],
  tone: string,
  language: string,
  days: number,
  postsPerDay: number,
  topPerformingTopics: string[] = [],
  auditInsights?: AuditInsights,
  strategyContext?: StrategyContext,   // 9th param — takes priority over auditInsights when present
  openaiApiKey?: string | null,
): Promise<ContentPlanTopicMeta[]> {
  const client = makeOpenAIClient(openaiApiKey);
  const total = days * postsPerDay;

  const rawPillars = niche
    .split(/[,;|]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 2);

  const extraKeywords = keywords.filter(
    (k) => !rawPillars.some((p) => p.toLowerCase().includes(k.toLowerCase()))
  );
  const allPillars = [...rawPillars, ...extraKeywords];
  const maxPerPillar = Math.ceil(total / Math.max(allPillars.length, 1));

  // ── Strategy context block (takes priority over raw audit insights) ────────
  const strategyBlock = strategyContext
    ? `
ESTRATEGIA DE CONTENIDO ACTIVA — úsala como contexto principal para este plan:
- Propuesta de valor única del creador: ${strategyContext.content_strategy.unique_value_prop}
- Ángulos editoriales aprobados: ${strategyContext.content_strategy.editorial_angles.join(", ")}
- Dolores/deseos de la audiencia: ${strategyContext.market_insights.audience_pains.slice(0, 5).join("; ")}
- Huecos de contenido a explotar: ${strategyContext.market_insights.content_gaps.slice(0, 4).join("; ")}
- Oportunidades detectadas: ${strategyContext.market_insights.opportunities.slice(0, 4).join("; ")}
- Temas saturados (EVITAR totalmente): ${strategyContext.market_insights.saturated_topics.slice(0, 4).join("; ")}
- Hooks que generan shares en este nicho: ${strategyContext.market_insights.shareable_hooks.slice(0, 4).join("; ")}
- Formatos que funcionan en este nicho: ${strategyContext.market_insights.working_formats.slice(0, 4).join("; ")}
`
    : "";

  // ── Audit insights fallback (when no full strategy) ───────────────────────
  const auditBlock = !strategyContext && auditInsights
    ? `
DATOS REALES DE LA CUENTA (úsalos para mejorar la relevancia):
- Engagement promedio: ${auditInsights.avgEngagement.toFixed(1)}%
${auditInsights.recommendedTopics.length ? `- Temas recomendados por análisis previo: ${auditInsights.recommendedTopics.slice(0, 5).join(", ")}` : ""}
${auditInsights.contentInsights ? `- Insight clave de audiencia: ${auditInsights.contentInsights}` : ""}
${auditInsights.topCaptions.length ? `- Los captions con mejor engagement incluyen temas como: ${auditInsights.topCaptions.slice(0, 3).map((c) => `"${c.substring(0, 80)}"`).join("; ")}` : ""}
`
    : "";

  // ── Pillars section: use strategy pillars when available ─────────────────
  const pillarSection = strategyContext
    ? `PILARES DE CONTENIDO (de la estrategia aprobada — respétalos y distribúyelos así):
${strategyContext.content_strategy.pillars.map((p, i) => `  ${i + 1}. ${p.name} (~${p.frequency_pct}% del plan) — objetivo: ${p.objective}`).join("\n")}

ÁNGULOS EDITORIALES RECOMENDADOS POR LA ESTRATEGIA (varía entre ellos):
${strategyContext.content_strategy.editorial_angles.map((a, i) => `  ${i + 1}. ${a}`).join("\n")}

TIPOS DE HOOKS DE LA ESTRATEGIA (úsalos como inspiración para los hooks de cada tema):
${(strategyContext.content_strategy.hook_types ?? []).slice(0, 5).map((h, i) => `  ${i + 1}. ${h}`).join("\n")}
`
    : `PILARES DE CONTENIDO — distribuye los ${total} temas entre estos pilares (máx ${maxPerPillar} por pilar, nunca 2 seguidos del mismo):
${allPillars.map((p, i) => `  ${i + 1}. ${p}`).join("\n")}

ÁNGULOS POSIBLES POR PILAR (varía entre ellos):
  - Problema del dueño del negocio: "el error que cometen al usar X", "por qué X les cuesta dinero sin saberlo"
  - Perspectiva del cliente final: "qué piensan tus clientes cuando X los atiende"
  - Comparativa: "X vs Y — cuál elegir según tu situación"
  - Tendencia reciente: "qué cambió en X en 2026 y cómo te afecta"
  - Resultado medible: "qué logra una empresa que usa X bien vs una que lo usa mal"
  - Desmitificación: "por qué la mayoría cree que X es difícil (y están equivocados)"
`;

  const prompt = `${EDITORIAL_BASE}

${TALKING_HEAD_CONSTRAINT}

${getLanguageInstruction(language)}

Eres un estratega de contenido para Instagram Reels especializado en crecimiento orgánico.
${strategyBlock}${auditBlock}
Genera un plan de contenido con EXACTAMENTE ${total} temas únicos para:
- Nicho: ${niche}
- Tono: ${tone}
- Idioma: ${language}

TEMAS PROHIBIDOS — NO repetir, NO parafrasear, NO abordar el mismo ángulo:
${topPerformingTopics.slice(0, 12).join("\n") || "N/A"}

${pillarSection}

${TOPIC_CATEGORIES}

REGLA ANTI-DUPLICADOS — CRÍTICA:
  • Cada uno de los ${total} temas debe ser COMPLETAMENTE DIFERENTE en ángulo, formato y subtema
  • Si hay ${postsPerDay} videos el mismo día, sus temas deben hablar de cosas DISTINTAS
  • Antes de escribir cada título, verifica mentalmente que no coincida con ninguno anterior de la lista
  • NUNCA repitas el mismo verbo o estructura en más de 2 títulos del mismo plan

Reglas de calidad:
  • Cada título debe ser específico — evitar genéricos como "Tips de marketing" o "Consejos de IA"
  • Los temas TRENDING deben referenciar contexto real 2025-2026
  • Cada tema debe desarrollarse en un Reel de 45-75 segundos sin necesidad de visuals complejas
  • Los temas deben distribuirse a lo largo de ${days} días, máximo ${postsPerDay} por día
  • OBLIGATORIO: cada tema debe funcionar con un avatar hablando a cámara — sin pantalla compartida, sin demo de software. Si un tema generado naturalmente requería pantalla, transfórmalo al formato talking-head antes de incluirlo.

Para cada tema, devuelve también:
- viral_score: número 0-100 estimando el potencial viral (considera retención, compartibilidad, originalidad)
- angle: letra del formato usado (A-J)
- audience_pain: el dolor o deseo específico de la audiencia que este tema toca (1 frase)
- share_reason: por qué alguien compartiría este video (1 frase específica)
- novelty_level: "low" | "medium" | "high" según qué tan original es el ángulo
- specific_promise: qué aprende o gana el espectador en concreto
- visual_dependency: "low" | "medium" | "high" — nivel de dependencia de visuales externos (low=solo voz basta; medium=soporte simple ok; high=requiere pantalla compartida — EVITAR, transformar el tema antes de incluirlo)
- format_fit_score: 0-100 — aptitud para avatar talking-head (>70 ideal; <50 penalizado; temas con visual_dependency "high" nunca superan 40)
- avatar_fit_reason: 1 frase explicando por qué este tema funciona (o no) sin pantalla compartida
- suggested_visual_support: array con los apoyos visuales simples disponibles a usar — elige los apropiados: ["captions", "punch text", "zoom dramático", "b-roll simple", "checklist overlay", "hook card", "CTA card", "estadística en pantalla"]

Devuelve SOLO un JSON válido:
{
  "topics": [
    {
      "topic": "Título exacto del Reel",
      "days_from_now": 0,
      "pillar": "nombre del pilar",
      "angle": "letra del formato usado (A-J)",
      "category": "emocional|revelacion|resultado|tendencia",
      "viral_score": 75,
      "audience_pain": "descripción del dolor/deseo específico",
      "share_reason": "por qué alguien lo compartiría",
      "novelty_level": "medium",
      "specific_promise": "qué aprende o gana el espectador",
      "visual_dependency": "low",
      "format_fit_score": 85,
      "avatar_fit_reason": "El tema es conceptual y se explica completamente en palabras, sin necesidad de pantalla",
      "suggested_visual_support": ["captions", "punch text", "zoom dramático"]
    }
  ]
}

Genera exactamente ${total} temas distintos. Verifica la lista completa antes de responder para confirmar que no hay duplicados ni temas similares.`;

  const res = await client.chat.completions.create({
    model: "gpt-5.6-luna",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const content = res.choices[0]?.message?.content;
  if (!content) throw new Error("Empty response from AI");

  const parsed = JSON.parse(content) as {
    topics: Array<{
      topic: string;
      days_from_now: number;
      angle?: string;
      viral_score?: number;
      audience_pain?: string;
      share_reason?: string;
      novelty_level?: string;
      specific_promise?: string;
      visual_dependency?: string;
      format_fit_score?: number;
      avatar_fit_reason?: string;
      suggested_visual_support?: string[];
    }>;
  };

  const now = new Date();

  // Programmatic scoring — includes talking-head fit penalties
  const withScores = scoreTopics(
    parsed.topics.map((t) => ({
      topic: t.topic,
      viral_score: t.viral_score ?? 50,
      editorial_angle: t.angle ?? "",
      novelty_level: t.novelty_level ?? "medium",
      share_reason: t.share_reason ?? "",
      visual_dependency: t.visual_dependency ?? "low",
      format_fit_score: t.format_fit_score ?? 70,
    }))
  );

  // Balance angles
  const balanced = balanceAngles(withScores);
  // Map back to original order for date assignment
  const topicMap = new Map(parsed.topics.map((t) => [t.topic, t]));

  return balanced.map((scored) => {
    const orig = topicMap.get(scored.topic)!;
    const date = new Date(now);
    date.setDate(date.getDate() + (orig.days_from_now ?? 0));
    date.setHours(9, 0, 0, 0);
    return {
      topic: scored.topic,
      scheduled_at: date.toISOString(),
      viral_score: scored.adjusted_score,
      editorial_angle: orig.angle ?? "",
      audience_pain: orig.audience_pain ?? "",
      share_reason: orig.share_reason ?? "",
      novelty_level: (orig.novelty_level as "low" | "medium" | "high") ?? "medium",
      specific_promise: orig.specific_promise ?? "",
      visual_dependency: (orig.visual_dependency as "low" | "medium" | "high") ?? "low",
      format_fit_score: orig.format_fit_score ?? 70,
      avatar_talking_head_fit_reason: orig.avatar_fit_reason ?? "",
      suggested_visual_support: orig.suggested_visual_support ?? [],
    };
  });
}

// ── Audit analysis ────────────────────────────────────────────────────────────

export async function analyzeAuditAndRecommend(
  niche: string,
  topPostCaptions: string[],
  avgEngagement: number,
  language: string,
  openaiApiKey?: string | null,
): Promise<{ recommended_topics: string[]; content_insights: string; best_posting_times: string[] }> {
  const client = makeOpenAIClient(openaiApiKey);

  const prompt = `Analiza el rendimiento de una cuenta de Instagram y genera recomendaciones.

Nicho: ${niche}
Idioma: ${language}
Engagement promedio: ${avgEngagement.toFixed(2)}%
Mejores captions/temas de los últimos posts:
${topPostCaptions.slice(0, 10).map((c, i) => `${i + 1}. ${c?.substring(0, 150) || "Sin caption"}`).join("\n")}

Devuelve SOLO un JSON válido:
{
  "recommended_topics": ["tema 1", "tema 2", "tema 3", "tema 4", "tema 5"],
  "content_insights": "2-3 oraciones con insights clave sobre qué tipo de contenido funciona mejor",
  "best_posting_times": ["09:00", "18:00", "21:00"]
}`;

  const res = await client.chat.completions.create({
    model: "gpt-5.6-luna",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const content = res.choices[0]?.message?.content;
  if (!content) throw new Error("Empty AI response");
  return JSON.parse(content);
}

// ── Regenerate script with criterion ─────────────────────────────────────────

export type RegenerateCriterion = "educational" | "controversial" | "storytelling" | "sales" | "emotional";

/** Regenerate the script for an existing content item with a different editorial emphasis. */
// ── Re-analyze existing planned topics against the current strategy profile ───

export async function reanalyzeTopicsWithStrategy(
  topics: Array<{ id: number; topic: string }>,
  strategyContext: StrategyContext,
  openaiApiKey?: string | null,
): Promise<Array<{
  id: number;
  viral_score: number;
  editorial_angle: string;
  visual_dependency: "low" | "medium" | "high";
  format_fit_score: number;
  avatar_fit_reason: string;
  suggested_visual_support: string[];
  audience_pain: string;
  share_reason: string;
}>> {
  const client = makeOpenAIClient(openaiApiKey);

  const strategyBlock = `ESTRATEGIA DEL CREADOR:
- Propuesta de valor única: ${strategyContext.content_strategy.unique_value_prop}
- Ángulos editoriales aprobados: ${strategyContext.content_strategy.editorial_angles.join(", ")}
- Pilares: ${strategyContext.content_strategy.pillars.map((p) => `${p.name} (${p.frequency_pct}%)`).join(", ")}
- Dolores de la audiencia: ${strategyContext.market_insights.audience_pains.slice(0, 5).join("; ")}
- Huecos de contenido a explotar: ${strategyContext.market_insights.content_gaps.slice(0, 4).join("; ")}
- Temas saturados (penalizar): ${strategyContext.market_insights.saturated_topics.slice(0, 4).join("; ")}
- Hooks que generan shares: ${strategyContext.market_insights.shareable_hooks.slice(0, 4).join("; ")}`;

  const prompt = `${TALKING_HEAD_CONSTRAINT}

${strategyBlock}

Tienes esta lista de temas ya planificados para Reels de Instagram. Reevalúa cada uno contra la estrategia del creador y devuelve metadatos actualizados.

TEMAS A EVALUAR:
${topics.map((t) => `- ID ${t.id}: "${t.topic}"`).join("\n")}

Para cada tema devolvé:
- viral_score: 0-100 (potencial viral para esta audiencia específica, ajustado contra la estrategia)
- editorial_angle: nombre corto del ángulo editorial que mejor encaja (preferir los ángulos aprobados de arriba)
- visual_dependency: "low" (sólo avatar) | "medium" (soporte visual simple) | "high" (requiere pantalla o demo en vivo)
- format_fit_score: 0-100 (qué tan bien funciona en talking-head/avatar sin pantalla compartida)
- avatar_fit_reason: 1 frase explicando por qué funciona o no en formato avatar a cámara
- suggested_visual_support: array de 2-3 apoyos visuales disponibles (captions animados, punch text, b-roll genérico, zoom dramático, overlay de texto)
- audience_pain: el dolor específico de la audiencia que este tema aborda (1 frase)
- share_reason: por qué alguien compartiría este video (1 frase concreta)

Devolvé SÓLO JSON válido:
{
  "topics": [
    {
      "id": <número>,
      "viral_score": <0-100>,
      "editorial_angle": "<nombre>",
      "visual_dependency": "low"|"medium"|"high",
      "format_fit_score": <0-100>,
      "avatar_fit_reason": "<frase>",
      "suggested_visual_support": ["<elemento>", "<elemento>"],
      "audience_pain": "<frase>",
      "share_reason": "<frase>"
    }
  ]
}`;

  const result = await client.chat.completions.create({
    model: "gpt-5.6-luna",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const parsed = JSON.parse(result.choices[0]?.message?.content ?? "{}") as {
    topics: Array<{
      id: number;
      viral_score: number;
      editorial_angle: string;
      visual_dependency: string;
      format_fit_score: number;
      avatar_fit_reason: string;
      suggested_visual_support: string[];
      audience_pain: string;
      share_reason: string;
    }>;
  };

  return (parsed.topics ?? []).map((t) => ({
    id: t.id,
    viral_score:             Math.max(0, Math.min(100, Math.round(t.viral_score ?? 50))),
    editorial_angle:         t.editorial_angle ?? "",
    visual_dependency:       (["low", "medium", "high"].includes(t.visual_dependency) ? t.visual_dependency : "low") as "low" | "medium" | "high",
    format_fit_score:        Math.max(0, Math.min(100, Math.round(t.format_fit_score ?? 70))),
    avatar_fit_reason:       t.avatar_fit_reason ?? "",
    suggested_visual_support: Array.isArray(t.suggested_visual_support) ? t.suggested_visual_support : [],
    audience_pain:           t.audience_pain ?? "",
    share_reason:            t.share_reason ?? "",
  }));
}

export async function regenerateScriptWithCriterion(
  topic: string,
  niche: string,
  tone: string,
  language: string,
  durationSeconds: number,
  criterion: RegenerateCriterion,
  auditInsights?: AuditInsights,
  openaiApiKey?: string | null,
): Promise<ScriptOutput> {
  return generateScript(topic, niche, tone, language, durationSeconds, { criterion, auditInsights, openaiApiKey });
}
