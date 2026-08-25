import { useEffect, useRef, useState } from "react";
import { PlanCheckoutModal as PlanCheckoutModalLanding, type PlanCheckoutConfig } from "@/components/PlanCheckoutModal";
import {
  ArrowRight,
  Bot,
  Brain,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Crown,
  FilePen,
  Instagram,
  Layers,
  MessageSquare,
  Play,
  Repeat,
  Rocket,
  Settings2,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Video,
  X,
  Zap,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Scroll reveal ──────────────────────────────────────────────────────────

function useRevealObserver() {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add("is-visible");
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -40px 0px" }
    );
    document.querySelectorAll(".reveal-up").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
}

// ─── Global CSS ─────────────────────────────────────────────────────────────

const globalStyles = `
  .reveal-up {
    opacity: 0;
    transform: translateY(28px);
    transition: opacity 0.75s cubic-bezier(0.2,0.8,0.2,1), transform 0.75s cubic-bezier(0.2,0.8,0.2,1);
  }
  .reveal-up.is-visible { opacity: 1; transform: translateY(0); }
  .stagger-1 { transition-delay: 100ms; }
  .stagger-2 { transition-delay: 220ms; }
  .stagger-3 { transition-delay: 340ms; }

  .bg-grid-faint {
    background-image:
      linear-gradient(rgba(79,110,247,0.04) 1px, transparent 1px),
      linear-gradient(90deg, rgba(79,110,247,0.04) 1px, transparent 1px);
    background-size: 48px 48px;
  }

  @keyframes card-light {
    0%   { border-color:rgba(79,110,247,.6); box-shadow:0 0 32px rgba(79,110,247,.22),inset 0 0 24px rgba(79,110,247,.05); background-color:rgba(79,110,247,.06); }
    20%  { border-color:#1d1d1d; box-shadow:none; background-color:#0f0f0f; }
    100% { border-color:#1d1d1d; box-shadow:none; background-color:#0f0f0f; }
  }
  @keyframes arr-light {
    0%   { opacity:1; }
    20%  { opacity:0.15; }
    100% { opacity:0.15; }
  }
  .ap-c1{animation:card-light 5s ease-in-out 0s infinite}
  .ap-c2{animation:card-light 5s ease-in-out 1s infinite}
  .ap-c3{animation:card-light 5s ease-in-out 2s infinite}
  .ap-c4{animation:card-light 5s ease-in-out 3s infinite}
  .ap-c5{animation:card-light 5s ease-in-out 4s infinite}
  .ap-a1{animation:arr-light  5s ease-in-out 0s infinite}
  .ap-a2{animation:arr-light  5s ease-in-out 1s infinite}
  .ap-a3{animation:arr-light  5s ease-in-out 2s infinite}
  .ap-a4{animation:arr-light  5s ease-in-out 3s infinite}

  @keyframes node-pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
  .node-pulse { animation: node-pulse 2s cubic-bezier(.4,0,.6,1) infinite; }

  /* ── Responsive: before/after split ── */
  .before-after-split {
    display: grid;
    grid-template-columns: 1fr 1fr;
    border-radius: 28px;
    overflow: hidden;
    border: 1px solid #1c1c1c;
  }

  /* In-flow VS separator — hidden on desktop, shown between stacked panels on mobile */
  .before-after-vs-inflow { display: none; }

  @media (max-width: 767px) {
    .before-after-split { grid-template-columns: 1fr; }
    /* Absolute badge overlaps on mobile — hide it */
    .before-after-vs-badge { display: none !important; }
    /* In-flow VS appears between the two stacked panels */
    .before-after-vs-inflow {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0.85rem;
      background: #0d0d0d;
      border-top: 1px solid #1c1c1c;
      border-bottom: 1px solid #1c1c1c;
      font-family: var(--font-display,'Outfit',sans-serif);
      font-weight: 900;
      font-size: 0.72rem;
      letter-spacing: 0.06em;
      color: #444;
    }
    /* Remove right border from left panel when stacked (it becomes a spurious side border) */
    .before-after-left { border-right: none !important; }
  }

  /* ── Responsive: product UI panel ── */
  .product-ui-grid {
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: 0;
  }
  .product-ui-sidebar { display: block; }

  @media (max-width: 767px) {
    .product-ui-grid { grid-template-columns: 1fr; }
    .product-ui-sidebar { display: none; }
  }
`;

// ─── Data ───────────────────────────────────────────────────────────────────

const autopilotSteps = [
  { n: "01", title: "Define tu estrategia", desc: "Cuéntale al sistema sobre tu negocio, audiencia y objetivos para crear una base de contenido." },
  { n: "02", title: "Configura avatar y voz", desc: "Elige o conecta tu avatar, voz y herramientas de IA con la guía de Academia." },
  { n: "03", title: "Crea y revisa tus Reels", desc: "Genera ideas, guiones y videos con captions; decide qué publicar y cuándo." },
  { n: "04", title: "Programa cuando estés listo", desc: "Con Pro o Founder puedes activar Autopilot y la publicación programada en Instagram." },
];

const forWhom = [
  { Icon: Users, title: "Coaches y consultores", desc: "Que quieren presencia constante en Instagram sin dedicar horas cada semana a grabar contenido." },
  { Icon: Brain, title: "Emprendedores digitales", desc: "Con conocimiento que quieren monetizar a través de contenido sin contratar un equipo de producción." },
  { Icon: MessageSquare, title: "Quieres crear tu avatar IA", desc: "Nunca has creado un avatar digital y quieres aprender a hacerlo paso a paso para después ponerlo a crear contenido de forma automática." },
  { Icon: TrendingUp, title: "Educadores online", desc: "Que necesitan generar autoridad y comunidad con Reels constantes sin que la producción los consuma." },
];

// Academia de implementación — disponible con el acceso al producto
const programIncludes = [
  "5 módulos completos con 21 clases en video",
  "Módulo 1 — Prepara Reelsona para tu negocio",
  "Módulo 2 — Haz que Reelsona entienda tu negocio y tu mercado",
  "Módulo 3 — Configura tus Avatares y Voces",
  "Módulo 4 — Crea y publica tu primer Reel",
  "Módulo 5 — Activa tu máquina de contenido",
  "Lecciones prácticas dentro de Academia",
  "Acceso continuo al curso de implementación",
];

// Herramientas disponibles según el plan contratado
const toolsIncludes = [
  "Plan de contenido y guiones con IA",
  "Creación manual de Reels",
  "Avatares públicos y Avatar AI propio",
  "Caption Studio con plantillas visuales",
  "B-roll AI para tus videos",
  "Créditos mensuales según el plan elegido",
];

const notJustAiToolItems = [
  { wrong: "No es ChatGPT con un prompt para captions", right: "Es un sistema que conecta estrategia, guión, producción, edición y publicación en un flujo continuo" },
  { wrong: "No es un editor de video más", right: "Los videos salen listos con captions aplicados — sin que abras ningún editor" },
  { wrong: "No es un programador de posts", right: "La publicación es la última etapa de un sistema que empieza desde la idea" },
  { wrong: "No es una plataforma genérica para crear avatares", right: "Te guiamos a crear tu avatar paso a paso — y luego Reelsona es la capa operativa" },
];

const faqs = [
  { q: "¿Reelsona es una herramienta para crear avatares?", a: "No. Reelsona no crea avatares digitales por sí sola. Es el sistema que usa tu avatar para automatizar todo el proceso: estrategia, guiones, producción del video, captions y publicación." },
  { q: "¿Qué herramientas externas necesito?", a: "Para generar los videos necesitarás una cuenta de IA. Sus costos no están incluidos en Reelsona — te guiamos a configurarlas desde cero." },
  { q: "¿Necesito tener un avatar antes de empezar?", a: "No. Puedes empezar por Academia y seguir la ruta guiada para preparar tu avatar y voz. Para crearlo o conectarlo necesitarás aportar el material de referencia que pida el proveedor de IA." },
  { q: "¿Cómo funcionan los créditos?", a: "Los créditos se consumen según la duración de cada video. Como referencia, 50 créditos cubren aproximadamente 30 segundos de generación; los videos más largos consumen más." },
  { q: "¿Basic incluye Autopilot y publicación automática?", a: "No. Basic está pensado para crear Reels manualmente. Autopilot, programación y publicación automática están disponibles en los planes Pro y Founder." },
  { q: "¿Cómo funciona el modo Autopilot?", a: "Con un plan Pro o Founder, y una vez que tu estrategia, herramientas, avatar e Instagram Business estén configurados, Autopilot puede generar el flujo de contenido y programar las publicaciones según el calendario que definas." },
  { q: "¿Necesito saber editar videos?", a: "No. El sistema genera los videos completos con tu avatar y captions incluidos. No necesitas abrir ningún editor de video." },
  { q: "¿Tengo que grabarme frente a una cámara?", a: "No para cada Reel. Necesitarás preparar el material inicial de referencia si vas a crear tu propio avatar; después, el avatar puede aparecer en los videos que produzcas." },
  { q: "¿Qué pasa después de comprar?", a: "Recibirás un email de activación. Con ese link creas tu contraseña y accedes a Academia, con sus 5 módulos y 21 clases, además de las herramientas y créditos incluidos en el plan que hayas elegido." },
  { q: "¿Puedo publicar directamente en Instagram?", a: "Con Pro o Founder puedes conectar una cuenta de Instagram Business y programar publicaciones desde la plataforma. Necesitarás mantener los permisos de la cuenta activos." },
];

// ─── Shared components ───────────────────────────────────────────────────────

function FloatingPill({ icon, text, style }: { icon: React.ReactNode; text: string; style?: React.CSSProperties }) {
  return (
    <div
      className="absolute flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold reveal-up"
      style={{
        backgroundColor: "rgba(9,9,9,0.75)",
        backdropFilter: "blur(16px)",
        border: "1px solid rgba(255,255,255,0.1)",
        color: "#fff",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      <span style={{ color: "#4F6EF7" }}>{icon}</span>
      {text}
    </div>
  );
}

function SectionLabel({ children, purple }: { children: React.ReactNode; purple?: boolean }) {
  return (
    <span
      className="block mb-3 text-xs font-bold tracking-widest uppercase"
      style={{ color: purple ? "#9B5CF6" : "#4F6EF7" }}
    >
      {children}
    </span>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function Landing() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [planCheckout, setPlanCheckout] = useState<PlanCheckoutConfig | null>(null);
  const pricingRef = useRef<HTMLElement>(null);
  useRevealObserver();

  return (
    <div
      style={{
        backgroundColor: "#090909",
        color: "#f0f0f0",
        fontFamily: "var(--font-sans,'Plus Jakarta Sans',sans-serif)",
        minHeight: "100vh",
        overflowX: "hidden",
      }}
    >
      <style>{globalStyles}</style>

      {/* ── NAV ── */}
      <nav
        className="sticky top-0 z-50 flex items-center justify-between px-6"
        style={{
          height: 64,
          backgroundColor: "rgba(9,9,9,0.85)",
          backdropFilter: "blur(16px)",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <div className="flex items-center gap-2">
          <img src={`${BASE}/logo.png`} alt="Reelsona" style={{ width: 28, height: 28, objectFit: "contain" }} />
          <span style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontWeight: 800, fontSize: "1.05rem", letterSpacing: "-0.02em" }}>
            Reelsona
          </span>
        </div>
        <div className="flex items-center gap-3">
          <a href={`${BASE}/`} style={{ color: "#555", fontSize: "0.875rem", textDecoration: "none" }}>Acceder</a>
          <button
            onClick={() => pricingRef.current?.scrollIntoView({ behavior: "smooth" })}
            style={{
              background: "linear-gradient(135deg,#4F6EF7,#7B5CF6)",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              padding: "0.5rem 1.1rem",
              fontSize: "0.875rem",
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 0 20px rgba(79,110,247,0.3)",
            }}
          >
            Ver planes
          </button>
        </div>
      </nav>

      {/* ══════════════════════════════════════
          HERO
      ══════════════════════════════════════ */}
      <section
        className="relative overflow-hidden"
        style={{ minHeight: "calc(100vh - 64px)", display: "flex", alignItems: "center", padding: "5rem 1.5rem 4rem" }}
      >
        <div className="absolute inset-0 bg-grid-faint pointer-events-none" />
        <div className="absolute pointer-events-none" style={{ top: "40%", left: "50%", transform: "translate(-50%,-50%)", width: 900, height: 500, background: "radial-gradient(ellipse,rgba(79,110,247,0.12) 0%,transparent 65%)" }} />

        <div className="relative z-10 mx-auto w-full" style={{ maxWidth: 1100 }}>
          <div className="grid items-center" style={{ gridTemplateColumns: "1fr auto", gap: "clamp(2rem,5vw,5rem)" }}>

            {/* Copy */}
            <div className="reveal-up">
              <div className="inline-flex items-center gap-2 rounded-full text-xs font-bold tracking-widest uppercase mb-8" style={{ backgroundColor: "rgba(79,110,247,0.09)", border: "1px solid rgba(79,110,247,0.22)", padding: "0.3rem 0.95rem", color: "#4F6EF7" }}>
                <Sparkles size={12} /> Reelsona Autopilot
              </div>

              <h1
                className="font-bold tracking-tight"
                style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "clamp(2.3rem,5.5vw,4rem)", lineHeight: 1.06, letterSpacing: "-0.04em", marginBottom: "1.4rem" }}
              >
                Convierte tu conocimiento en Reels{" "}
                <span style={{ background: "linear-gradient(135deg,#4F6EF7 10%,#9B5CF6 90%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                  sin grabarte para cada video
                </span>
              </h1>

              <p style={{ fontSize: "clamp(0.95rem,1.8vw,1.1rem)", color: "#888", lineHeight: 1.75, maxWidth: 510, marginBottom: "2.25rem" }}>
                Una plataforma para planear, guionizar y producir Reels con avatar y captions. Configura tu estrategia una vez y luego crea o automatiza tu flujo según tu plan.
              </p>

              <div className="flex flex-wrap gap-3" style={{ marginBottom: "1.5rem" }}>
                <button
                  onClick={() => pricingRef.current?.scrollIntoView({ behavior: "smooth" })}
                  className="inline-flex items-center gap-2"
                  style={{ background: "linear-gradient(135deg,#4F6EF7,#7B5CF6)", color: "#fff", border: "none", borderRadius: 12, padding: "1rem 2.1rem", fontSize: "1rem", fontWeight: 700, cursor: "pointer", boxShadow: "0 0 28px rgba(79,110,247,0.35)" }}
                >
                  Ver planes y créditos <ArrowRight size={16} />
                </button>
              </div>

              <div className="flex flex-wrap gap-5" style={{ color: "#555", fontSize: "0.82rem" }}>
                {["Ideas y guiones con IA", "Reels con avatar y captions", "Autopilot en Pro y Founder"].map((t) => (
                  <span key={t} className="flex items-center gap-1.5">
                    <Check size={11} color="#4F6EF7" strokeWidth={3} /> {t}
                  </span>
                ))}
              </div>
              <p style={{ fontSize: "0.72rem", color: "#363636", marginTop: "0.9rem" }}>
                Desde USD 29/mes · Costos de IA externos no incluidos · Configuración guiada
              </p>
            </div>

            {/* Phone + floating pills */}
            <div className="hidden md:block flex-shrink-0 reveal-up stagger-1" style={{ position: "relative", height: 580, width: "clamp(220px,20vw,290px)" }}>
              {/* glows */}
              <div className="absolute pointer-events-none" style={{ inset: -30, background: "radial-gradient(ellipse,rgba(79,110,247,0.22) 0%,transparent 68%)", borderRadius: "9999px", zIndex: 0 }} />
              <div className="absolute pointer-events-none" style={{ bottom: -20, left: -20, width: 200, height: 200, background: "rgba(155,92,246,0.1)", borderRadius: "9999px", filter: "blur(40px)", zIndex: 0 }} />

              {/* phone */}
              <div style={{ position: "relative", zIndex: 1, width: "100%", aspectRatio: "9/16", borderRadius: "2.4rem", border: "6px solid #1a1a1a", overflow: "hidden", boxShadow: "0 0 60px rgba(79,110,247,0.22), 0 28px 70px rgba(0,0,0,0.7)", transform: "rotate(2deg)" }}>
                <img src={`${BASE}/hero-avatar.jpg`} alt="AI Avatar Reel" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", display: "block" }} />
                {/* overlay UI */}
                <div style={{ position: "absolute", inset: "0 0 0 0", background: "linear-gradient(to top,rgba(0,0,0,0.9) 0%,rgba(0,0,0,0.4) 40%,transparent 70%)", padding: "1.25rem", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                  <div className="flex items-center gap-2" style={{ marginBottom: "0.6rem" }}>
                    <div style={{ width: 28, height: 28, borderRadius: "9999px", background: "linear-gradient(135deg,#4F6EF7,#9B5CF6)", padding: 2 }}><div style={{ width: "100%", height: "100%", borderRadius: "9999px", backgroundColor: "#000" }} /></div>
                    <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#fff" }}>@tu_marca</span>
                  </div>
                  <p style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.85)", marginBottom: "0.75rem", lineHeight: 1.5 }}>Un flujo claro para publicar contenido sin empezar de cero.</p>
                  <div className="flex items-center justify-between">
                    <span style={{ fontSize: "0.65rem", fontWeight: 700, backgroundColor: "rgba(255,255,255,0.15)", backdropFilter: "blur(8px)", borderRadius: 6, padding: "0.2rem 0.55rem", color: "#fff" }}>Edición IA</span>
                    <span style={{ fontSize: "0.62rem", color: "rgba(255,255,255,0.68)" }}>Vista ilustrativa</span>
                  </div>
                </div>
                {/* progress bar */}
                <div style={{ position: "absolute", top: 0, inset: "0 0 auto 0", height: 3, backgroundColor: "rgba(255,255,255,0.15)" }}>
                  <div style={{ height: "100%", width: "33%", backgroundColor: "rgba(255,255,255,0.8)" }} />
                </div>
              </div>

              {/* floating pills */}
               <FloatingPill icon={<Calendar size={14} />} text="✦ Créditos mensuales" style={{ left: -90, top: 80,  zIndex: 10, transform: "rotate(-3deg)" }} />
              <FloatingPill icon={<Bot size={14} />}      text="Flujo configurable"   style={{ right: -95, top: 170, zIndex: 10, transform: "rotate(4deg)" }} />
              <FloatingPill icon={<Video size={14} />}    text="Avatar activo"          style={{ left: -70, bottom: 150, zIndex: 10, transform: "rotate(2deg)" }} />
              <FloatingPill icon={<Instagram size={14} />} text="Programación en Pro"    style={{ right: -105, bottom: 80, zIndex: 10, transform: "rotate(-3deg)" }} />
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          CÓMO FUNCIONA
      ══════════════════════════════════════ */}
      <section style={{ padding: "5rem 1.5rem", backgroundColor: "#050505", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="mx-auto" style={{ maxWidth: 1040 }}>
          <div className="text-center reveal-up" style={{ marginBottom: "2.5rem" }}>
            <SectionLabel>Un proceso claro</SectionLabel>
            <h2 style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "clamp(1.75rem,4vw,2.45rem)", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.12 }}>
              De tu experiencia a una rutina de contenido
            </h2>
            <p style={{ color: "#666", fontSize: "0.95rem", lineHeight: 1.7, maxWidth: 560, margin: "0.8rem auto 0" }}>
              Reelsona organiza el trabajo repetitivo para que puedas dedicar más tiempo a revisar, decidir y hacer crecer tu marca.
            </p>
          </div>

          <div className="grid gap-4 reveal-up stagger-1" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))" }}>
            {[
              { n: "01", Icon: Target, title: "Define el rumbo", text: "Configura tu negocio, audiencia y enfoque de contenido." },
              { n: "02", Icon: Bot, title: "Prepara tu presencia", text: "Conecta tu avatar, voz y las herramientas que vas a usar." },
              { n: "03", Icon: Video, title: "Produce con control", text: "Genera ideas, guiones, videos y captions para revisar." },
              { n: "04", Icon: Instagram, title: "Publica a tu ritmo", text: "Programa desde Pro o Founder cuando tu cuenta esté lista." },
            ].map(({ n, Icon, title, text }) => (
              <div key={n} style={{ position: "relative", borderRadius: 18, backgroundColor: "#0f0f0f", border: "1px solid rgba(255,255,255,0.08)", padding: "1.5rem", overflow: "hidden" }}>
                <span style={{ position: "absolute", top: 16, right: 18, fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "0.72rem", fontWeight: 800, color: "#2d2d2d" }}>{n}</span>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: "linear-gradient(135deg,rgba(79,110,247,0.16),rgba(155,92,246,0.15))", border: "1px solid rgba(79,110,247,0.22)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "1.1rem" }}>
                  <Icon size={18} color="#7B7FF7" />
                </div>
                <h3 style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontWeight: 800, fontSize: "0.98rem", color: "#e8e8e8", marginBottom: "0.45rem" }}>{title}</h3>
                <p style={{ color: "#666", fontSize: "0.83rem", lineHeight: 1.65, margin: 0 }}>{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          PLANES DE HERRAMIENTAS
      ══════════════════════════════════════ */}
      <section id="pricing" ref={pricingRef} style={{ padding: "6rem 1.5rem", backgroundColor: "#080808", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="mx-auto" style={{ maxWidth: 1080 }}>
          {/* Section header */}
          <div className="text-center reveal-up" style={{ marginBottom: "3rem" }}>
            <div style={{ display: "inline-block", backgroundColor: "rgba(79,110,247,0.1)", border: "1px solid rgba(79,110,247,0.22)", color: "#4F6EF7", fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", borderRadius: 999, padding: "0.25rem 0.75rem", marginBottom: "1rem" }}>
              Planes de herramientas
            </div>
            <h2 style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "clamp(1.8rem,4vw,2.5rem)", fontWeight: 900, letterSpacing: "-0.03em", marginBottom: "0.75rem" }}>
              Elige cómo quieres crear
            </h2>
            <p style={{ color: "#555", fontSize: "0.95rem", maxWidth: 480, margin: "0 auto" }}>
              Empieza creando Reels de forma manual o elige un plan con Autopilot para convertirlo en un flujo recurrente.
            </p>
          </div>

          {/* Plan cards */}
          <div className="reveal-up stagger-1" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: "1.5rem" }}>

            {/* Basic */}
            <div style={{ borderRadius: 20, backgroundColor: "#0f0f0f", border: "1px solid rgba(79,110,247,0.2)", padding: "2rem", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg,#4F6EF7,#60A5FA)" }} />
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1rem" }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(79,110,247,0.12)", border: "1px solid rgba(79,110,247,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Zap size={15} color="#4F6EF7" />
                </div>
                <p style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontWeight: 800, fontSize: "1rem", color: "#e0e0e0", margin: 0 }}>Basic</p>
              </div>
              <div style={{ marginBottom: "1.25rem" }}>
                <span style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "2.2rem", fontWeight: 900, background: "linear-gradient(135deg,#4F6EF7,#60A5FA)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>$29</span>
                <span style={{ color: "#444", fontSize: "0.82rem" }}> USD/mes</span>
              </div>
              <p style={{ fontSize: "0.78rem", color: "#4F6EF7", fontWeight: 700, marginBottom: "1rem" }}>400 créditos / mes</p>
              <p style={{ fontSize: "0.84rem", color: "#aaa", lineHeight: 1.55, minHeight: "2.6em", marginBottom: "1.15rem" }}>Para empezar a producir Reels y aprender el sistema a tu ritmo.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
                {["1 Avatar AI propio y avatares públicos","3 looks iniciales y 1 voz clonada","Plan de contenido, guiones y Caption Studio","B-roll AI y creación manual de Reels"].map((f) => (
                  <div key={f} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
                    <CheckCircle2 size={13} color="#4F6EF7" style={{ marginTop: 2, flexShrink: 0 }} />
                    <span style={{ color: "#777", fontSize: "0.82rem" }}>{f}</span>
                  </div>
                ))}
              </div>
              <p style={{ color: "#8b7395", fontSize: "0.75rem", lineHeight: 1.55, margin: "1.15rem 0 0", paddingTop: "0.85rem", borderTop: "1px solid rgba(255,255,255,0.06)" }}>No incluye Autopilot ni publicación automática.</p>
              <button
                onClick={() => setPlanCheckout({ planSlug: "basic", planName: "Basic", amountCents: 2900, currency: "usd", credits: 400, interval: "month", requireEmail: true })}
                style={{ marginTop: "1.5rem", width: "100%", background: "rgba(79,110,247,0.12)", color: "#4F6EF7", border: "1px solid rgba(79,110,247,0.3)", borderRadius: 10, padding: "0.75rem", fontSize: "0.85rem", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                Empezar a crear <ArrowRight size={14} />
              </button>
            </div>

            {/* Pro — most popular */}
            <div style={{ borderRadius: 20, backgroundColor: "#0f0f0f", border: "1px solid rgba(155,92,246,0.35)", padding: "2rem", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg,#9B5CF6,#7C3AED)" }} />
              <div style={{ position: "absolute", top: "1.25rem", right: "1.25rem", backgroundColor: "rgba(155,92,246,0.15)", border: "1px solid rgba(155,92,246,0.3)", color: "#9B5CF6", fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", borderRadius: 999, padding: "0.2rem 0.65rem" }}>Popular</div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1rem" }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(155,92,246,0.12)", border: "1px solid rgba(155,92,246,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Sparkles size={15} color="#9B5CF6" />
                </div>
                <p style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontWeight: 800, fontSize: "1rem", color: "#e0e0e0", margin: 0 }}>Pro</p>
              </div>
              <div style={{ marginBottom: "1.25rem" }}>
                <span style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "2.2rem", fontWeight: 900, background: "linear-gradient(135deg,#9B5CF6,#7C3AED)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>$97</span>
                <span style={{ color: "#444", fontSize: "0.82rem" }}> USD/mes</span>
              </div>
              <p style={{ fontSize: "0.78rem", color: "#9B5CF6", fontWeight: 700, marginBottom: "1rem" }}>1,500 créditos / mes</p>
              <p style={{ fontSize: "0.84rem", color: "#aaa", lineHeight: 1.55, minHeight: "2.6em", marginBottom: "1.15rem" }}>Para operar un flujo recurrente de contenido con automatización.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
                {["Todo lo de Basic","Hasta 3 Avatares AI propios","Autopilot para el flujo de contenido","Programación y publicación automática","Funciones avanzadas de automatización"].map((f) => (
                  <div key={f} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
                    <CheckCircle2 size={13} color="#9B5CF6" style={{ marginTop: 2, flexShrink: 0 }} />
                    <span style={{ color: "#777", fontSize: "0.82rem" }}>{f}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setPlanCheckout({ planSlug: "pro", planName: "Pro", amountCents: 9700, currency: "usd", credits: 1500, interval: "month", requireEmail: true })}
                style={{ marginTop: "1.5rem", width: "100%", background: "linear-gradient(135deg,#9B5CF6,#7C3AED)", color: "#fff", border: "none", borderRadius: 10, padding: "0.75rem", fontSize: "0.85rem", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, boxShadow: "0 0 24px rgba(155,92,246,0.3)" }}
              >
                Activar Autopilot <ArrowRight size={14} />
              </button>
            </div>

            {/* Founder */}
            <div style={{ borderRadius: 20, backgroundColor: "#0f0f0f", border: "1px solid rgba(245,158,11,0.3)", padding: "2rem", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg,#F59E0B,#D97706)" }} />
              <div style={{ position: "absolute", bottom: -40, right: -40, width: 160, height: 160, backgroundColor: "rgba(245,158,11,0.06)", borderRadius: "9999px", filter: "blur(40px)" }} />
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1rem" }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Crown size={15} color="#F59E0B" />
                </div>
                <p style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontWeight: 800, fontSize: "1rem", color: "#e0e0e0", margin: 0 }}>Founder</p>
              </div>
              <div style={{ marginBottom: "1.25rem" }}>
                <span style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "2.2rem", fontWeight: 900, background: "linear-gradient(135deg,#F59E0B,#FBBF24)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>$697</span>
                <span style={{ color: "#444", fontSize: "0.82rem" }}> USD/año</span>
              </div>
              <p style={{ fontSize: "0.78rem", color: "#F59E0B", fontWeight: 700, marginBottom: "1rem" }}>12 entregas mensuales de 1,500 créditos</p>
              <p style={{ fontSize: "0.84rem", color: "#aaa", lineHeight: 1.55, minHeight: "2.6em", marginBottom: "1.15rem" }}>Para quien busca acompañamiento y acceso anual desde el inicio.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
                {["Todo lo incluido en Pro","Mentoría estratégica 1 a 1 de bienvenida","Acceso al grupo privado de Founders","Soporte prioritario por WhatsApp","Acceso anticipado a nuevas funciones","Precio Founder protegido mientras mantenga su membresía","Máximo 10 plazas"].map((f) => (
                  <div key={f} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
                    <CheckCircle2 size={13} color="#F59E0B" style={{ marginTop: 2, flexShrink: 0 }} />
                    <span style={{ color: "#777", fontSize: "0.82rem" }}>{f}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setPlanCheckout({ planSlug: "founder", planName: "Founder", amountCents: 69700, currency: "usd", credits: 1500, interval: "year", requireEmail: true })}
                style={{ marginTop: "1.5rem", width: "100%", background: "linear-gradient(135deg,#F59E0B,#D97706)", color: "#fff", border: "none", borderRadius: 10, padding: "0.75rem", fontSize: "0.85rem", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, boxShadow: "0 0 24px rgba(245,158,11,0.25)" }}
              >
                Reservar plaza Founder <ArrowRight size={14} />
              </button>
            </div>

          </div>

          <div className="reveal-up stagger-2" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: "0.75rem", marginTop: "1.5rem" }}>
            {[
              "Los créditos se consumen por duración: 50 créditos equivalen aproximadamente a 30 segundos.",
              "Los costos de los proveedores de IA se gestionan por separado.",
              "Puedes comprar packs adicionales de créditos desde facturación.",
            ].map((text) => <p key={text} style={{ color: "#555", fontSize: "0.76rem", lineHeight: 1.6, textAlign: "center", margin: 0, padding: "0.85rem 1rem", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12 }}>{text}</p>)}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          PROBLEMA: Before / After
      ══════════════════════════════════════ */}
      <section style={{ backgroundColor: "#0b0b0b", borderTop: "1px solid rgba(255,255,255,0.04)", padding: "6rem 1.5rem" }}>
        <div className="mx-auto" style={{ maxWidth: 1040 }}>
          <div className="text-center reveal-up" style={{ marginBottom: "3.5rem" }}>
            <SectionLabel purple>El problema</SectionLabel>
            <h2 style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "clamp(1.75rem,4vw,2.6rem)", fontWeight: 800, letterSpacing: "-0.025em", lineHeight: 1.12, marginBottom: "1rem" }}>
              El contenido no debería depender del día que tengas.
            </h2>
            <p style={{ color: "#666", maxWidth: 540, margin: "0 auto", fontSize: "0.95rem", lineHeight: 1.75 }}>
              Tener un avatar no resuelve la parte difícil: decidir qué decir, preparar cada pieza y convertirlo en una rutina que puedas sostener.
            </p>
          </div>

          {/* Single container split by a VS divider */}
          <div className="reveal-up stagger-1" style={{ position: "relative" }}>
            <div className="before-after-split">

              {/* ── LEFT: Caos ── */}
              <div className="before-after-left" style={{ position: "relative", padding: "2.5rem", backgroundColor: "#0e0e0e", borderRight: "1px solid #1c1c1c", overflow: "hidden" }}>
                {/* noise texture overlay */}
                <div style={{ position: "absolute", inset: 0, backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E\")", opacity: 0.6, pointerEvents: "none" }} />
                {/* red glow top-right */}
                <div style={{ position: "absolute", top: -40, right: -40, width: 200, height: 200, backgroundColor: "rgba(200,50,50,0.06)", borderRadius: "9999px", filter: "blur(60px)", pointerEvents: "none" }} />

                <div style={{ position: "relative", zIndex: 1 }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6, backgroundColor: "rgba(200,50,50,0.1)", border: "1px solid rgba(200,50,50,0.15)", color: "#c05050", fontWeight: 700, fontSize: "0.68rem", letterSpacing: "0.1em", textTransform: "uppercase", borderRadius: 999, padding: "0.25rem 0.75rem", marginBottom: "1.5rem" }}>
                    <X size={10} strokeWidth={3} /> Sin Reelsona
                  </div>
                  <h3 style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "1.1rem", fontWeight: 800, color: "#777", marginBottom: "1.5rem", letterSpacing: "-0.02em" }}>Producción manual</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    {[
                      { Icon: Clock,    t: "Horas pensando ideas frente a una pantalla en blanco" },
                      { Icon: FilePen,  t: "Escribiendo guiones que no enganchan" },
                      { Icon: Video,    t: "Grabando, repitiendo tomas, editando cortes" },
                      { Icon: Settings2,t: "Sufriendo con apps de captions dinámicos" },
                    ].map(({ Icon, t }) => (
                      <div key={t} style={{ display: "flex", gap: "0.85rem", alignItems: "flex-start", padding: "0.85rem 1rem", borderRadius: 12, backgroundColor: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.04)" }}>
                        <Icon size={16} color="#5a3333" style={{ flexShrink: 0, marginTop: 1 }} />
                        <span style={{ color: "#4a4a4a", fontSize: "0.845rem", lineHeight: 1.55, textDecoration: "line-through", textDecorationColor: "rgba(180,60,60,0.3)" }}>{t}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* In-flow VS separator — only visible on mobile when panels stack */}
              <div className="before-after-vs-inflow">VS</div>

              {/* ── RIGHT: Sistema ── */}
              <div style={{ position: "relative", padding: "2.5rem", backgroundColor: "#0a0d14", overflow: "hidden" }}>
                {/* blue glow */}
                <div style={{ position: "absolute", bottom: -40, right: -40, width: 280, height: 280, backgroundColor: "rgba(79,110,247,0.1)", borderRadius: "9999px", filter: "blur(70px)", pointerEvents: "none" }} />
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg,rgba(79,110,247,0.5),rgba(155,92,246,0.5),transparent)", pointerEvents: "none" }} />

                <div style={{ position: "relative", zIndex: 1 }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6, backgroundColor: "rgba(79,110,247,0.12)", border: "1px solid rgba(79,110,247,0.25)", color: "#4F6EF7", fontWeight: 700, fontSize: "0.68rem", letterSpacing: "0.1em", textTransform: "uppercase", borderRadius: 999, padding: "0.25rem 0.75rem", marginBottom: "1.5rem" }}>
                    <Check size={10} strokeWidth={3} /> Con Reelsona
                  </div>
                  <h3 style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "1.1rem", fontWeight: 800, color: "#e8e8e8", marginBottom: "1.5rem", letterSpacing: "-0.02em" }}>Un flujo con control</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", position: "relative" }}>
                    {/* vertical connector */}
                    <div style={{ position: "absolute", left: 19, top: 20, bottom: 20, width: 2, background: "linear-gradient(to bottom,#4F6EF7,#9B5CF6,transparent)", zIndex: 0 }} />
                    {[
                      { Icon: Brain,     t: "Estrategia y temas alineados con tu negocio" },
                      { Icon: Bot,       t: "Guiones asistidos por IA listos para revisar" },
                      { Icon: Play,      t: "Video con avatar, voz y captions en un mismo flujo" },
                      { Icon: Instagram, t: "Programación disponible con Pro y Founder" },
                    ].map(({ Icon, t }) => (
                      <div key={t} style={{ position: "relative", zIndex: 1, display: "flex", gap: "0.85rem", alignItems: "center", padding: "0.85rem 1rem", borderRadius: 12, background: "linear-gradient(90deg,rgba(79,110,247,0.08),rgba(79,110,247,0.02))", border: "1px solid rgba(79,110,247,0.15)" }}>
                        <div style={{ width: 38, height: 38, borderRadius: "9999px", backgroundColor: "#4F6EF7", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 0 16px rgba(79,110,247,0.45)" }}>
                          <Icon size={16} color="#fff" />
                        </div>
                        <span style={{ color: "#c8c8c8", fontSize: "0.845rem", fontWeight: 500, flex: 1 }}>{t}</span>
                        <Check size={13} color="#4F6EF7" strokeWidth={3} style={{ flexShrink: 0 }} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* VS badge — centered between the two halves (desktop only) */}
            <div className="before-after-vs-badge" style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 10, width: 44, height: 44, borderRadius: "9999px", backgroundColor: "#090909", border: "1px solid #2a2a2a", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display,'Outfit',sans-serif)", fontWeight: 900, fontSize: "0.72rem", letterSpacing: "0.04em", color: "#444", boxShadow: "0 0 0 6px #0b0b0b" }}>
              VS
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          QUÉ ES REELSONA
      ══════════════════════════════════════ */}
      <section style={{ backgroundColor: "#000", borderTop: "1px solid transparent", backgroundImage: "linear-gradient(#000,#000), linear-gradient(to right,transparent,rgba(79,110,247,0.4),transparent)", backgroundOrigin: "border-box", backgroundClip: "padding-box, border-box", padding: "6rem 1.5rem" }}>
        <div className="mx-auto" style={{ maxWidth: 1040 }}>
          <div className="text-center reveal-up" style={{ marginBottom: "3rem" }}>
            <h2 style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "clamp(1.75rem,4vw,2.6rem)", fontWeight: 800, letterSpacing: "-0.025em", lineHeight: 1.15, marginBottom: "1.25rem" }}>
              "La IA produce las piezas.{" "}
              <span style={{ background: "linear-gradient(135deg,#4F6EF7,#9B5CF6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                Reelsona organiza el flujo."
              </span>
            </h2>
            <p style={{ color: "#666", maxWidth: 560, margin: "0 auto", fontSize: "0.95rem", lineHeight: 1.75 }}>
              No es otro editor. Es un espacio para definir tu estrategia, crear cada Reel y, si eliges Pro o Founder, automatizar la programación cuando todo esté configurado.
            </p>
          </div>

          {/* Vista ilustrativa del flujo */}
          <div className="reveal-up stagger-1 mx-auto" style={{ maxWidth: 960 }}>
            <div style={{ borderRadius: 20, border: "1px solid rgba(255,255,255,0.08)", backgroundColor: "#0f0f0f", overflow: "hidden", boxShadow: "0 40px 100px rgba(0,0,0,0.6)" }}>
              {/* Window chrome */}
              <div style={{ backgroundColor: "#161616", borderBottom: "1px solid rgba(255,255,255,0.05)", padding: "0.75rem 1.25rem", display: "flex", alignItems: "center", gap: "1rem" }}>
                <div className="flex gap-1.5">
                  {["#333","#333","#333"].map((c,i) => <div key={i} style={{ width: 12, height: 12, borderRadius: "9999px", backgroundColor: c }} />)}
                </div>
                <div className="flex gap-1" style={{ overflowX: "auto" }}>
                  {["Content Pipeline","Script Editor","Configuración"].map((tab, i) => (
                    <div key={tab} style={{ padding: "0.3rem 0.9rem", borderRadius: 8, fontSize: "0.78rem", fontWeight: 600, backgroundColor: i === 0 ? "rgba(255,255,255,0.07)" : "transparent", color: i === 0 ? "#e0e0e0" : "#555", whiteSpace: "nowrap" }}>{tab}</div>
                  ))}
                </div>
                <span style={{ marginLeft: "auto", color: "#555", fontSize: "0.68rem", fontWeight: 700, whiteSpace: "nowrap" }}>VISTA ILUSTRATIVA</span>
              </div>

              {/* Dashboard content */}
              <div className="product-ui-grid">
                {/* Left sidebar */}
                <div className="product-ui-sidebar" style={{ borderRight: "1px solid rgba(255,255,255,0.05)", padding: "1.5rem" }}>
                  <div className="flex items-center justify-between" style={{ marginBottom: "1.25rem" }}>
                    <span style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontWeight: 700, fontSize: "0.9rem", color: "#e0e0e0" }}>Próximos Reels</span>
                    <span style={{ backgroundColor: "rgba(79,110,247,0.18)", color: "#4F6EF7", fontSize: "0.6rem", fontWeight: 800, letterSpacing: "0.06em", padding: "0.2rem 0.5rem", borderRadius: 6 }}>AUTOPILOT ON</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {[
                      { t: "3 Mitos del Coaching", s: "Publicado", c: "#4ade80", bg: "rgba(74,222,128,0.1)" },
                      { t: "Cómo escalar a $10k", s: "Renderizando", c: "#fbbf24", bg: "rgba(251,191,36,0.1)" },
                      { t: "Error en tu oferta", s: "Guión listo", c: "#4F6EF7", bg: "rgba(79,110,247,0.1)" },
                      { t: "Sistema de ventas", s: "Idea", c: "#555", bg: "rgba(85,85,85,0.1)" },
                    ].map(({ t, s, c, bg }) => (
                      <div key={t} style={{ backgroundColor: "#1a1a1a", borderRadius: 10, border: "1px solid rgba(255,255,255,0.04)", padding: "0.75rem" }}>
                        <div style={{ fontSize: "0.8rem", color: "#ccc", fontWeight: 600, marginBottom: "0.4rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t}</div>
                        <span style={{ fontSize: "0.68rem", fontWeight: 700, color: c, backgroundColor: bg, borderRadius: 6, padding: "0.15rem 0.5rem" }}>{s}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Main editor area */}
                <div style={{ padding: "1.5rem", position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", top: 0, right: 0, width: 200, height: 200, backgroundColor: "rgba(155,92,246,0.07)", filter: "blur(60px)" }} />
                  <div className="flex items-start justify-between" style={{ marginBottom: "1.25rem", gap: "1rem", position: "relative", zIndex: 1 }}>
                    <div>
                      <h3 style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "1.15rem", fontWeight: 800, color: "#fff", marginBottom: "0.3rem" }}>Cómo escalar a $10k</h3>
                      <p style={{ fontSize: "0.75rem", color: "#555" }}>Hook: "Si sigues cobrando por hora, nunca vas a llegar a $10k..."</p>
                    </div>
                    <button style={{ backgroundColor: "#4F6EF7", color: "#fff", border: "none", borderRadius: 8, padding: "0.45rem 0.9rem", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", flexShrink: 0 }}>
                      <Play size={11} fill="currentColor" /> Generar Video
                    </button>
                  </div>
                  <div style={{ backgroundColor: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 10, padding: "1rem", fontFamily: "monospace", fontSize: "0.8rem", color: "#888", lineHeight: 1.75, marginBottom: "1rem", position: "relative", zIndex: 1 }}>
                    <span style={{ color: "#9B5CF6", fontWeight: 700 }}>[Hook]</span> Si sigues cobrando por hora, nunca vas a llegar a $10k al mes. Te explico por qué.<br /><br />
                    <span style={{ color: "#4F6EF7", fontWeight: 700 }}>[Cuerpo]</span> El problema es que tu tiempo tiene un límite. Para escalar, necesitas empaquetar tu conocimiento en una oferta high-ticket.<br /><br />
                    <span style={{ color: "#4ade80", fontWeight: 700 }}>[CTA]</span> Comenta 'ESCALAR' y te envío mi sistema exacto por DM.
                  </div>
                  <div className="flex flex-wrap gap-4 items-center" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "0.85rem", position: "relative", zIndex: 1 }}>
                    <span style={{ fontSize: "0.75rem", color: "#555" }}><Bot size={13} color="#4F6EF7" style={{ display: "inline", marginRight: 5 }} />Avatar: <span style={{ color: "#bbb" }}>Studio Alpha</span></span>
                    <span style={{ fontSize: "0.75rem", color: "#555" }}><Settings2 size={13} color="#9B5CF6" style={{ display: "inline", marginRight: 5 }} />Estilo: <span style={{ color: "#bbb" }}>Hormozi Style</span></span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          AUTOPILOT — pilares + pipeline animado + before/after
      ══════════════════════════════════════ */}
      <section style={{ backgroundColor: "#0b0b0b", borderTop: "1px solid rgba(255,255,255,0.04)", padding: "6rem 1.5rem" }}>
        <div className="mx-auto" style={{ maxWidth: 1040 }}>
          {/* Header */}
          <div className="text-center reveal-up" style={{ marginBottom: "3.5rem" }}>
            <div className="inline-flex items-center gap-2 rounded-full text-xs font-bold tracking-widest uppercase mb-4" style={{ backgroundColor: "rgba(155,92,246,0.08)", border: "1px solid rgba(155,92,246,0.22)", padding: "0.3rem 0.95rem", color: "#9B5CF6" }}>
              <Rocket size={12} /> Modo Autopilot
            </div>
            <h2 style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "clamp(1.75rem,4vw,2.6rem)", fontWeight: 800, letterSpacing: "-0.025em", lineHeight: 1.12, marginBottom: "1rem" }}>
              Configura una vez.{" "}
              <span style={{ background: "linear-gradient(135deg,#4F6EF7,#9B5CF6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Automatiza cuando estés listo.</span>
            </h2>
            <p style={{ color: "#666", maxWidth: 560, margin: "0 auto", fontSize: "0.95rem", lineHeight: 1.8 }}>
              Pro y Founder incorporan Autopilot para ayudarte a sostener el flujo después de configurar tu estrategia, avatar, herramientas e Instagram Business.
            </p>
          </div>

          {/* Sequential card animation */}
          <div className="flex items-stretch reveal-up stagger-3" style={{ gap: 0, overflowX: "auto", marginBottom: "3rem" }}>
            {autopilotSteps.flatMap(({ n, title, desc }, idx) => {
              const items = [
                <div
                  key={`c-${n}`}
                  className={`ap-c${idx + 1} rounded-2xl text-center`}
                  style={{ flex: "1 1 0", minWidth: 130, border: "1px solid #1d1d1d", backgroundColor: "#0f0f0f", padding: "1.5rem 0.9rem" }}
                >
                  <div className="flex items-center justify-center rounded-full mx-auto" style={{ width: 42, height: 42, background: "linear-gradient(135deg,rgba(79,110,247,0.18),rgba(155,92,246,0.18))", border: "1px solid rgba(79,110,247,0.3)", fontSize: "0.78rem", fontWeight: 800, color: "#4F6EF7", fontFamily: "var(--font-display,'Outfit',sans-serif)", backgroundColor: "#0f0f0f", marginBottom: "0.9rem" }}>
                    {n}
                  </div>
                  <h3 style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontWeight: 700, fontSize: "0.82rem", color: "#e0e0e0", marginBottom: "0.4rem" }}>{title}</h3>
                  <p style={{ color: "#555", fontSize: "0.75rem", lineHeight: 1.55, margin: 0 }}>{desc}</p>
                </div>,
              ];
              if (idx < autopilotSteps.length - 1) {
                items.push(
                  <div key={`a-${idx}`} className={`ap-a${idx + 1} flex flex-col items-center justify-center gap-0.5 flex-shrink-0`} style={{ width: 28, alignSelf: "center" }}>
                    <ArrowRight size={10} color="#4F6EF7" />
                    <ArrowRight size={10} color="#7B5CF6" />
                    <ArrowRight size={10} color="#4F6EF7" />
                  </div>
                );
              }
              return items;
            })}
          </div>

          {/* Callout */}
          <div className="flex flex-wrap items-center gap-5 rounded-2xl reveal-up" style={{ background: "linear-gradient(135deg,rgba(79,110,247,0.07),rgba(155,92,246,0.07))", border: "1px solid rgba(155,92,246,0.2)", padding: "1.75rem 2rem" }}>
            <div style={{ width: 48, height: 48, flexShrink: 0, borderRadius: 14, background: "linear-gradient(135deg,rgba(79,110,247,0.18),rgba(155,92,246,0.18))", border: "1px solid rgba(155,92,246,0.3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Repeat size={22} color="#9B5CF6" />
            </div>
            <div style={{ flex: 1, minWidth: 240 }}>
              <p style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontWeight: 700, fontSize: "1rem", color: "#e0e0e0", marginBottom: "0.3rem" }}>Mantén el control sin repetir el trabajo.</p>
              <p style={{ color: "#666", fontSize: "0.875rem", lineHeight: 1.7, margin: 0 }}>Revisas lo importante al inicio; después, Autopilot puede encargarse de las tareas repetitivas que hayas configurado.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          PARA QUIÉN ES
      ══════════════════════════════════════ */}
      <section style={{ padding: "6rem 1.5rem" }}>
        <div className="mx-auto" style={{ maxWidth: 980 }}>
          <div className="text-center reveal-up" style={{ marginBottom: "3rem" }}>
            <SectionLabel>Para quién es</SectionLabel>
            <h2 style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "clamp(1.6rem,4vw,2.4rem)", fontWeight: 800, letterSpacing: "-0.025em", lineHeight: 1.15 }}>
              Diseñado para quienes tienen conocimiento<br />y quieren un sistema que lo distribuya
            </h2>
          </div>
          <div className="grid gap-4 reveal-up stagger-1" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))" }}>
            {forWhom.map(({ Icon, title, desc }) => (
              <div key={title} className="rounded-2xl" style={{ backgroundColor: "#111", border: "1px solid #1e1e1e", padding: "1.6rem 1.5rem" }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(79,110,247,0.09)", color: "#4F6EF7", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "1rem" }}><Icon size={18} /></div>
                <h3 style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontWeight: 700, fontSize: "0.92rem", color: "#e0e0e0", marginBottom: "0.4rem" }}>{title}</h3>
                <p style={{ color: "#666", fontSize: "0.845rem", lineHeight: 1.65, margin: 0 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          LIFESTYLE — "Mientras tú vives..."
      ══════════════════════════════════════ */}
      <section style={{ padding: "3rem 1.5rem 6rem" }}>
        <div className="mx-auto reveal-up" style={{ maxWidth: 1040 }}>
          <div style={{ borderRadius: 32, overflow: "hidden", position: "relative", border: "1px solid rgba(255,255,255,0.05)" }}>
            <img src={`${BASE}/relaxed-creator.jpg`} alt="Creator while system works" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 10%", opacity: 1 }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg,#090909 0%,rgba(9,9,9,0.82) 36%,rgba(9,9,9,0.12) 60%,transparent 100%)" }} />
            <div style={{ position: "relative", zIndex: 1, padding: "clamp(2.5rem,6vw,5rem)", maxWidth: 540 }}>
              <h2 style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "clamp(1.75rem,4vw,2.8rem)", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.1, marginBottom: "1.25rem" }}>
                Tu marca no debería detenerse<br />cuando tú tienes una semana ocupada.
              </h2>
              <p style={{ color: "#888", fontSize: "1rem", lineHeight: 1.8, marginBottom: "2rem" }}>
                Reelsona te ayuda a convertir lo que ya sabes en una rutina de contenido: ideas, guiones, videos con avatar y captions, sin empezar desde una página en blanco.
              </p>
              <button
                onClick={() => pricingRef.current?.scrollIntoView({ behavior: "smooth" })}
                style={{ background: "linear-gradient(135deg,#4F6EF7,#7B5CF6)", color: "#fff", border: "none", borderRadius: 12, padding: "1rem 2rem", fontSize: "1rem", fontWeight: 700, cursor: "pointer", boxShadow: "0 0 28px rgba(79,110,247,0.35)", display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                Ver planes y créditos <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          QUÉ ORGANIZA REELSONA
      ══════════════════════════════════════ */}
      <section style={{ backgroundColor: "#0b0b0b", borderTop: "1px solid rgba(255,255,255,0.04)", padding: "6rem 1.5rem" }}>
        <div className="mx-auto" style={{ maxWidth: 820 }}>
          <div className="text-center reveal-up" style={{ marginBottom: "2.5rem" }}>
            <SectionLabel>Una sola sala de control</SectionLabel>
            <h2 style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "clamp(1.6rem,4vw,2.4rem)", fontWeight: 800, letterSpacing: "-0.025em", lineHeight: 1.15, marginBottom: "0.75rem" }}>
              Menos herramientas sueltas.<br />Más claridad para publicar.
            </h2>
            <p style={{ color: "#666", fontSize: "0.9rem", lineHeight: 1.7, maxWidth: 560, margin: "0 auto" }}>
              Reelsona no sustituye tus decisiones ni los proveedores de IA. Ordena el proceso que convierte una idea en un Reel listo para revisar o programar.
            </p>
          </div>

          <div className="grid gap-3 reveal-up stagger-1" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(330px,1fr))" }}>
            {notJustAiToolItems.map(({ wrong, right }, index) => (
              <div key={wrong} style={{ display: "grid", gridTemplateColumns: "36px 1fr", gap: "0.85rem", borderRadius: 16, backgroundColor: "#111", border: "1px solid rgba(255,255,255,0.07)", padding: "1.25rem" }}>
                <span style={{ width: 30, height: 30, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(79,110,247,0.12)", color: "#6e82ff", fontFamily: "var(--font-display,'Outfit',sans-serif)", fontWeight: 800, fontSize: "0.72rem" }}>0{index + 1}</span>
                <div>
                  <p style={{ color: "#777", fontSize: "0.78rem", lineHeight: 1.55, marginBottom: "0.35rem", textDecoration: "line-through", textDecorationColor: "rgba(255,255,255,0.15)" }}>{wrong}</p>
                  <p style={{ color: "#ddd", fontSize: "0.86rem", lineHeight: 1.55, margin: 0 }}>{right}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          QUÉ INCLUYE
      ══════════════════════════════════════ */}
      <section style={{ padding: "6rem 1.5rem" }}>
        <div className="mx-auto" style={{ maxWidth: 900 }}>
          <div className="text-center reveal-up" style={{ marginBottom: "3rem" }}>
            <SectionLabel>Lo que obtienes</SectionLabel>
            <h2 style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "clamp(1.6rem,4vw,2.4rem)", fontWeight: 800, letterSpacing: "-0.025em", lineHeight: 1.15 }}>Todo lo que incluye tu plan</h2>
            <p style={{ color: "#666", fontSize: "0.9rem", lineHeight: 1.75, maxWidth: 520, margin: "0.75rem auto 0" }}>Cada plan incluye créditos mensuales y herramientas para crear tus Reels. La automatización avanzada y la publicación programada dependen del plan elegido.</p>
          </div>

          <div className="grid gap-5 reveal-up stagger-1" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))" }}>
            {/* Guía Paso a Paso */}
            <div style={{ borderRadius: 20, backgroundColor: "#0f0f0f", border: "1px solid rgba(79,110,247,0.22)", padding: "2rem", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg,#4F6EF7,#9B5CF6)" }} />
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.5rem" }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: "rgba(79,110,247,0.12)", border: "1px solid rgba(79,110,247,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Layers size={18} color="#4F6EF7" />
                </div>
                <div>
                  <p style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontWeight: 800, fontSize: "0.95rem", color: "#e0e0e0", margin: 0 }}>Guía Paso a Paso de Implementación</p>
                  <p style={{ fontSize: "0.72rem", color: "#4F6EF7", fontWeight: 700, margin: 0 }}>5 módulos · 21 clases en video</p>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                {programIncludes.map((item) => (
                  <div key={item} style={{ display: "flex", alignItems: "flex-start", gap: "0.65rem" }}>
                    <span style={{ flexShrink: 0, width: 18, height: 18, borderRadius: "9999px", backgroundColor: "rgba(79,110,247,0.1)", border: "1px solid rgba(79,110,247,0.25)", display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                      <Check size={9} color="#4F6EF7" strokeWidth={3} />
                    </span>
                    <span style={{ color: "#aaa", fontSize: "0.845rem", lineHeight: 1.55 }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Herramientas */}
            <div style={{ borderRadius: 20, backgroundColor: "#0f0f0f", border: "1px solid rgba(155,92,246,0.22)", padding: "2rem", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg,#9B5CF6,#4F6EF7)" }} />
              <div style={{ position: "absolute", bottom: -40, right: -40, width: 180, height: 180, backgroundColor: "rgba(155,92,246,0.07)", borderRadius: "9999px", filter: "blur(50px)" }} />
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: "rgba(155,92,246,0.12)", border: "1px solid rgba(155,92,246,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Zap size={18} color="#9B5CF6" />
                </div>
                <div>
                  <p style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontWeight: 800, fontSize: "0.95rem", color: "#e0e0e0", margin: 0 }}>Herramientas de automatización de IG</p>
                  <p style={{ fontSize: "0.72rem", color: "#9B5CF6", fontWeight: 700, margin: 0 }}>Herramientas según tu plan</p>
                </div>
              </div>
              <p style={{ fontSize: "0.78rem", color: "#444", marginBottom: "1.25rem", lineHeight: 1.6 }}>
                Accede a las herramientas de creación y automatización que corresponden a tu plan, con créditos mensuales para producir tus Reels.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", position: "relative", zIndex: 1 }}>
                {toolsIncludes.map((item) => (
                  <div key={item} style={{ display: "flex", alignItems: "flex-start", gap: "0.65rem" }}>
                    <span style={{ flexShrink: 0, width: 18, height: 18, borderRadius: "9999px", backgroundColor: "rgba(155,92,246,0.1)", border: "1px solid rgba(155,92,246,0.25)", display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                      <Check size={9} color="#9B5CF6" strokeWidth={3} />
                    </span>
                    <span style={{ color: "#aaa", fontSize: "0.845rem", lineHeight: 1.55 }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          FAQ
      ══════════════════════════════════════ */}
      <section style={{ backgroundColor: "#0b0b0b", borderTop: "1px solid rgba(255,255,255,0.04)", padding: "6rem 1.5rem" }}>
        <div className="mx-auto" style={{ maxWidth: 660 }}>
          <div className="text-center reveal-up" style={{ marginBottom: "2.5rem" }}>
            <h2 style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "clamp(1.6rem,4vw,2.2rem)", fontWeight: 800, letterSpacing: "-0.025em" }}>Preguntas frecuentes</h2>
          </div>
          <div className="reveal-up stagger-1">
            {faqs.map((faq, i) => (
              <div key={i} style={{ borderBottom: i < faqs.length - 1 ? "1px solid #1a1a1a" : "none" }}>
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full text-left flex items-center justify-between gap-4 py-5 bg-transparent border-0 cursor-pointer"
                  style={{ color: "#e8e8e8", fontSize: "0.92rem", fontWeight: 600 }}
                >
                  <span>{faq.q}</span>
                  <ChevronDown size={15} color="#444" style={{ flexShrink: 0, transform: openFaq === i ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                </button>
                {openFaq === i && <p style={{ color: "#777", fontSize: "0.875rem", lineHeight: 1.8, paddingBottom: "1.25rem", margin: 0 }}>{faq.a}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          CTA FINAL — big text + avatar
      ══════════════════════════════════════ */}
      <section style={{ padding: "7rem 1.5rem", position: "relative", overflow: "hidden" }}>
        <div className="absolute inset-0 bg-grid-faint pointer-events-none" />
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 700, height: 500, background: "radial-gradient(ellipse,rgba(79,110,247,0.09) 0%,transparent 68%)", pointerEvents: "none" }} />
        <div
          className="relative z-10 mx-auto grid items-center reveal-up"
          style={{ maxWidth: 980, gridTemplateColumns: "auto 1fr", gap: "clamp(2.5rem,6vw,6rem)" }}
        >
          {/* Avatar */}
          <div className="hidden md:block flex-shrink-0" style={{ position: "relative" }}>
            <div style={{ position: "absolute", inset: -28, background: "radial-gradient(ellipse,rgba(155,92,246,0.22) 0%,transparent 68%)", borderRadius: "9999px", zIndex: 0, pointerEvents: "none" }} />
            <div style={{ position: "relative", zIndex: 1, width: "clamp(160px,15vw,215px)", aspectRatio: "9/16", borderRadius: "2rem", border: "1px solid rgba(155,92,246,0.35)", boxShadow: "0 0 50px rgba(155,92,246,0.22),0 24px 60px rgba(0,0,0,0.7)", overflow: "hidden", backgroundColor: "#111", transform: "rotate(-3deg)" }}>
              <img src={`${BASE}/hero-avatar.jpg`} alt="Avatar IA" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", display: "block" }} />
               <div style={{ position: "absolute", bottom: "1rem", left: "50%", transform: "translateX(-50%)", backgroundColor: "rgba(9,9,9,0.82)", backdropFilter: "blur(10px)", border: "1px solid rgba(155,92,246,0.4)", borderRadius: 999, padding: "0.25rem 0.7rem", fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.07em", color: "#9B5CF6", whiteSpace: "nowrap" }}>FLUJO CONFIGURADO</div>
            </div>
          </div>

          {/* Copy */}
          <div>
            <h2 style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "clamp(2rem,5vw,3.2rem)", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1.07, marginBottom: "1.25rem" }}>
              Elige un plan que encaje con{" "}
              <span style={{ background: "linear-gradient(135deg,#4F6EF7 10%,#9B5CF6 90%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                tu forma de crear.
              </span>
            </h2>
            <p style={{ color: "#666", fontSize: "1rem", lineHeight: 1.8, marginBottom: "2.25rem", maxWidth: 460 }}>
              Empieza con creación manual o activa Autopilot cuando quieras un flujo recurrente. En ambos casos tendrás Academia para configurar todo paso a paso.
            </p>
            <button
              onClick={() => pricingRef.current?.scrollIntoView({ behavior: "smooth" })}
              style={{ background: "linear-gradient(135deg,#4F6EF7,#7B5CF6)", color: "#fff", border: "none", borderRadius: 12, padding: "1.1rem 2.5rem", fontSize: "1.05rem", fontWeight: 700, cursor: "pointer", boxShadow: "0 0 32px rgba(79,110,247,0.32)", display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              Elegir mi plan <ArrowRight size={17} />
            </button>
          </div>
        </div>
      </section>

      {/* ── PLAN CHECKOUT MODAL ── */}
      {planCheckout && (
        <PlanCheckoutModalLanding
          config={planCheckout}
          onClose={() => setPlanCheckout(null)}
        />
      )}

      {/* ── FOOTER ── */}
      <footer style={{ borderTop: "1px solid #131313", padding: "2.5rem 1.5rem", textAlign: "center" }}>
        <div className="flex justify-center gap-6 flex-wrap" style={{ marginBottom: "0.75rem" }}>
          {[{ label: "Privacidad", href: `${BASE}/privacy` }, { label: "Términos", href: `${BASE}/terms` }, { label: "Acceder", href: `${BASE}/` }].map(({ label, href }) => (
            <a key={label} href={href} style={{ color: "#444", fontSize: "0.8rem", textDecoration: "none" }}>{label}</a>
          ))}
        </div>
        <p style={{ color: "#333", fontSize: "0.75rem" }}>© 2026 Reelsona. Todos los derechos reservados.</p>
      </footer>
    </div>
  );
}
