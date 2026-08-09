import { useState } from "react";
import { CheckoutModal } from "./CheckoutModal";
import {
  ArrowRight,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  Brain,
  LayoutTemplate,
  MessageSquare,
  Play,
  Sparkles,
  TrendingUp,
  Zap,
  Rocket,
  MonitorPlay,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Data ──────────────────────────────────────────────────────────────────────

const steps = [
  {
    n: "01",
    Icon: Brain,
    title: "Define tu estrategia",
    desc: "El sistema analiza tu nicho y genera un plan de temas con hooks para los próximos 30 días.",
  },
  {
    n: "02",
    Icon: MessageSquare,
    title: "Genera los guiones",
    desc: "IA escribe los guiones adaptados a tu audiencia y al formato de Reels, listos para revisar.",
  },
  {
    n: "03",
    Icon: Zap,
    title: "El avatar lo graba por ti",
    desc: "Tu avatar IA narra el video con captions y estructura visual incluidos. Sin editar nada.",
  },
  {
    n: "04",
    Icon: Calendar,
    title: "Publica y repite",
    desc: "Programa la publicación en Instagram y mantén el flujo de contenido sin trabajo manual.",
  },
];

const benefits = [
  { Icon: Sparkles, text: "Sin quedarte sin ideas: el sistema genera el plan de contenido por ti" },
  { Icon: Clock, text: "Sin grabarte a diario: tu avatar habla por ti en cada Reel" },
  { Icon: MessageSquare, text: "Guiones y hooks listos, pensados para el formato de avatar" },
  { Icon: LayoutTemplate, text: "Captions y estructura visual generados automáticamente" },
  { Icon: Calendar, text: "Publicación programada en Instagram desde la plataforma" },
  { Icon: TrendingUp, text: "Ruta guiada paso a paso, desde cero hasta tu primer Reel publicado" },
];

const includes = [
  "Ruta guiada de implementación desde cero",
  "Plataforma para generar estrategia, guiones y videos",
  "Estudio de mercado con análisis de competidores",
  "Generador de guiones con hooks para Reels",
  "Videos producidos con tu avatar IA en HeyGen",
  "Captions con estilo visual automáticos",
  "Publicación programada en Instagram",
  "Área de clases paso a paso incluida",
  "Plantillas y checklists de producción",
];

const flowItems = [
  "Dashboard con tu plan de contenido activo",
  "Generador de estrategia y análisis de nicho",
  "Editor de guiones con hooks por Reel",
  "Producción de videos con tu avatar en HeyGen",
  "Estudio de captions con plantillas visuales",
  "Publicación directa en Instagram",
];

const faqs = [
  {
    q: "¿Reelsona es una herramienta para crear avatares?",
    a: "No. Reelsona no crea avatares ni compite con HeyGen. Es un sistema que usa tu avatar existente en HeyGen para automatizar todo el proceso: estrategia, guiones, producción del video y publicación. Piénsalo como el sistema de operaciones detrás de tus Reels, no como el generador del avatar.",
  },
  {
    q: "¿Necesito tener un avatar en HeyGen antes de empezar?",
    a: "Puedes empezar a configurar la estrategia y guiones sin un avatar listo. Para la producción de videos sí necesitarás una cuenta en HeyGen. Dentro de Reelsona tienes una ruta guiada que te explica cómo crear y conectar tu avatar paso a paso.",
  },
  {
    q: "¿Qué herramientas externas necesito?",
    a: "Para generar los videos necesitarás cuentas en HeyGen y OpenAI. Sus costos no están incluidos en Reelsona — te guiamos a configurarlas desde cero y son herramientas que usarías de todas formas para crear contenido con avatar IA.",
  },
  {
    q: "¿Necesito saber editar videos?",
    a: "No. El sistema genera los videos completos con tu avatar, captions incluidos. No necesitas abrir ningún editor de video.",
  },
  {
    q: "¿Tengo que grabarme frente a una cámara?",
    a: "No. Tu avatar IA habla por ti en cada Reel. Tú revisas o editas el guión si quieres, y el sistema produce el video.",
  },
  {
    q: "¿Esto funciona si no tengo experiencia técnica?",
    a: "Sí. El sistema tiene una ruta guiada diseñada para llevarte desde cero. No necesitas conocimientos técnicos previos.",
  },
  {
    q: "¿Qué pasa después de comprar?",
    a: "Recibirás un email de activación. Con ese link creas tu contraseña y accedes al sistema completo de inmediato.",
  },
  {
    q: "¿Puedo publicar directamente en Instagram?",
    a: "Sí. Puedes conectar tu cuenta de Instagram Business desde la plataforma y programar la publicación de tus Reels.",
  },
];

// ─── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="block mb-3 text-xs font-semibold tracking-widest uppercase"
      style={{ color: "#4F6EF7" }}
    >
      {children}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="font-display font-bold tracking-tight"
      style={{
        fontFamily: "var(--font-display, 'Outfit', sans-serif)",
        fontSize: "clamp(1.55rem, 4vw, 2.4rem)",
        letterSpacing: "-0.025em",
        lineHeight: 1.15,
      }}
    >
      {children}
    </h2>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function Landing() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  return (
    <div
      className="antialiased"
      style={{
        backgroundColor: "#090909",
        color: "#f0f0f0",
        fontFamily: "var(--font-sans, 'Plus Jakarta Sans', sans-serif)",
        minHeight: "100vh",
        overflowX: "hidden",
      }}
    >
      {/* ── NAV ── */}
      <nav
        className="sticky top-0 z-50 flex items-center justify-between px-6"
        style={{
          height: 60,
          backgroundColor: "rgba(9,9,9,0.88)",
          backdropFilter: "blur(14px)",
          borderBottom: "1px solid #191919",
        }}
      >
        <div className="flex items-center gap-2">
          <img
            src={`${BASE}/logo.png`}
            alt="Reelsona"
            style={{ width: 30, height: 30, objectFit: "contain" }}
          />
          <span
            className="font-bold tracking-tight"
            style={{
              fontFamily: "var(--font-display, 'Outfit', sans-serif)",
              fontSize: "1.05rem",
            }}
          >
            Reelsona
          </span>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={`${BASE}/login`}
            className="text-sm transition-colors"
            style={{ color: "#666", textDecoration: "none" }}
          >
            Acceder
          </a>
          <button
            onClick={() => setCheckoutOpen(true)}
            className="text-sm font-semibold rounded-lg transition-opacity hover:opacity-90"
            style={{
              backgroundColor: "#4F6EF7",
              color: "#fff",
              padding: "0.45rem 1rem",
              border: "none",
              cursor: "pointer",
            }}
          >
            Empezar →
          </button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section
        className="relative flex items-center justify-center overflow-hidden"
        style={{
          minHeight: "calc(100vh - 60px)",
          padding: "5rem 1.5rem 4rem",
        }}
      >
        {/* grid bg */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(rgba(79,110,247,0.035) 1px, transparent 1px),
              linear-gradient(90deg, rgba(79,110,247,0.035) 1px, transparent 1px)
            `,
            backgroundSize: "64px 64px",
          }}
        />
        {/* radial glow */}
        <div
          className="absolute pointer-events-none"
          style={{
            top: "35%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: 700,
            height: 420,
            background: "radial-gradient(ellipse, rgba(79,110,247,0.11) 0%, transparent 70%)",
          }}
        />

        <div className="relative z-10 mx-auto w-full" style={{ maxWidth: 1080 }}>
          <div
            className="grid items-center"
            style={{
              gridTemplateColumns: "1fr auto",
              gap: "clamp(2rem, 5vw, 5rem)",
            }}
          >
            {/* ── LEFT: copy ── */}
            <div>
              {/* badge */}
              <div
                className="inline-flex items-center gap-1.5 rounded-full text-xs font-semibold tracking-widest uppercase mb-7"
                style={{
                  backgroundColor: "rgba(79,110,247,0.09)",
                  border: "1px solid rgba(79,110,247,0.22)",
                  padding: "0.3rem 0.9rem",
                  color: "#4F6EF7",
                }}
              >
                <Sparkles size={11} />
                Sistema guiado de Reels con IA
              </div>

              <h1
                className="font-bold tracking-tight"
                style={{
                  fontFamily: "var(--font-display, 'Outfit', sans-serif)",
                  fontSize: "clamp(2.1rem, 5vw, 3.8rem)",
                  lineHeight: 1.08,
                  letterSpacing: "-0.035em",
                  marginBottom: "1.4rem",
                }}
              >
                Publica Reels con tu avatar{" "}
                <span
                  style={{
                    background: "linear-gradient(135deg, #4F6EF7 10%, #9B5CF6 90%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                    display: "block",
                  }}
                >
                  sin grabarte ni editar a diario
                </span>
              </h1>

              <p
                style={{
                  fontSize: "clamp(0.95rem, 1.8vw, 1.1rem)",
                  color: "#999",
                  lineHeight: 1.75,
                  maxWidth: 500,
                  marginBottom: "2rem",
                }}
              >
                Un sistema guiado que crea la estrategia, genera los guiones, produce
                los videos con tu avatar y los prepara para publicar en Instagram.
              </p>

              <div className="flex flex-wrap gap-3" style={{ marginBottom: "1.25rem" }}>
                <button
                  onClick={() => setCheckoutOpen(true)}
                  className="inline-flex items-center gap-2 rounded-xl font-bold transition-opacity hover:opacity-90"
                  style={{
                    backgroundColor: "#4F6EF7",
                    color: "#fff",
                    padding: "0.9rem 2rem",
                    fontSize: "1rem",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  Empezar a crear Reels <ArrowRight size={16} />
                </button>
                <a
                  href="#como-funciona"
                  className="inline-flex items-center gap-2 rounded-xl font-semibold transition-colors"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.04)",
                    border: "1px solid #252525",
                    color: "#e0e0e0",
                    padding: "0.9rem 2rem",
                    fontSize: "1rem",
                    textDecoration: "none",
                  }}
                >
                  <Play size={14} fill="currentColor" /> Ver cómo funciona
                </a>
              </div>

              {/* tools note */}
              <p
                style={{
                  fontSize: "0.78rem",
                  color: "#555",
                  lineHeight: 1.6,
                  marginBottom: "1.5rem",
                }}
              >
                Funciona con tu cuenta de HeyGen y OpenAI.{" "}
                <span style={{ color: "#444" }}>
                  Te guiamos a configurarlas paso a paso.
                </span>
              </p>

              {/* social proof strip */}
              <div
                className="flex items-center gap-5 flex-wrap"
                style={{ color: "#555", fontSize: "0.8rem" }}
              >
                {[
                  "Guión listo en minutos",
                  "Video producido con tu avatar",
                  "Publicación automática en Instagram",
                ].map((t) => (
                  <span key={t} className="flex items-center gap-1.5">
                    <Check size={11} color="#4F6EF7" strokeWidth={3} /> {t}
                  </span>
                ))}
              </div>
            </div>

            {/* ── RIGHT: avatar image ── */}
            <div
              className="hidden md:block flex-shrink-0"
              style={{ position: "relative" }}
            >
              <div
                className="absolute pointer-events-none"
                style={{
                  inset: "-20px",
                  background:
                    "radial-gradient(ellipse at center, rgba(79,110,247,0.22) 0%, transparent 70%)",
                  borderRadius: "9999px",
                  zIndex: 0,
                }}
              />
              <img
                src={`${BASE}/hero-avatar.jpg`}
                alt="Video de Reel generado con avatar IA"
                style={{
                  position: "relative",
                  zIndex: 1,
                  width: "clamp(260px, 22vw, 360px)",
                  aspectRatio: "9/16",
                  objectFit: "cover",
                  objectPosition: "top",
                  borderRadius: "2rem",
                  border: "1px solid rgba(79,110,247,0.25)",
                  boxShadow:
                    "0 0 60px rgba(79,110,247,0.18), 0 24px 60px rgba(0,0,0,0.6)",
                }}
              />
              {/* "Generado con IA" label */}
              <div
                style={{
                  position: "absolute",
                  bottom: "1.2rem",
                  left: "50%",
                  transform: "translateX(-50%)",
                  zIndex: 2,
                  backgroundColor: "rgba(9,9,9,0.82)",
                  backdropFilter: "blur(8px)",
                  border: "1px solid rgba(79,110,247,0.3)",
                  borderRadius: "9999px",
                  padding: "0.3rem 0.85rem",
                  fontSize: "0.68rem",
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  color: "#4F6EF7",
                  whiteSpace: "nowrap",
                }}
              >
                ✦ VIDEO GENERADO CON AVATAR IA
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── VIDEO VENTAS ── */}
      <section
        id="como-funciona-video"
        className="mx-auto px-6"
        style={{ maxWidth: 900, paddingTop: "5rem", paddingBottom: "5rem" }}
      >
        <div className="text-center mb-8">
          <SectionTitle>Mira el sistema en acción</SectionTitle>
          <p
            className="mx-auto mt-4"
            style={{
              color: "#666",
              maxWidth: 520,
              lineHeight: 1.75,
              fontSize: "0.95rem",
            }}
          >
            Cómo pasar de no saber qué publicar a tener Reels con avatar
            produciéndose y publicándose en piloto automático.
          </p>
        </div>

        {/* Video placeholder — intencional, próximamente */}
        <div
          className="relative w-full rounded-2xl overflow-hidden"
          style={{
            paddingTop: "56.25%",
            backgroundColor: "#0e0e0e",
            border: "1px solid #1e1e1e",
          }}
        >
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-4"
            style={{
              background: "linear-gradient(135deg, #0c0c0c 0%, #141420 100%)",
            }}
          >
            <div
              className="flex items-center justify-center rounded-full"
              style={{
                width: 72,
                height: 72,
                background: "linear-gradient(135deg, rgba(79,110,247,0.15), rgba(155,92,246,0.15))",
                border: "2px solid rgba(79,110,247,0.35)",
              }}
            >
              <MonitorPlay size={28} color="#4F6EF7" />
            </div>
            <div className="text-center">
              <p
                className="font-semibold mb-1"
                style={{ color: "#ccc", fontSize: "0.95rem" }}
              >
                Video de presentación
              </p>
              <p style={{ color: "#444", fontSize: "0.78rem" }}>Próximamente</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── PASOS ── */}
      <section
        id="como-funciona"
        style={{
          backgroundColor: "#0d0d0d",
          borderTop: "1px solid #161616",
          borderBottom: "1px solid #161616",
          padding: "5rem 1.5rem",
        }}
      >
        <div className="mx-auto" style={{ maxWidth: 1040 }}>
          <div className="text-center mb-14">
            <SectionLabel>El proceso</SectionLabel>
            <SectionTitle>Cómo funciona Reelsona</SectionTitle>
            <p
              className="mx-auto mt-4"
              style={{ color: "#666", maxWidth: 500, fontSize: "0.9rem", lineHeight: 1.7 }}
            >
              No configuramos avatares — usamos el tuyo para automatizar
              la producción de Reels de principio a fin.
            </p>
          </div>

          <div
            className="grid gap-5"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
          >
            {steps.map(({ n, Icon, title, desc }) => (
              <div
                key={n}
                className="relative rounded-2xl overflow-hidden"
                style={{
                  backgroundColor: "#111",
                  border: "1px solid #1e1e1e",
                  padding: "1.75rem 1.5rem",
                }}
              >
                <span
                  className="absolute select-none"
                  style={{
                    top: "0.6rem",
                    right: "1rem",
                    fontSize: "3.2rem",
                    fontWeight: 900,
                    color: "#1a1a1a",
                    fontFamily: "var(--font-display, 'Outfit', sans-serif)",
                    lineHeight: 1,
                  }}
                >
                  {n}
                </span>
                <div
                  className="flex items-center justify-center rounded-xl mb-4"
                  style={{
                    width: 42,
                    height: 42,
                    backgroundColor: "rgba(79,110,247,0.1)",
                    color: "#4F6EF7",
                  }}
                >
                  <Icon size={19} />
                </div>
                <h3
                  className="font-bold mb-2"
                  style={{
                    fontFamily: "var(--font-display, 'Outfit', sans-serif)",
                    fontSize: "0.975rem",
                  }}
                >
                  {title}
                </h3>
                <p style={{ color: "#666", fontSize: "0.855rem", lineHeight: 1.65 }}>
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FLUJO DE LA PLATAFORMA (reemplaza video demo) ── */}
      <section
        className="mx-auto px-6"
        style={{ maxWidth: 960, paddingTop: "5rem", paddingBottom: "5rem" }}
      >
        <div
          className="grid gap-12 items-center"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}
        >
          {/* text */}
          <div>
            <SectionLabel>Dentro de la plataforma</SectionLabel>
            <SectionTitle>
              Todo el flujo en<br />un solo lugar
            </SectionTitle>
            <p
              className="mt-4 mb-6"
              style={{ color: "#666", fontSize: "0.9rem", lineHeight: 1.7 }}
            >
              Desde la estrategia hasta la publicación, cada paso del proceso
              tiene su módulo dentro de Reelsona. Sin saltar entre herramientas,
              sin perder el hilo.
            </p>
            <ul className="flex flex-col gap-3">
              {flowItems.map((item) => (
                <li key={item} className="flex items-center gap-3">
                  <span
                    className="flex-shrink-0 flex items-center justify-center rounded-full"
                    style={{
                      width: 20,
                      height: 20,
                      backgroundColor: "rgba(79,110,247,0.12)",
                      border: "1px solid rgba(79,110,247,0.28)",
                    }}
                  >
                    <Check size={9} color="#4F6EF7" strokeWidth={3.5} />
                  </span>
                  <span style={{ color: "#999", fontSize: "0.88rem" }}>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* platform mockup placeholder */}
          <div
            className="relative rounded-2xl overflow-hidden"
            style={{
              backgroundColor: "#0e0e0e",
              border: "1px solid #1e1e1e",
              minHeight: 320,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "1rem",
              padding: "2.5rem",
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "1rem",
                background: "linear-gradient(135deg, rgba(79,110,247,0.18), rgba(155,92,246,0.18))",
                border: "1px solid rgba(79,110,247,0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Rocket size={24} color="#4F6EF7" />
            </div>
            <p
              className="font-semibold text-center"
              style={{ color: "#ccc", fontSize: "0.95rem" }}
            >
              Demo de la plataforma
            </p>
            <p
              className="text-center"
              style={{ color: "#444", fontSize: "0.78rem", maxWidth: 220 }}
            >
              Capturas y recorrido visual próximamente
            </p>
          </div>
        </div>
      </section>

      {/* ── BENEFITS ── */}
      <section
        style={{
          backgroundColor: "#0d0d0d",
          borderTop: "1px solid #161616",
          borderBottom: "1px solid #161616",
          padding: "5rem 1.5rem",
        }}
      >
        <div className="mx-auto" style={{ maxWidth: 920 }}>
          <div className="text-center mb-12">
            <SectionLabel>Lo que cambia</SectionLabel>
            <SectionTitle>
              Deja de improvisar,<br />empieza a producir
            </SectionTitle>
          </div>

          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))" }}
          >
            {benefits.map(({ Icon, text }) => (
              <div
                key={text}
                className="flex items-start gap-3 rounded-xl"
                style={{
                  backgroundColor: "#111",
                  border: "1px solid #1e1e1e",
                  padding: "1.1rem 1.25rem",
                }}
              >
                <div
                  className="flex-shrink-0 flex items-center justify-center rounded-lg"
                  style={{
                    width: 36,
                    height: 36,
                    backgroundColor: "rgba(79,110,247,0.09)",
                    color: "#4F6EF7",
                  }}
                >
                  <Icon size={16} />
                </div>
                <span
                  style={{
                    color: "#bbb",
                    fontSize: "0.875rem",
                    lineHeight: 1.55,
                    paddingTop: 2,
                  }}
                >
                  {text}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── QUÉ OBTIENES ── */}
      <section
        className="mx-auto px-6"
        style={{ maxWidth: 820, paddingTop: "5rem", paddingBottom: "5rem" }}
      >
        <div className="text-center mb-4">
          <SectionLabel>Dentro del sistema</SectionLabel>
          <SectionTitle>Qué obtienes al entrar</SectionTitle>
        </div>
        <p
          className="text-center mx-auto mb-10"
          style={{
            color: "#666",
            fontSize: "0.9rem",
            lineHeight: 1.75,
            maxWidth: 520,
          }}
        >
          Dentro encuentras la ruta guiada, la plataforma y los pasos
          prácticos para configurar tu sistema de contenido de Reels.
        </p>

        <div
          className="rounded-2xl"
          style={{
            backgroundColor: "#111",
            border: "1px solid #1e1e1e",
            padding: "2.25rem 2rem",
          }}
        >
          <div
            className="rounded-t-2xl absolute"
            style={{
              height: 2,
              background: "linear-gradient(90deg, #4F6EF7, #9B5CF6, transparent)",
              marginTop: "-2.25rem",
              marginLeft: "-2rem",
              width: "60%",
              borderRadius: "12px 0 0 0",
            }}
          />
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}
          >
            {includes.map((item) => (
              <div key={item} className="flex items-center gap-3">
                <span
                  className="flex-shrink-0 flex items-center justify-center rounded-full"
                  style={{
                    width: 22,
                    height: 22,
                    backgroundColor: "rgba(79,110,247,0.13)",
                    border: "1px solid rgba(79,110,247,0.28)",
                  }}
                >
                  <Check size={10} color="#4F6EF7" strokeWidth={3} />
                </span>
                <span style={{ color: "#ccc", fontSize: "0.875rem" }}>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section
        style={{
          backgroundColor: "#0d0d0d",
          borderTop: "1px solid #161616",
          padding: "5rem 1.5rem",
        }}
      >
        <div className="mx-auto" style={{ maxWidth: 660 }}>
          <div className="text-center mb-10">
            <SectionTitle>Preguntas frecuentes</SectionTitle>
          </div>

          <div>
            {faqs.map((faq, i) => (
              <div
                key={i}
                style={{
                  borderBottom:
                    i < faqs.length - 1 ? "1px solid #1a1a1a" : "none",
                }}
              >
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full text-left flex items-center justify-between gap-4 py-5 bg-transparent border-0 cursor-pointer"
                  style={{ color: "#e8e8e8", fontSize: "0.925rem", fontWeight: 600 }}
                >
                  <span>{faq.q}</span>
                  <ChevronDown
                    size={15}
                    color="#444"
                    style={{
                      flexShrink: 0,
                      transform: openFaq === i ? "rotate(180deg)" : "none",
                      transition: "transform 0.2s ease",
                    }}
                  />
                </button>
                {openFaq === i && (
                  <p
                    className="pb-5 m-0"
                    style={{ color: "#777", fontSize: "0.875rem", lineHeight: 1.75 }}
                  >
                    {faq.a}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRECIO / ACCESO ── */}
      <section
        className="mx-auto px-6"
        style={{ maxWidth: 560, paddingTop: "5rem", paddingBottom: "5rem" }}
      >
        <div
          className="rounded-2xl text-center"
          style={{
            backgroundColor: "#111",
            border: "1px solid rgba(79,110,247,0.25)",
            padding: "2.5rem 2rem",
          }}
        >
          <SectionLabel>Acceso de lanzamiento</SectionLabel>
          <div
            className="font-bold"
            style={{
              fontFamily: "var(--font-display, 'Outfit', sans-serif)",
              fontSize: "3rem",
              lineHeight: 1,
              marginBottom: "0.4rem",
              background: "linear-gradient(135deg, #4F6EF7 10%, #9B5CF6 90%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            $47 USD
          </div>
          <p style={{ color: "#555", fontSize: "0.8rem", marginBottom: "1.75rem" }}>
            Pago único · Acceso completo
          </p>
          <button
            onClick={() => setCheckoutOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl font-bold transition-opacity hover:opacity-90 w-full justify-center"
            style={{
              backgroundColor: "#4F6EF7",
              color: "#fff",
              padding: "1rem 2rem",
              fontSize: "1rem",
              border: "none",
              cursor: "pointer",
            }}
          >
            Empezar a crear Reels <ArrowRight size={16} />
          </button>
          <p
            style={{
              color: "#444",
              fontSize: "0.75rem",
              marginTop: "1rem",
              lineHeight: 1.6,
            }}
          >
            Requiere cuentas en HeyGen y OpenAI (costos separados).
            Recibirás un email de activación al completar el pago.
          </p>
        </div>
      </section>

      {/* ── CTA FINAL ── */}
      <section
        className="relative text-center overflow-hidden"
        style={{
          borderTop: "1px solid #161616",
          padding: "7rem 1.5rem",
        }}
      >
        <div
          className="absolute pointer-events-none"
          style={{
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: 600,
            height: 360,
            background: "radial-gradient(ellipse, rgba(79,110,247,0.09) 0%, transparent 70%)",
          }}
        />

        <div className="relative z-10 mx-auto" style={{ maxWidth: 620 }}>
          <h2
            className="font-bold tracking-tight"
            style={{
              fontFamily: "var(--font-display, 'Outfit', sans-serif)",
              fontSize: "clamp(1.9rem, 5.5vw, 3.2rem)",
              lineHeight: 1.08,
              letterSpacing: "-0.035em",
              marginBottom: "1.1rem",
            }}
          >
            Empieza a publicar Reels{" "}
            <span
              style={{
                background: "linear-gradient(135deg, #4F6EF7 10%, #9B5CF6 90%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                display: "block",
              }}
            >
              con tu avatar esta semana
            </span>
          </h2>
          <p
            style={{
              color: "#666",
              fontSize: "1rem",
              lineHeight: 1.75,
              marginBottom: "2.75rem",
            }}
          >
            Configura tu sistema, conecta tu avatar y publica tus primeros
            Reels con IA en días, no semanas.
          </p>
          <button
            onClick={() => setCheckoutOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl font-bold transition-opacity hover:opacity-90"
            style={{
              backgroundColor: "#4F6EF7",
              color: "#fff",
              padding: "1.05rem 2.5rem",
              fontSize: "1.05rem",
              border: "none",
              cursor: "pointer",
            }}
          >
            Empezar a crear Reels <ArrowRight size={18} />
          </button>
        </div>
      </section>

      {/* ── CHECKOUT MODAL ── */}
      <CheckoutModal isOpen={checkoutOpen} onClose={() => setCheckoutOpen(false)} />

      {/* ── FOOTER ── */}
      <footer
        className="text-center px-6 py-8"
        style={{ borderTop: "1px solid #151515" }}
      >
        <div className="flex justify-center gap-6 flex-wrap mb-3">
          {[
            { label: "Privacidad", href: `${BASE}/privacy` },
            { label: "Términos", href: `${BASE}/terms` },
            { label: "Acceder", href: `${BASE}/login` },
          ].map(({ label, href }) => (
            <a
              key={label}
              href={href}
              style={{ color: "#555", fontSize: "0.8rem", textDecoration: "none" }}
            >
              {label}
            </a>
          ))}
        </div>
        <p style={{ color: "#444", fontSize: "0.75rem" }}>
          © 2026 Reelsona. Todos los derechos reservados.
        </p>
      </footer>
    </div>
  );
}
