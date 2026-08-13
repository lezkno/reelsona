/**
 * AI functions for the Strategic Audit flow:
 *  - synthesizeMarketStudy   → MarketInsights
 *  - generateContentStrategy → ContentStrategy
 */

import { makeOpenAIClient } from "./openai-client";

// ── Shared types (exported so routes and ai-scripts can import them) ──────────

export interface AccountData {
  avg_engagement: number;
  avg_reach: number;
  best_posting_times: string[];
  top_posts: {
    id: string;
    thumbnail_url: string | null;
    caption: string | null;
    like_count: number;
    comments_count: number;
    plays: number | null;
    engagement_rate: number | null;
    permalink: string | null;
  }[];
  top_captions: string[];      // best-performing captions for AI context
  follower_count: number;
  media_count: number;
  fetched_at: string;
}

export interface RadarTopPost {
  url: string | null;
  caption: string | null;
  likesCount: number;
  commentsCount: number;
}

export interface RadarAccount {
  ig_username: string;
  bio: string | null;
  followers: number | null;
  use_as_reference: boolean;
  top_posts?: RadarTopPost[] | null;
  last_synced_at?: Date | null;
}

export interface MarketInsights {
  top_themes: string[];           // themes that perform well on this account
  working_formats: string[];      // Reel formats that get traction
  audience_pains: string[];       // pain points / desires of the audience
  content_gaps: string[];         // topics nobody in the niche covers well
  saturated_topics: string[];     // oversaturated, avoid
  opportunities: string[];        // specific content opportunities
  shareable_hooks: string[];      // hook archetypes that drive shares
  analyzed_at: string;
}

export interface ContentStrategy {
  pillars: {
    name: string;
    objective: string;
    frequency_pct: number;        // 0-100
    example_topics: string[];
  }[];
  editorial_angles: string[];     // maps to editorial_angle in Viral Engine
  format_mix: {
    educational: number;
    emotional: number;
    sales: number;
    controversial: number;
    storytelling: number;
  };
  unique_value_prop: string;      // what differentiates this creator
  hook_types: string[];           // hook archetypes to use
  recommended_ctas: string[];
  posting_frequency: string;      // e.g. "5 videos por semana"
  generated_at: string;
}

export interface StrategyContext {
  content_strategy: ContentStrategy;
  market_insights: MarketInsights;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getLanguageInstruction(lang: string): string {
  const map: Record<string, string> = {
    es: "Responde siempre en español.",
    en: "Always respond in English.",
    pt: "Responda sempre em português.",
    fr: "Répondez toujours en français.",
    de: "Antworten Sie immer auf Deutsch.",
    it: "Rispondi sempre in italiano.",
  };
  return map[lang] ?? "Responde siempre en español.";
}

// ── synthesizeMarketStudy ─────────────────────────────────────────────────────

export async function synthesizeMarketStudy(opts: {
  niche: string;
  nicheDescription?: string | null;
  topicKeywords: string[];
  tone: string;
  language: string;
  accountData: AccountData;
  radarAccounts: RadarAccount[];
  openaiApiKey?: string | null;
}): Promise<MarketInsights> {
  const { niche, nicheDescription, topicKeywords, tone, language, accountData, radarAccounts } = opts;
  const client = makeOpenAIClient();

  const topCaptionsBlock = accountData.top_captions.slice(0, 5).map((c, i) => `  ${i + 1}. "${c.substring(0, 120)}"`).join("\n");

  const radarBlock = radarAccounts
    .filter((r) => {
      if (!r.use_as_reference) return false;
      const hasBio = Boolean(r.bio);
      const hasPosts = (r.top_posts ?? []).length > 0;
      // Omit accounts with neither bio nor posts — they add no signal to the model
      return hasBio || hasPosts;
    })
    .slice(0, 6)
    .map((r) => {
      const isApifyVerified = Boolean(r.last_synced_at);
      const dataSource = isApifyVerified
        ? `✓ verificado por Apify el ${r.last_synced_at!.toLocaleDateString("es-ES")}`
        : "ingresado manualmente";
      const base = `  - @${r.ig_username} [${dataSource}] (${r.followers?.toLocaleString() ?? "?"} seguidores): ${r.bio?.substring(0, 100) ?? "(sin bio)"}`;
      const posts = (r.top_posts ?? []).slice(0, 3);
      if (posts.length === 0) return base;
      const postLines = posts
        .map((p) => `      • ${p.caption?.substring(0, 80) ?? "(sin caption)"} [❤ ${p.likesCount} | 💬 ${p.commentsCount}]`)
        .join("\n");
      return `${base}\n    Top posts:\n${postLines}`;
    })
    .join("\n") || "  (ninguno con datos suficientes)";

  const prompt = `${getLanguageInstruction(language)}

Eres un estratega senior de contenido para Instagram Reels. Analiza los datos de la cuenta y el nicho para producir un Estudio de Mercado estructurado.

RESTRICCIÓN DE FORMATO — CRÍTICA:
El contenido de esta cuenta se produce con un AVATAR DE IA mirando a cámara (estilo podcast/experto). NO existe pantalla compartida, NO hay tutorial visual en vivo. Todo formato recomendado debe poder ejecutarse con avatar hablando + captions + texto en pantalla. Excluye de "working_formats" cualquier formato que requiera pantalla compartida, dashboard en vivo o demostración de software.

DATOS DE LA CUENTA PROPIA:
- Nicho: ${niche}${nicheDescription ? ` — ${nicheDescription}` : ""}
- Keywords del creador: ${topicKeywords.join(", ") || "no especificadas"}
- Tono de contenido: ${tone}
- Engagement promedio: ${accountData.avg_engagement.toFixed(1)}%
- Alcance promedio: ${Math.round(accountData.avg_reach)} personas por post
- Mejores horarios de publicación: ${accountData.best_posting_times.join(", ") || "no definidos"}
- Seguidores: ${accountData.follower_count.toLocaleString()}

CAPTIONS CON MAYOR ENGAGEMENT (de mejor a peor):
${topCaptionsBlock || "  (no disponibles)"}

REFERENTES DEL NICHO (radar):
${radarBlock}

Devuelve SOLO un JSON con esta estructura exacta:
{
  "top_themes": ["tema que funciona 1", "tema que funciona 2", ...],
  "working_formats": ["formato que genera engagement: ej. 'comparativa A vs B'", ...],
  "audience_pains": ["dolor/deseo específico de la audiencia 1", ...],
  "content_gaps": ["tema que nadie cubre bien en este nicho 1", ...],
  "saturated_topics": ["tema sobreexplotado, evitar 1", ...],
  "opportunities": ["oportunidad concreta de contenido 1", ...],
  "shareable_hooks": ["arquetipo de hook que genera shares: ej. 'El error que comete el 80%...'", ...]
}

Reglas:
- top_themes: 5-8 temas reales basados en los captions ganadores
- working_formats: 4-6 formatos COMPATIBLES con avatar talking-head (ej: "mito vs realidad", "error + consecuencia", "antes/después verbal", "checklist de decisión", "opinión experta con datos") — NUNCA incluir "tutorial paso a paso con pantalla", "walkthrough de software" u otros que requieran visuales externos
- audience_pains: 4-6 dolores/deseos específicos de esta audiencia
- content_gaps: 3-5 huecos reales de contenido en el nicho
- saturated_topics: 3-5 temas a evitar
- opportunities: 4-6 oportunidades concretas y accionables
- shareable_hooks: 4-6 arquetipos de hook

Sé específico al nicho y los datos. NO generes respuestas genéricas.`;

  const res = await client.chat.completions.create({
    model: "gpt-5.6-luna",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const raw = JSON.parse(res.choices[0]?.message?.content ?? "{}") as Partial<MarketInsights>;
  return {
    top_themes:       raw.top_themes       ?? [],
    working_formats:  raw.working_formats  ?? [],
    audience_pains:   raw.audience_pains   ?? [],
    content_gaps:     raw.content_gaps     ?? [],
    saturated_topics: raw.saturated_topics ?? [],
    opportunities:    raw.opportunities    ?? [],
    shareable_hooks:  raw.shareable_hooks  ?? [],
    analyzed_at:      new Date().toISOString(),
  };
}

// ── generateContentStrategy ───────────────────────────────────────────────────

export async function generateContentStrategy(opts: {
  niche: string;
  nicheDescription?: string | null;
  topicKeywords: string[];
  tone: string;
  language: string;
  accountData: AccountData;
  marketInsights: MarketInsights;
  radarAccounts: RadarAccount[];
  openaiApiKey?: string | null;
}): Promise<ContentStrategy> {
  const { niche, nicheDescription, topicKeywords, tone, language, accountData, marketInsights } = opts;
  const client = makeOpenAIClient();

  const prompt = `${getLanguageInstruction(language)}

Eres un estratega de contenido para Instagram Reels. Crea una Estrategia de Contenido estructurada basada en el análisis de mercado.

RESTRICCIÓN DE FORMATO — OBLIGATORIA:
El contenido se graba con un AVATAR DE IA hablando a cámara (talking-head/podcast). NO hay pantalla compartida, NO hay tutoriales de software en vivo. TODOS los pilares, ángulos editoriales y hook_types que propongas deben poder ejecutarse con avatar hablando + captions + punch text. Ejemplos de lo que SÍ funciona: opinión experta, errores + consecuencias, mitos, checklist verbal, comparaciones A vs B en palabras, historias, "lo que nadie te dice", marcos de decisión verbal.

PERFIL DEL CREADOR:
- Nicho: ${niche}${nicheDescription ? ` — ${nicheDescription}` : ""}
- Keywords: ${topicKeywords.join(", ") || "no especificadas"}
- Tono: ${tone}
- Seguidores: ${accountData.follower_count.toLocaleString()}
- Engagement actual: ${accountData.avg_engagement.toFixed(1)}%

ESTUDIO DE MERCADO:
- Temas que funcionan: ${marketInsights.top_themes.slice(0, 5).join("; ")}
- Formatos que generan engagement: ${marketInsights.working_formats.slice(0, 4).join("; ")}
- Dolores/deseos de la audiencia: ${marketInsights.audience_pains.slice(0, 4).join("; ")}
- Huecos de contenido: ${marketInsights.content_gaps.slice(0, 3).join("; ")}
- Oportunidades detectadas: ${marketInsights.opportunities.slice(0, 4).join("; ")}
- Temas saturados (evitar): ${marketInsights.saturated_topics.slice(0, 3).join("; ")}

Devuelve SOLO un JSON con esta estructura:
{
  "pillars": [
    {
      "name": "Nombre del pilar",
      "objective": "Qué logra este pilar (1 frase)",
      "frequency_pct": 30,
      "example_topics": ["Ejemplo de tema 1", "Ejemplo de tema 2"]
    }
  ],
  "editorial_angles": ["ángulo editorial 1", "ángulo editorial 2", ...],
  "format_mix": {
    "educational": 30,
    "emotional": 20,
    "sales": 15,
    "controversial": 20,
    "storytelling": 15
  },
  "unique_value_prop": "Qué diferencia a este creador de los demás en el nicho (1-2 frases)",
  "hook_types": ["arquetipo de hook 1", "arquetipo de hook 2", ...],
  "recommended_ctas": ["CTA 1", "CTA 2", ...],
  "posting_frequency": "X videos por semana"
}

Reglas:
- pillars: 3-4 pilares, frequency_pct deben sumar 100
- editorial_angles: 5-7 ángulos específicos al nicho, todos ejecutables con avatar talking-head (ej: "El error que comete el 80% de los X", "Lo que nadie en el nicho te dice sobre Y", "Antes de hacer X entiende Y") — NINGUNO puede requerir demostración en pantalla
- format_mix: valores suman 100, ajustados a lo que funciona en el nicho
- unique_value_prop: específico y diferencial, NO genérico
- hook_types: 4-6 arquetipos de hook que aplican al nicho
- recommended_ctas: 3-5 CTAs específicos y accionables

Sé muy específico al nicho "${niche}". Evita estrategias genéricas.`;

  const res = await client.chat.completions.create({
    model: "gpt-5.6-luna",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const raw = JSON.parse(res.choices[0]?.message?.content ?? "{}") as Partial<ContentStrategy>;
  return {
    pillars:            raw.pillars            ?? [],
    editorial_angles:   raw.editorial_angles   ?? [],
    format_mix:         raw.format_mix         ?? { educational: 30, emotional: 20, sales: 15, controversial: 20, storytelling: 15 },
    unique_value_prop:  raw.unique_value_prop  ?? "",
    hook_types:         raw.hook_types         ?? [],
    recommended_ctas:   raw.recommended_ctas   ?? [],
    posting_frequency:  raw.posting_frequency  ?? "",
    generated_at:       new Date().toISOString(),
  };
}
