import { useState } from "react";
import { CheckoutModal } from "./CheckoutModal";
import {
  ArrowRight,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  Brain,
  MessageSquare,
  Sparkles,
  TrendingUp,
  Zap,
  Rocket,
  Settings2,
  Users,
  DollarSign,
  Layers,
  X,
  Repeat,
  Bot,
  Target,
  FilePen,
  Play,
  MonitorPlay,
  ShieldCheck,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Data ──────────────────────────────────────────────────────────────────────

const painPoints = [
  { Icon: Clock, text: "Grabas un video y no lo publicas porque tienes que editarlo, hacerle captions y encontrar el momento" },
  { Icon: Brain, text: "Cada semana empiezas de cero pensando qué publicar, sin un plan claro ni un sistema que lo genere por ti" },
  { Icon: Zap, text: "Sabes que los avatares de IA existen, pero no tienes claro cómo crear el tuyo de forma efectiva ni cómo conectarlo a un sistema que produzca en automático" },
  { Icon: TrendingUp, text: "Publicas de forma intermitente porque el proceso completo — desde la idea hasta el video publicado — es demasiado manual para hacerlo con consistencia" },
];

const whatItCovers = [
  { Icon: Target, label: "Estrategia", desc: "Análisis de nicho, temas, ángulos y hooks para los próximos 30 días" },
  { Icon: FilePen, label: "Guiones", desc: "Scripts generados con IA adaptados al formato de Reels y al estilo de avatar" },
  { Icon: Bot, label: "Videos con avatar", desc: "Ruta guiada para crear tu avatar en HeyGen y producción automática desde el momento en que está listo" },
  { Icon: Sparkles, label: "Captions", desc: "Captions visuales con estilo, generados y aplicados automáticamente a cada Reel" },
  { Icon: Settings2, label: "Edición", desc: "Estructura visual y formato listo para publicar en Instagram" },
  { Icon: Calendar, label: "Publicación", desc: "Programación directa en Instagram desde la plataforma" },
  { Icon: Rocket, label: "Autopilot", desc: "El modo que lo ejecuta todo sin intervención manual cuando estás listo para activarlo" },
];

const autopilotSteps = [
  { n: "01", title: "Configura tu estrategia", desc: "Defines tu nicho, audiencia y tono una sola vez. El sistema genera el plan de temas del mes." },
  { n: "02", title: "Conecta tus herramientas", desc: "Enlazas HeyGen, OpenAI e Instagram. Un solo paso de configuración." },
  { n: "03", title: "El sistema genera los guiones", desc: "IA produce scripts optimizados para avatar y Reels, listos para revisar o aprobar automáticamente." },
  { n: "04", title: "Tu avatar graba y se edita", desc: "HeyGen produce el video con tu clon digital. Reelsona aplica captions y edición visual." },
  { n: "05", title: "Se publica sin que hagas nada", desc: "Los Reels se programan y publican en Instagram en los horarios que configuraste." },
];

const forWhom = [
  { Icon: Users, title: "Coaches y consultores", desc: "Que quieren presencia constante en Instagram sin dedicar horas cada semana a grabar contenido." },
  { Icon: Brain, title: "Emprendedores digitales", desc: "Con conocimiento que quieren monetizar a través de contenido sin contratar un equipo de producción." },
  { Icon: MessageSquare, title: "Quieres crear tu avatar IA", desc: "Nunca has creado un avatar digital y quieres aprender a hacerlo paso a paso para después ponerlo a crear contenido de forma automática." },
  { Icon: TrendingUp, title: "Educadores online", desc: "Que necesitan generar autoridad y comunidad con Reels constantes sin que la producción los consuma." },
];

const costRows = [
  { label: "Freelancer básico de redes", range: "$300 – $1,500 / mes", highlight: false },
  { label: "Especialista de contenido", range: "$1,000 – $3,500 / mes", highlight: false },
  { label: "Agencia boutique", range: "$2,000 – $5,000 / mes", highlight: false },
  { label: "Agencia con producción de video/Reels", range: "$5,000 – $10,000+ / mes", highlight: false },
  { label: "Videógrafo para contenido social", range: "$500 – $3,000 / día", highlight: false },
  { label: "Edición de Reels por unidad", range: "$50 – $500+ por Reel", highlight: false },
  { label: "Reelsona — pago único", range: "$47 total", highlight: true },
];

const includes = [
  "Plataforma completa de estrategia, guiones y producción",
  "Ruta guiada de implementación desde cero",
  "Estudio de mercado con análisis de competidores",
  "Generador de temas y hooks para Reels",
  "Generador de guiones con IA adaptados a tu avatar",
  "Producción de videos usando tu avatar en HeyGen",
  "Estudio de captions con plantillas visuales",
  "Publicación programada en Instagram",
  "Modo Autopilot para ejecución sin intervención manual",
  "Área de clases paso a paso incluida",
  "Plantillas y checklists de producción",
  "Acceso completo sin suscripción mensual",
];

const notJustAiToolItems = [
  {
    wrong: "No es ChatGPT con un prompt para captions",
    right: "Es un sistema que conecta estrategia, guión, producción, edición y publicación en un flujo continuo",
  },
  {
    wrong: "No es un editor de video más",
    right: "Los videos salen listos de HeyGen con captions aplicados — sin que abras ningún editor",
  },
  {
    wrong: "No es un programador de posts",
    right: "La publicación es la última etapa de un sistema que empieza desde la idea",
  },
  {
    wrong: "No es una plataforma genérica para crear avatares desde cero",
    right: "Te guiamos a crear tu avatar en HeyGen paso a paso — y luego Reelsona es la capa operativa que lo pone a producir en automático",
  },
];

const faqs = [
  {
    q: "¿Reelsona es una herramienta para crear avatares?",
    a: "No. Reelsona no crea avatares ni compite con HeyGen. Es el sistema que usa tu avatar para automatizar todo el proceso: estrategia, guiones, producción del video, captions y publicación. Piénsalo como el sistema operativo de tu contenido con avatar.",
  },
  {
    q: "¿Qué herramientas externas necesito?",
    a: "Para generar los videos necesitarás cuentas en HeyGen y OpenAI. Sus costos no están incluidos en Reelsona — te guiamos a configurarlas desde cero. Son herramientas que usarías de todas formas para crear contenido con avatar IA.",
  },
  {
    q: "¿Necesito tener un avatar en HeyGen antes de empezar?",
    a: "No. Puedes entrar sin avatar y sin cuenta de HeyGen. Dentro de Reelsona tienes una ruta guiada que te explica exactamente cómo crear tu avatar de forma efectiva — desde la grabación hasta tenerlo listo para producir contenido. Después, el sistema se encarga del resto.",
  },
  {
    q: "¿Cómo funciona el modo Autopilot?",
    a: "Cuando tienes tu estrategia, herramientas y preferencias configuradas, Autopilot ejecuta el pipeline completo: genera guiones, produce los videos con tu avatar, aplica captions y los publica en Instagram según el calendario que definiste. Sin intervención manual.",
  },
  {
    q: "¿Necesito saber editar videos?",
    a: "No. El sistema genera los videos completos con tu avatar y captions incluidos. No necesitas abrir ningún editor de video.",
  },
  {
    q: "¿Tengo que grabarme frente a una cámara?",
    a: "No. Tu avatar IA habla por ti en cada Reel. Tú defines la estrategia y el guión — el sistema produce el video.",
  },
  {
    q: "¿Esto funciona si no tengo experiencia técnica?",
    a: "Sí. El sistema tiene una ruta guiada diseñada para llevarte desde cero hasta tu primer Reel publicado, paso a paso.",
  },
  {
    q: "¿Qué pasa después de comprar?",
    a: "Recibirás un email de activación. Con ese link creas tu contraseña y accedes al sistema completo de inmediato.",
  },
  {
    q: "¿Puedo publicar directamente en Instagram?",
    a: "Sí. Conectas tu cuenta de Instagram Business desde la plataforma y programas la publicación de tus Reels desde ahí.",
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

function SectionTitle({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return (
    <h2
      className={`font-bold tracking-tight ${center ? "text-center" : ""}`}
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

function Divider() {
  return <div style={{ height: 1, backgroundColor: "#161616", width: "100%" }} />;
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
            href={`${BASE}/`}
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
            Empezar por $47 →
          </button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section
        className="relative flex items-center justify-center overflow-hidden"
        style={{
          minHeight: "calc(100vh - 60px)",
          padding: "5rem 1.5rem 5rem",
        }}
      >
        {/* grid bg */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(rgba(79,110,247,0.03) 1px, transparent 1px),
              linear-gradient(90deg, rgba(79,110,247,0.03) 1px, transparent 1px)
            `,
            backgroundSize: "64px 64px",
          }}
        />
        {/* radial glow */}
        <div
          className="absolute pointer-events-none"
          style={{
            top: "40%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: 900,
            height: 500,
            background: "radial-gradient(ellipse, rgba(79,110,247,0.1) 0%, transparent 68%)",
          }}
        />

        <div className="relative z-10 mx-auto w-full" style={{ maxWidth: 1060 }}>
          <div
            className="grid items-center"
            style={{ gridTemplateColumns: "1fr auto", gap: "clamp(2rem, 5vw, 5rem)" }}
          >
            {/* ── LEFT: copy ── */}
            <div>
              {/* badge */}
              <div
                className="inline-flex items-center gap-1.5 rounded-full text-xs font-semibold tracking-widest uppercase mb-8"
                style={{
                  backgroundColor: "rgba(79,110,247,0.08)",
                  border: "1px solid rgba(79,110,247,0.2)",
                  padding: "0.3rem 0.95rem",
                  color: "#4F6EF7",
                }}
              >
                <Sparkles size={11} />
                Sistema automático de Reels con avatar IA
              </div>

              <h1
                className="font-bold tracking-tight"
                style={{
                  fontFamily: "var(--font-display, 'Outfit', sans-serif)",
                  fontSize: "clamp(2.2rem, 5vw, 3.9rem)",
                  lineHeight: 1.06,
                  letterSpacing: "-0.04em",
                  marginBottom: "1.4rem",
                }}
              >
                Monta tu sistema automático de Reels{" "}
                <span
                  style={{
                    background: "linear-gradient(135deg, #4F6EF7 10%, #9B5CF6 90%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  sin grabarte todos los días
                </span>
              </h1>

              <p
                style={{
                  fontSize: "clamp(0.95rem, 1.8vw, 1.1rem)",
                  color: "#888",
                  lineHeight: 1.75,
                  maxWidth: 520,
                  marginBottom: "2.25rem",
                }}
              >
                La capa estratégica y operativa que convierte tu conocimiento en ideas,
                guiones, videos con avatar, captions, edición y publicación en Instagram —
                completamente en automático.
              </p>

              <div className="flex flex-wrap gap-3" style={{ marginBottom: "1.4rem" }}>
                <button
                  onClick={() => setCheckoutOpen(true)}
                  className="inline-flex items-center gap-2 rounded-xl font-bold transition-opacity hover:opacity-90"
                  style={{
                    background: "linear-gradient(135deg, #4F6EF7, #7B5CF6)",
                    color: "#fff",
                    padding: "1rem 2.1rem",
                    fontSize: "1rem",
                    border: "none",
                    cursor: "pointer",
                    boxShadow: "0 0 28px rgba(79,110,247,0.35)",
                  }}
                >
                  Empezar por $47 <ArrowRight size={16} />
                </button>
                <a
                  href="#como-funciona"
                  className="inline-flex items-center gap-2 rounded-xl font-semibold transition-colors"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.04)",
                    border: "1px solid #252525",
                    color: "#d0d0d0",
                    padding: "1rem 1.75rem",
                    fontSize: "1rem",
                    textDecoration: "none",
                  }}
                >
                  <Play size={13} fill="currentColor" /> Ver cómo funciona
                </a>
              </div>

              {/* checklist strip */}
              <div
                className="flex items-center gap-5 flex-wrap"
                style={{ color: "#555", fontSize: "0.82rem", marginBottom: "1rem" }}
              >
                {[
                  "Guión listo en minutos",
                  "Video con tu avatar sin grabarte",
                  "Autopilot publica por ti",
                ].map((t) => (
                  <span key={t} className="flex items-center gap-1.5">
                    <Check size={11} color="#4F6EF7" strokeWidth={3} /> {t}
                  </span>
                ))}
              </div>

              {/* tools note */}
              <p style={{ fontSize: "0.74rem", color: "#3a3a3a", lineHeight: 1.6 }}>
                Funciona con HeyGen y OpenAI · Costos independientes · Te guiamos paso a paso
              </p>
            </div>

            {/* ── RIGHT: avatar phone mockup ── */}
            <div className="hidden md:block flex-shrink-0" style={{ position: "relative" }}>
              {/* outer glow */}
              <div
                className="absolute pointer-events-none"
                style={{
                  inset: "-30px",
                  background: "radial-gradient(ellipse at center, rgba(79,110,247,0.2) 0%, transparent 68%)",
                  borderRadius: "9999px",
                  zIndex: 0,
                }}
              />
              {/* phone frame */}
              <div
                style={{
                  position: "relative",
                  zIndex: 1,
                  width: "clamp(200px, 18vw, 270px)",
                  aspectRatio: "9/16",
                  borderRadius: "2.2rem",
                  border: "1px solid rgba(79,110,247,0.3)",
                  boxShadow: "0 0 60px rgba(79,110,247,0.2), 0 28px 70px rgba(0,0,0,0.7)",
                  overflow: "hidden",
                  backgroundColor: "#111",
                }}
              >
                <img
                  src={`${BASE}/hero-avatar.jpg`}
                  alt="Reel generado con avatar IA"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    objectPosition: "top",
                    display: "block",
                  }}
                />
                {/* overlay label */}
                <div
                  style={{
                    position: "absolute",
                    bottom: "1.1rem",
                    left: "50%",
                    transform: "translateX(-50%)",
                    backgroundColor: "rgba(9,9,9,0.8)",
                    backdropFilter: "blur(10px)",
                    border: "1px solid rgba(79,110,247,0.35)",
                    borderRadius: "9999px",
                    padding: "0.28rem 0.8rem",
                    fontSize: "0.62rem",
                    fontWeight: 700,
                    letterSpacing: "0.07em",
                    color: "#4F6EF7",
                    whiteSpace: "nowrap",
                  }}
                >
                  ✦ GENERADO CON AVATAR IA
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Divider />

      {/* ── EL PROBLEMA ── */}
      <section style={{ padding: "5.5rem 1.5rem" }}>
        <div className="mx-auto" style={{ maxWidth: 980 }}>
          <div className="text-center mb-12">
            <SectionLabel>El problema real</SectionLabel>
            <SectionTitle center>
              Tienes el avatar. Te falta el sistema.
            </SectionTitle>
            <p
              className="mx-auto mt-4"
              style={{ color: "#666", maxWidth: 520, fontSize: "0.9rem", lineHeight: 1.75 }}
            >
              El avatar es solo una herramienta. Sin un sistema detrás, sigue dependiendo
              de tu tiempo, tu energía y tu disciplina para publicar con consistencia.
            </p>
          </div>

          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
          >
            {painPoints.map(({ Icon, text }) => (
              <div
                key={text}
                className="flex items-start gap-3 rounded-2xl"
                style={{
                  backgroundColor: "#0e0e0e",
                  border: "1px solid #1c1c1c",
                  padding: "1.5rem",
                }}
              >
                <div
                  className="flex-shrink-0 flex items-center justify-center rounded-lg mt-0.5"
                  style={{
                    width: 36,
                    height: 36,
                    backgroundColor: "rgba(79,110,247,0.09)",
                    border: "1px solid rgba(79,110,247,0.18)",
                  }}
                >
                  <Icon size={16} color="#4F6EF7" />
                </div>
                <span style={{ color: "#888", fontSize: "0.875rem", lineHeight: 1.65 }}>
                  {text}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Divider />

      {/* ── QUÉ ES REELSONA ── */}
      <section
        style={{
          backgroundColor: "#0b0b0b",
          padding: "5.5rem 1.5rem",
        }}
      >
        <div className="mx-auto" style={{ maxWidth: 900 }}>
          <div className="text-center mb-14">
            <SectionLabel>Qué es Reelsona</SectionLabel>
            <SectionTitle center>
              No es HeyGen. No crea avatares.<br />Es la capa que hace que todo funcione.
            </SectionTitle>
          </div>

          {/* Key quote */}
          <div
            className="rounded-2xl mb-10"
            style={{
              background: "linear-gradient(135deg, rgba(79,110,247,0.06), rgba(155,92,246,0.06))",
              border: "1px solid rgba(79,110,247,0.18)",
              padding: "2rem 2.25rem",
            }}
          >
            <p
              style={{
                fontSize: "clamp(1rem, 2.2vw, 1.2rem)",
                color: "#d0d0d0",
                lineHeight: 1.75,
                fontStyle: "italic",
                margin: 0,
              }}
            >
              "HeyGen crea el video. Reelsona crea el sistema para que ese video
              tenga estrategia, estructura, edición, captions y constancia."
            </p>
          </div>

          <p
            className="text-center mx-auto mb-12"
            style={{ color: "#777", fontSize: "0.95rem", lineHeight: 1.8, maxWidth: 640 }}
          >
            Reelsona es la capa estratégica y operativa que conecta todas las piezas.
            No reemplaza a HeyGen ni a OpenAI — los usa como motores. Tú defines la
            dirección; Reelsona convierte esa dirección en producción constante.
          </p>

          {/* What it covers */}
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
          >
            {whatItCovers.map(({ Icon, label, desc }) => (
              <div
                key={label}
                className="rounded-2xl"
                style={{
                  backgroundColor: "#111",
                  border: "1px solid #1e1e1e",
                  padding: "1.4rem 1.25rem",
                }}
              >
                <div
                  className="flex items-center justify-center rounded-xl mb-3"
                  style={{
                    width: 38,
                    height: 38,
                    backgroundColor: "rgba(79,110,247,0.09)",
                    color: "#4F6EF7",
                  }}
                >
                  <Icon size={17} />
                </div>
                <h3
                  className="font-bold mb-1"
                  style={{
                    fontFamily: "var(--font-display, 'Outfit', sans-serif)",
                    fontSize: "0.9rem",
                    color: "#e0e0e0",
                  }}
                >
                  {label}
                </h3>
                <p style={{ color: "#666", fontSize: "0.82rem", lineHeight: 1.6, margin: 0 }}>
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Divider />

      {/* ── AUTOPILOT ── */}
      <section style={{ padding: "6rem 1.5rem" }}>
        <div className="mx-auto" style={{ maxWidth: 1040 }}>

          {/* ── Encabezado ── */}
          <div className="text-center mb-12">
            <div
              className="inline-flex items-center gap-1.5 rounded-full text-xs font-semibold tracking-widest uppercase mb-4"
              style={{
                backgroundColor: "rgba(155,92,246,0.08)",
                border: "1px solid rgba(155,92,246,0.22)",
                padding: "0.3rem 0.95rem",
                color: "#9B5CF6",
              }}
            >
              <Rocket size={11} />
              Modo Autopilot
            </div>
            <h2
              className="font-bold tracking-tight"
              style={{
                fontFamily: "var(--font-display, 'Outfit', sans-serif)",
                fontSize: "clamp(1.9rem, 4.5vw, 3rem)",
                letterSpacing: "-0.03em",
                lineHeight: 1.1,
                marginBottom: "1.1rem",
              }}
            >
              Configura una vez.{" "}
              <span
                style={{
                  background: "linear-gradient(135deg, #4F6EF7 10%, #9B5CF6 90%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                Tu sistema publica solo.
              </span>
            </h2>
            <p
              className="mx-auto"
              style={{ color: "#666", maxWidth: 560, fontSize: "0.95rem", lineHeight: 1.8 }}
            >
              Autopilot es el modo de Reelsona que ejecuta el pipeline completo —
              estrategia, guiones, producción, captions y publicación — sin que tengas
              que intervenir en cada paso.
            </p>
          </div>

          {/* ── Qué es Autopilot: 3 pilares ── */}
          <div
            className="grid gap-4 mb-14"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}
          >
            {[
              {
                Icon: Settings2,
                color: "#4F6EF7",
                bg: "rgba(79,110,247,0.08)",
                border: "rgba(79,110,247,0.2)",
                title: "1. Configuras una sola vez",
                desc: "Defines tu nicho, tu audiencia, el tono de tu contenido y los horarios de publicación. Eso es todo lo que haces tú.",
              },
              {
                Icon: Bot,
                color: "#9B5CF6",
                bg: "rgba(155,92,246,0.08)",
                border: "rgba(155,92,246,0.2)",
                title: "2. El sistema produce",
                desc: "Reelsona genera los temas, escribe los guiones, produce los videos con tu avatar en HeyGen y aplica los captions automáticamente.",
              },
              {
                Icon: Calendar,
                color: "#4F6EF7",
                bg: "rgba(79,110,247,0.08)",
                border: "rgba(79,110,247,0.2)",
                title: "3. Instagram se actualiza solo",
                desc: "Los Reels se publican en tu cuenta según el calendario que configuraste. Sin que abras la app, sin que programes nada a mano.",
              },
            ].map(({ Icon, color, bg, border, title, desc }) => (
              <div
                key={title}
                className="rounded-2xl"
                style={{
                  backgroundColor: "#0f0f0f",
                  border: `1px solid ${border}`,
                  padding: "1.75rem",
                }}
              >
                <div
                  className="flex items-center justify-center rounded-xl mb-4"
                  style={{ width: 44, height: 44, backgroundColor: bg, color }}
                >
                  <Icon size={20} />
                </div>
                <h3
                  className="font-bold mb-2"
                  style={{
                    fontFamily: "var(--font-display, 'Outfit', sans-serif)",
                    fontSize: "1rem",
                    color: "#e8e8e8",
                  }}
                >
                  {title}
                </h3>
                <p style={{ color: "#666", fontSize: "0.875rem", lineHeight: 1.7, margin: 0 }}>
                  {desc}
                </p>
              </div>
            ))}
          </div>

          {/* ── Quote ── */}
          <div
            className="rounded-2xl text-center mx-auto mb-14"
            style={{
              maxWidth: 700,
              background: "linear-gradient(135deg, rgba(79,110,247,0.06), rgba(155,92,246,0.06))",
              border: "1px solid rgba(155,92,246,0.18)",
              padding: "2rem 2.5rem",
            }}
          >
            <p
              style={{
                fontSize: "clamp(1rem, 2.2vw, 1.2rem)",
                color: "#c8c8c8",
                lineHeight: 1.75,
                fontStyle: "italic",
                margin: 0,
              }}
            >
              "Configura tu estrategia, conecta tus herramientas y deja que tu
              clon digital trabaje por ti."
            </p>
          </div>

          {/* ── Pipeline animado: título ── */}
          <p
            className="text-center font-semibold mb-6"
            style={{
              fontSize: "0.78rem",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "#444",
            }}
          >
            El pipeline que Autopilot ejecuta en cada ciclo
          </p>

          {/* ── Pipeline animado: tarjetas ── */}
          <style>{`
            @keyframes card-light {
              0%   { border-color: rgba(79,110,247,0.6); box-shadow: 0 0 32px rgba(79,110,247,0.22), inset 0 0 24px rgba(79,110,247,0.05); background-color: rgba(79,110,247,0.06); }
              20%  { border-color: #1d1d1d; box-shadow: none; background-color: #0f0f0f; }
              100% { border-color: #1d1d1d; box-shadow: none; background-color: #0f0f0f; }
            }
            @keyframes arr-light {
              0%   { opacity: 1; }
              20%  { opacity: 0.15; }
              100% { opacity: 0.15; }
            }
            .ap-c1 { animation: card-light 5s ease-in-out 0s   infinite; }
            .ap-c2 { animation: card-light 5s ease-in-out 1s   infinite; }
            .ap-c3 { animation: card-light 5s ease-in-out 2s   infinite; }
            .ap-c4 { animation: card-light 5s ease-in-out 3s   infinite; }
            .ap-c5 { animation: card-light 5s ease-in-out 4s   infinite; }
            .ap-a1 { animation: arr-light  5s ease-in-out 0s   infinite; }
            .ap-a2 { animation: arr-light  5s ease-in-out 1s   infinite; }
            .ap-a3 { animation: arr-light  5s ease-in-out 2s   infinite; }
            .ap-a4 { animation: arr-light  5s ease-in-out 3s   infinite; }
          `}</style>

          <div style={{ display: "flex", alignItems: "stretch", gap: 0, overflowX: "auto" }} className="mb-14">
            {autopilotSteps.flatMap(({ n, title, desc }, idx) => {
              const cardClass = `ap-c${idx + 1}`;
              const arrClass  = `ap-a${idx + 1}`;
              const items = [
                <div
                  key={`card-${n}`}
                  className={`${cardClass} rounded-2xl text-center`}
                  style={{
                    flex: "1 1 0",
                    minWidth: 130,
                    border: "1px solid #1d1d1d",
                    backgroundColor: "#0f0f0f",
                    padding: "1.75rem 1rem 1.5rem",
                  }}
                >
                  <div
                    className="flex items-center justify-center rounded-full mx-auto mb-4"
                    style={{
                      width: 44,
                      height: 44,
                      background: "linear-gradient(135deg, rgba(79,110,247,0.18), rgba(155,92,246,0.18))",
                      border: "1px solid rgba(79,110,247,0.3)",
                      fontSize: "0.8rem",
                      fontWeight: 800,
                      color: "#4F6EF7",
                      fontFamily: "var(--font-display, 'Outfit', sans-serif)",
                      backgroundColor: "#0f0f0f",
                    }}
                  >
                    {n}
                  </div>
                  <h3
                    className="font-bold mb-2"
                    style={{
                      fontFamily: "var(--font-display, 'Outfit', sans-serif)",
                      fontSize: "0.83rem",
                      color: "#e0e0e0",
                    }}
                  >
                    {title}
                  </h3>
                  <p style={{ color: "#5a5a5a", fontSize: "0.77rem", lineHeight: 1.6, margin: 0 }}>
                    {desc}
                  </p>
                </div>,
              ];
              if (idx < autopilotSteps.length - 1) {
                items.push(
                  <div
                    key={`arr-${idx}`}
                    className={`${arrClass} flex flex-col items-center justify-center gap-0.5 flex-shrink-0`}
                    style={{ width: 32, alignSelf: "center" }}
                  >
                    <ArrowRight size={11} color="#4F6EF7" />
                    <ArrowRight size={11} color="#7B5CF6" />
                    <ArrowRight size={11} color="#4F6EF7" />
                  </div>
                );
              }
              return items;
            })}
          </div>

          {/* ── Sin Autopilot vs Con Autopilot ── */}
          <div
            className="grid gap-4 mb-10"
            style={{ gridTemplateColumns: "1fr 1fr" }}
          >
            {/* Sin */}
            <div
              className="rounded-2xl"
              style={{
                backgroundColor: "#0e0e0e",
                border: "1px solid #1c1c1c",
                padding: "1.75rem",
              }}
            >
              <p
                className="font-bold mb-4"
                style={{
                  fontFamily: "var(--font-display, 'Outfit', sans-serif)",
                  fontSize: "0.82rem",
                  color: "#555",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                Sin Autopilot
              </p>
              <div className="flex flex-col gap-3">
                {[
                  "Decides qué publicar cada semana manualmente",
                  "Escribes o corriges cada guión",
                  "Abres HeyGen, configuras y esperas el render",
                  "Descargas el video y añades captions en otra app",
                  "Programas la publicación en Instagram a mano",
                  "Repites todo esto la próxima semana",
                ].map((t) => (
                  <div key={t} className="flex items-start gap-2.5">
                    <X size={13} color="#4a3030" className="flex-shrink-0 mt-0.5" />
                    <span style={{ color: "#4a4a4a", fontSize: "0.83rem", lineHeight: 1.55 }}>{t}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Con */}
            <div
              className="rounded-2xl"
              style={{
                background: "linear-gradient(145deg, rgba(79,110,247,0.05), rgba(155,92,246,0.05))",
                border: "1px solid rgba(79,110,247,0.2)",
                padding: "1.75rem",
              }}
            >
              <p
                className="font-bold mb-4"
                style={{
                  fontFamily: "var(--font-display, 'Outfit', sans-serif)",
                  fontSize: "0.82rem",
                  color: "#4F6EF7",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                Con Autopilot activo
              </p>
              <div className="flex flex-col gap-3">
                {[
                  "El plan de temas se genera automáticamente según tu estrategia",
                  "Los guiones se producen y aprueban sin intervención",
                  "HeyGen renderiza el video con tu avatar en background",
                  "Los captions se aplican solos al video terminado",
                  "El Reel se publica en Instagram en el horario configurado",
                  "El ciclo se repite solo — semana tras semana",
                ].map((t) => (
                  <div key={t} className="flex items-start gap-2.5">
                    <Check size={13} color="#4F6EF7" strokeWidth={3} className="flex-shrink-0 mt-0.5" />
                    <span style={{ color: "#aaa", fontSize: "0.83rem", lineHeight: 1.55 }}>{t}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Resultado final ── */}
          <div
            className="rounded-2xl flex flex-wrap items-center gap-6"
            style={{
              background: "linear-gradient(135deg, rgba(79,110,247,0.07), rgba(155,92,246,0.07))",
              border: "1px solid rgba(155,92,246,0.2)",
              padding: "1.75rem 2rem",
            }}
          >
            <div
              className="flex items-center justify-center rounded-xl flex-shrink-0"
              style={{
                width: 50,
                height: 50,
                background: "linear-gradient(135deg, rgba(79,110,247,0.18), rgba(155,92,246,0.18))",
                border: "1px solid rgba(155,92,246,0.3)",
              }}
            >
              <Repeat size={22} color="#9B5CF6" />
            </div>
            <div style={{ flex: 1, minWidth: 240 }}>
              <p
                className="font-bold mb-1"
                style={{
                  fontFamily: "var(--font-display, 'Outfit', sans-serif)",
                  fontSize: "1.05rem",
                  color: "#e0e0e0",
                }}
              >
                No pagas por producir un video. Montas una máquina.
              </p>
              <p style={{ color: "#666", fontSize: "0.875rem", lineHeight: 1.7, margin: 0 }}>
                Una vez que Autopilot está activo, tu clon digital puede publicar Reels
                esta semana, la siguiente y el mes que viene — con o sin que estés disponible.
                Eso es lo que separa tener una herramienta de tener un sistema.
              </p>
            </div>
          </div>

        </div>
      </section>

      <Divider />

      {/* ── PARA QUIÉN ES ── */}
      <section
        style={{ backgroundColor: "#0b0b0b", padding: "5.5rem 1.5rem" }}
      >
        <div className="mx-auto" style={{ maxWidth: 900 }}>
          <div className="text-center mb-12">
            <SectionLabel>Para quién es</SectionLabel>
            <SectionTitle center>
              Diseñado para quienes tienen conocimiento<br />y quieren un sistema que lo distribuya
            </SectionTitle>
          </div>

          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}
          >
            {forWhom.map(({ Icon, title, desc }) => (
              <div
                key={title}
                className="rounded-2xl"
                style={{
                  backgroundColor: "#111",
                  border: "1px solid #1e1e1e",
                  padding: "1.6rem 1.5rem",
                }}
              >
                <div
                  className="flex items-center justify-center rounded-xl mb-4"
                  style={{
                    width: 40,
                    height: 40,
                    backgroundColor: "rgba(79,110,247,0.09)",
                    color: "#4F6EF7",
                  }}
                >
                  <Icon size={17} />
                </div>
                <h3
                  className="font-bold mb-2"
                  style={{
                    fontFamily: "var(--font-display, 'Outfit', sans-serif)",
                    fontSize: "0.93rem",
                    color: "#e0e0e0",
                  }}
                >
                  {title}
                </h3>
                <p style={{ color: "#666", fontSize: "0.85rem", lineHeight: 1.65, margin: 0 }}>
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Divider />

      {/* ── CÓMO FUNCIONA ── */}
      <section
        id="como-funciona"
        style={{ padding: "5.5rem 1.5rem" }}
      >
        <div className="mx-auto" style={{ maxWidth: 680 }}>
          <div className="text-center mb-12">
            <SectionLabel>El proceso</SectionLabel>
            <SectionTitle center>
              Cómo funciona Reelsona paso a paso
            </SectionTitle>
            <p
              className="mx-auto mt-4"
              style={{ color: "#666", fontSize: "0.9rem", lineHeight: 1.75, maxWidth: 480 }}
            >
              Desde que entras al sistema hasta que tu primer Reel está publicado —
              sin editar, sin grabar, sin improvisar.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            {[
              {
                n: "1",
                title: "Defines tu nicho y estrategia",
                desc: "El sistema analiza tu mercado, genera un plan de temas con ángulos y hooks para los próximos 30 días, y lo guarda como base de todo el contenido.",
              },
              {
                n: "2",
                title: "La IA genera los guiones",
                desc: "Para cada tema del plan, Reelsona produce un script estructurado para el formato de Reels y optimizado para el estilo de tu avatar. Puedes revisarlos o aprobarlos automáticamente.",
              },
              {
                n: "3",
                title: "Tu avatar graba el video",
                desc: "El guión se envía a HeyGen y tu clon digital produce el video completo. Sin cámara, sin iluminación, sin estudio.",
              },
              {
                n: "4",
                title: "Reelsona aplica captions y edición",
                desc: "Los captions visuales se generan y se aplican automáticamente al video. El Reel queda con estructura visual lista para publicar.",
              },
              {
                n: "5",
                title: "Se publica en Instagram",
                desc: "El Reel se programa y publica en tu cuenta de Instagram Business en los horarios que configuraste — sin que hagas nada.",
              },
            ].map(({ n, title, desc }) => (
              <div
                key={n}
                className="flex gap-5 rounded-2xl"
                style={{
                  backgroundColor: "#0e0e0e",
                  border: "1px solid #1c1c1c",
                  padding: "1.5rem 1.75rem",
                }}
              >
                <div
                  className="flex-shrink-0 flex items-center justify-center rounded-full font-bold"
                  style={{
                    width: 36,
                    height: 36,
                    background: "linear-gradient(135deg, rgba(79,110,247,0.15), rgba(155,92,246,0.15))",
                    border: "1px solid rgba(79,110,247,0.3)",
                    fontSize: "0.85rem",
                    color: "#4F6EF7",
                    fontFamily: "var(--font-display, 'Outfit', sans-serif)",
                  }}
                >
                  {n}
                </div>
                <div>
                  <h3
                    className="font-bold mb-1.5"
                    style={{
                      fontFamily: "var(--font-display, 'Outfit', sans-serif)",
                      fontSize: "0.95rem",
                      color: "#e0e0e0",
                    }}
                  >
                    {title}
                  </h3>
                  <p style={{ color: "#666", fontSize: "0.855rem", lineHeight: 1.65, margin: 0 }}>
                    {desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Divider />

      {/* ── COMPARATIVA DE COSTOS ── */}
      <section
        style={{ backgroundColor: "#0b0b0b", padding: "5.5rem 1.5rem" }}
      >
        <div className="mx-auto" style={{ maxWidth: 780 }}>
          <div className="text-center mb-5">
            <SectionLabel>Comparativa de costos</SectionLabel>
            <SectionTitle center>
              Lo que cuesta el mismo resultado<br />sin Reelsona
            </SectionTitle>
          </div>
          <p
            className="text-center mx-auto mb-10"
            style={{ color: "#555", fontSize: "0.82rem", lineHeight: 1.7, maxWidth: 520 }}
          >
            Los rangos siguientes son referencias aproximadas del mercado, no una promesa de ahorro
            exacto. Cada caso varía según región, experiencia y alcance.
          </p>

          <div
            className="rounded-2xl overflow-hidden"
            style={{ border: "1px solid #1e1e1e" }}
          >
            {costRows.map(({ label, range, highlight }, i) => (
              <div
                key={label}
                className="flex items-center justify-between gap-4 px-5 py-4"
                style={{
                  backgroundColor: highlight ? "rgba(79,110,247,0.09)" : i % 2 === 0 ? "#0f0f0f" : "#111",
                  borderBottom: i < costRows.length - 1 ? "1px solid #1a1a1a" : "none",
                  borderLeft: highlight ? "3px solid #4F6EF7" : "3px solid transparent",
                }}
              >
                <span
                  style={{
                    fontSize: "0.875rem",
                    color: highlight ? "#d0d0d0" : "#888",
                    fontWeight: highlight ? 700 : 400,
                  }}
                >
                  {label}
                </span>
                <span
                  className="flex-shrink-0 font-bold"
                  style={{
                    fontSize: highlight ? "1rem" : "0.875rem",
                    color: highlight ? "#4F6EF7" : "#555",
                    fontFamily: highlight ? "var(--font-display, 'Outfit', sans-serif)" : "inherit",
                  }}
                >
                  {range}
                </span>
              </div>
            ))}
          </div>

          {/* Ahorro real */}
          <div
            className="mt-8 rounded-2xl text-center"
            style={{
              background: "linear-gradient(135deg, rgba(79,110,247,0.06), rgba(155,92,246,0.06))",
              border: "1px solid rgba(79,110,247,0.15)",
              padding: "2rem 1.75rem",
            }}
          >
            <DollarSign size={28} color="#4F6EF7" className="mx-auto mb-3" />
            <h3
              className="font-bold mb-2"
              style={{
                fontFamily: "var(--font-display, 'Outfit', sans-serif)",
                fontSize: "clamp(1.1rem, 3vw, 1.4rem)",
                color: "#e0e0e0",
              }}
            >
              Por una fracción del costo, montas el sistema tú mismo
            </h3>
            <p style={{ color: "#666", fontSize: "0.9rem", lineHeight: 1.75, margin: 0 }}>
              Reelsona no es un servicio de producción que cobra por entregable. Es la
              infraestructura que te permite producir tú mismo, con tu avatar, a escala —
              sin depender de freelancers, agencias ni equipos de producción.
            </p>
          </div>
        </div>
      </section>

      <Divider />

      {/* ── QUÉ INCLUYE ── */}
      <section style={{ padding: "5.5rem 1.5rem" }}>
        <div className="mx-auto" style={{ maxWidth: 820 }}>
          <div className="text-center mb-10">
            <SectionLabel>Dentro del sistema</SectionLabel>
            <SectionTitle center>Qué obtienes al entrar</SectionTitle>
            <p
              className="mx-auto mt-4"
              style={{ color: "#666", fontSize: "0.9rem", lineHeight: 1.75, maxWidth: 500 }}
            >
              Todo lo que necesitas para montar tu sistema de Reels con avatar está
              dentro. Sin módulos de pago adicionales.
            </p>
          </div>

          <div
            className="rounded-2xl"
            style={{
              backgroundColor: "#0f0f0f",
              border: "1px solid rgba(79,110,247,0.2)",
              padding: "2.25rem 2rem",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* gradient bar top */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: 2,
                background: "linear-gradient(90deg, #4F6EF7, #9B5CF6, transparent)",
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
                      backgroundColor: "rgba(79,110,247,0.12)",
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
        </div>
      </section>

      <Divider />

      {/* ── POR QUÉ NO ES OTRA HERRAMIENTA IA ── */}
      <section
        style={{ backgroundColor: "#0b0b0b", padding: "5.5rem 1.5rem" }}
      >
        <div className="mx-auto" style={{ maxWidth: 820 }}>
          <div className="text-center mb-12">
            <SectionLabel>No es otra herramienta IA</SectionLabel>
            <SectionTitle center>
              Hay decenas de apps de IA para contenido.<br />Reelsona no es ninguna de ellas.
            </SectionTitle>
          </div>

          <div className="flex flex-col gap-4">
            {notJustAiToolItems.map(({ wrong, right }) => (
              <div
                key={wrong}
                className="grid rounded-2xl overflow-hidden"
                style={{
                  gridTemplateColumns: "1fr 1fr",
                  border: "1px solid #1c1c1c",
                }}
              >
                <div
                  className="flex items-start gap-3 p-4"
                  style={{ backgroundColor: "#0d0d0d", borderRight: "1px solid #1c1c1c" }}
                >
                  <X size={15} color="#664444" className="flex-shrink-0 mt-0.5" />
                  <span style={{ color: "#555", fontSize: "0.845rem", lineHeight: 1.6 }}>
                    {wrong}
                  </span>
                </div>
                <div className="flex items-start gap-3 p-4" style={{ backgroundColor: "#0f0f0f" }}>
                  <Check size={15} color="#4F6EF7" className="flex-shrink-0 mt-0.5" strokeWidth={3} />
                  <span style={{ color: "#aaa", fontSize: "0.845rem", lineHeight: 1.6 }}>
                    {right}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Divider />

      {/* ── PRECIO ── */}
      <section style={{ padding: "5.5rem 1.5rem" }}>
        <div className="mx-auto" style={{ maxWidth: 540 }}>
          <div
            className="rounded-2xl text-center relative overflow-hidden"
            style={{
              backgroundColor: "#0f0f0f",
              border: "1px solid rgba(79,110,247,0.3)",
              padding: "3rem 2.5rem",
            }}
          >
            {/* top gradient bar */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: 2,
                background: "linear-gradient(90deg, #4F6EF7, #9B5CF6)",
              }}
            />
            <SectionLabel>Precio de lanzamiento</SectionLabel>
            <div
              className="font-bold"
              style={{
                fontFamily: "var(--font-display, 'Outfit', sans-serif)",
                fontSize: "3.75rem",
                lineHeight: 1,
                marginBottom: "0.3rem",
                background: "linear-gradient(135deg, #4F6EF7 10%, #9B5CF6 90%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              $47 USD
            </div>
            <p style={{ color: "#444", fontSize: "0.82rem", marginBottom: "0.75rem" }}>
              Pago único · Sin suscripción mensual · Acceso completo
            </p>

            <div
              className="flex justify-center gap-4 flex-wrap mb-7"
              style={{ marginTop: "0.25rem" }}
            >
              {["Acceso inmediato", "Sin cuota mensual", "Modo Autopilot incluido"].map((t) => (
                <span
                  key={t}
                  className="flex items-center gap-1.5"
                  style={{ fontSize: "0.8rem", color: "#555" }}
                >
                  <Check size={11} color="#4F6EF7" strokeWidth={3} /> {t}
                </span>
              ))}
            </div>

            <button
              onClick={() => setCheckoutOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl font-bold transition-opacity hover:opacity-90 w-full justify-center"
              style={{
                background: "linear-gradient(135deg, #4F6EF7, #7B5CF6)",
                color: "#fff",
                padding: "1.1rem 2rem",
                fontSize: "1.05rem",
                border: "none",
                cursor: "pointer",
                boxShadow: "0 0 28px rgba(79,110,247,0.3)",
              }}
            >
              Montar mi sistema de Reels <ArrowRight size={17} />
            </button>

            {/* External costs note */}
            <div
              className="mt-5 rounded-xl p-4 text-left"
              style={{
                backgroundColor: "rgba(255,255,255,0.025)",
                border: "1px solid #1e1e1e",
              }}
            >
              <p
                className="font-semibold mb-1"
                style={{
                  fontSize: "0.78rem",
                  color: "#888",
                  fontFamily: "var(--font-display, 'Outfit', sans-serif)",
                }}
              >
                Nota sobre costos externos
              </p>
              <p style={{ color: "#4a4a4a", fontSize: "0.75rem", lineHeight: 1.7, margin: 0 }}>
                Para generar videos con avatar y contenido con IA, Reelsona usa HeyGen y OpenAI.
                Esas herramientas tienen sus propios planes y costos, que no están incluidos en
                los $47. Te guiamos a configurarlas paso a paso desde el primer día.
              </p>
            </div>

            <p
              style={{
                color: "#333",
                fontSize: "0.72rem",
                marginTop: "1rem",
                lineHeight: 1.6,
              }}
            >
              Recibirás un email de activación al completar el pago.
            </p>
          </div>
        </div>
      </section>

      <Divider />

      {/* ── FAQ ── */}
      <section
        style={{ backgroundColor: "#0b0b0b", padding: "5.5rem 1.5rem" }}
      >
        <div className="mx-auto" style={{ maxWidth: 660 }}>
          <div className="text-center mb-10">
            <SectionLabel>Preguntas frecuentes</SectionLabel>
            <SectionTitle center>Preguntas frecuentes</SectionTitle>
          </div>

          <div>
            {faqs.map((faq, i) => (
              <div
                key={i}
                style={{
                  borderBottom: i < faqs.length - 1 ? "1px solid #1a1a1a" : "none",
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
                    style={{ color: "#777", fontSize: "0.875rem", lineHeight: 1.8 }}
                  >
                    {faq.a}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <Divider />

      {/* ── CTA FINAL ── */}
      <section
        className="relative overflow-hidden"
        style={{ padding: "7rem 1.5rem" }}
      >
        {/* bg effects */}
        <div
          className="absolute pointer-events-none"
          style={{
            top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            width: 800, height: 500,
            background: "radial-gradient(ellipse, rgba(79,110,247,0.08) 0%, transparent 68%)",
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(rgba(79,110,247,0.025) 1px, transparent 1px),
              linear-gradient(90deg, rgba(79,110,247,0.025) 1px, transparent 1px)
            `,
            backgroundSize: "64px 64px",
          }}
        />

        <div
          className="relative z-10 mx-auto grid items-center"
          style={{
            maxWidth: 980,
            gridTemplateColumns: "auto 1fr",
            gap: "clamp(2.5rem, 6vw, 6rem)",
          }}
        >
          {/* ── LEFT: second avatar ── */}
          <div className="hidden md:block flex-shrink-0" style={{ position: "relative" }}>
            {/* purple glow */}
            <div
              className="absolute pointer-events-none"
              style={{
                inset: "-28px",
                background: "radial-gradient(ellipse at center, rgba(155,92,246,0.22) 0%, transparent 68%)",
                borderRadius: "9999px",
                zIndex: 0,
              }}
            />
            {/* phone frame — slightly smaller, tilted */}
            <div
              style={{
                position: "relative",
                zIndex: 1,
                width: "clamp(160px, 15vw, 220px)",
                aspectRatio: "9/16",
                borderRadius: "2rem",
                border: "1px solid rgba(155,92,246,0.35)",
                boxShadow: "0 0 50px rgba(155,92,246,0.22), 0 24px 60px rgba(0,0,0,0.7)",
                overflow: "hidden",
                backgroundColor: "#111",
                transform: "rotate(-3deg)",
              }}
            >
              <img
                src={`${BASE}/hero-avatar.jpg`}
                alt="Avatar IA publicando Reels"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: "top",
                  display: "block",
                }}
              />
              {/* overlay badge */}
              <div
                style={{
                  position: "absolute",
                  bottom: "1rem",
                  left: "50%",
                  transform: "translateX(-50%)",
                  backgroundColor: "rgba(9,9,9,0.82)",
                  backdropFilter: "blur(10px)",
                  border: "1px solid rgba(155,92,246,0.4)",
                  borderRadius: "9999px",
                  padding: "0.28rem 0.75rem",
                  fontSize: "0.6rem",
                  fontWeight: 700,
                  letterSpacing: "0.07em",
                  color: "#9B5CF6",
                  whiteSpace: "nowrap",
                }}
              >
                ✦ EN AUTOPILOT
              </div>
            </div>
          </div>

          {/* ── RIGHT: copy ── */}
          <div>
            <h2
              className="font-bold tracking-tight"
              style={{
                fontFamily: "var(--font-display, 'Outfit', sans-serif)",
                fontSize: "clamp(2rem, 5vw, 3.3rem)",
                lineHeight: 1.08,
                letterSpacing: "-0.035em",
                marginBottom: "1.25rem",
              }}
            >
              Crea tu clon digital.{" "}
              <span
                style={{
                  background: "linear-gradient(135deg, #4F6EF7 10%, #9B5CF6 90%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                Ponlo a trabajar por ti.
              </span>
            </h2>
            <p
              style={{
                color: "#666",
                fontSize: "1rem",
                lineHeight: 1.8,
                marginBottom: "2.5rem",
                maxWidth: 460,
              }}
            >
              Te enseñamos a crear tu avatar de forma efectiva, paso a paso.
              Después configuras el sistema y lo dejas publicando Reels en automático.
            </p>
            <button
              onClick={() => setCheckoutOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl font-bold transition-opacity hover:opacity-90"
              style={{
                background: "linear-gradient(135deg, #4F6EF7, #7B5CF6)",
                color: "#fff",
                padding: "1.1rem 2.5rem",
                fontSize: "1.05rem",
                border: "none",
                cursor: "pointer",
                boxShadow: "0 0 32px rgba(79,110,247,0.32)",
              }}
            >
              Montar mi sistema por $47 <ArrowRight size={17} />
            </button>
            <p style={{ marginTop: "0.9rem", color: "#333", fontSize: "0.78rem" }}>
              Pago único · Acceso inmediato · Sin suscripción
            </p>
          </div>
        </div>
      </section>

      {/* ── CHECKOUT MODAL ── */}
      <CheckoutModal isOpen={checkoutOpen} onClose={() => setCheckoutOpen(false)} />

      {/* ── FOOTER ── */}
      <footer
        className="text-center px-6 py-8"
        style={{ borderTop: "1px solid #131313" }}
      >
        <div className="flex justify-center gap-6 flex-wrap mb-3">
          {[
            { label: "Privacidad", href: `${BASE}/privacy` },
            { label: "Términos", href: `${BASE}/terms` },
            { label: "Acceder", href: `${BASE}/` },
          ].map(({ label, href }) => (
            <a
              key={label}
              href={href}
              style={{ color: "#444", fontSize: "0.8rem", textDecoration: "none" }}
            >
              {label}
            </a>
          ))}
        </div>
        <p style={{ color: "#333", fontSize: "0.75rem" }}>
          © 2026 Reelsona. Todos los derechos reservados.
        </p>
      </footer>
    </div>
  );
}
