import { useEffect, useState } from "react";
import { CheckoutModal } from "./CheckoutModal";
import {
  ArrowRight,
  Bot,
  Brain,
  Calendar,
  Check,
  ChevronDown,
  Clock,
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
`;

// ─── Data ───────────────────────────────────────────────────────────────────

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
  { wrong: "No es ChatGPT con un prompt para captions", right: "Es un sistema que conecta estrategia, guión, producción, edición y publicación en un flujo continuo" },
  { wrong: "No es un editor de video más", right: "Los videos salen listos de HeyGen con captions aplicados — sin que abras ningún editor" },
  { wrong: "No es un programador de posts", right: "La publicación es la última etapa de un sistema que empieza desde la idea" },
  { wrong: "No es una plataforma genérica para crear avatares", right: "Te guiamos a crear tu avatar en HeyGen paso a paso — y luego Reelsona es la capa operativa" },
];

const faqs = [
  { q: "¿Reelsona es una herramienta para crear avatares?", a: "No. Reelsona no crea avatares ni compite con HeyGen. Es el sistema que usa tu avatar para automatizar todo el proceso: estrategia, guiones, producción del video, captions y publicación." },
  { q: "¿Qué herramientas externas necesito?", a: "Para generar los videos necesitarás cuentas en HeyGen y OpenAI. Sus costos no están incluidos en Reelsona — te guiamos a configurarlas desde cero." },
  { q: "¿Necesito tener un avatar en HeyGen antes de empezar?", a: "No. Puedes entrar sin avatar y sin cuenta de HeyGen. La ruta guiada dentro de Reelsona te explica exactamente cómo crear tu avatar de forma efectiva — desde la grabación hasta tenerlo listo para producir contenido." },
  { q: "¿Cómo funciona el modo Autopilot?", a: "Cuando tienes tu estrategia, herramientas y preferencias configuradas, Autopilot ejecuta el pipeline completo: genera guiones, produce los videos con tu avatar, aplica captions y los publica en Instagram según el calendario que definiste." },
  { q: "¿Necesito saber editar videos?", a: "No. El sistema genera los videos completos con tu avatar y captions incluidos. No necesitas abrir ningún editor de video." },
  { q: "¿Tengo que grabarme frente a una cámara?", a: "No. Tu avatar IA habla por ti en cada Reel. Tú defines la estrategia y el guión — el sistema produce el video." },
  { q: "¿Qué pasa después de comprar?", a: "Recibirás un email de activación. Con ese link creas tu contraseña y accedes al sistema completo de inmediato." },
  { q: "¿Puedo publicar directamente en Instagram?", a: "Sí. Conectas tu cuenta de Instagram Business desde la plataforma y programas la publicación de tus Reels desde ahí." },
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
  const [checkoutOpen, setCheckoutOpen] = useState(false);
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
            onClick={() => setCheckoutOpen(true)}
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
            Empezar $47 →
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
                Monta tu sistema automático de Reels{" "}
                <span style={{ background: "linear-gradient(135deg,#4F6EF7 10%,#9B5CF6 90%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                  sin grabarte todos los días
                </span>
              </h1>

              <p style={{ fontSize: "clamp(0.95rem,1.8vw,1.1rem)", color: "#888", lineHeight: 1.75, maxWidth: 510, marginBottom: "2.25rem" }}>
                La capa estratégica y operativa que convierte tu conocimiento en ideas, guiones, videos con avatar, captions, edición y publicación en Instagram — completamente en automático.
              </p>

              <div className="flex flex-wrap gap-3" style={{ marginBottom: "1.5rem" }}>
                <button
                  onClick={() => setCheckoutOpen(true)}
                  className="inline-flex items-center gap-2"
                  style={{ background: "linear-gradient(135deg,#4F6EF7,#7B5CF6)", color: "#fff", border: "none", borderRadius: 12, padding: "1rem 2.1rem", fontSize: "1rem", fontWeight: 700, cursor: "pointer", boxShadow: "0 0 28px rgba(79,110,247,0.35)" }}
                >
                  Empezar por $47 <ArrowRight size={16} />
                </button>
                <div style={{ display: "flex", alignItems: "center", fontSize: "0.875rem", color: "#555", fontWeight: 500 }}>
                  Pago único. Sin suscripciones.
                </div>
              </div>

              <div className="flex flex-wrap gap-5" style={{ color: "#555", fontSize: "0.82rem" }}>
                {["Guión listo en minutos", "Video con tu avatar sin grabarte", "Autopilot publica por ti"].map((t) => (
                  <span key={t} className="flex items-center gap-1.5">
                    <Check size={11} color="#4F6EF7" strokeWidth={3} /> {t}
                  </span>
                ))}
              </div>
              <p style={{ fontSize: "0.72rem", color: "#363636", marginTop: "0.9rem" }}>
                Funciona con HeyGen y OpenAI · Costos independientes · Te guiamos paso a paso
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
                  <p style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.85)", marginBottom: "0.75rem", lineHeight: 1.5 }}>El secreto para publicar todos los días sin volverte loco... 🚀</p>
                  <div className="flex items-center justify-between">
                    <span style={{ fontSize: "0.65rem", fontWeight: 700, backgroundColor: "rgba(255,255,255,0.15)", backdropFilter: "blur(8px)", borderRadius: 6, padding: "0.2rem 0.55rem", color: "#fff" }}>Edición IA</span>
                    <div className="flex gap-1.5">
                      {["❤️", "💬"].map((e) => <div key={e} style={{ width: 22, height: 22, borderRadius: "9999px", backgroundColor: "rgba(255,255,255,0.18)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10 }}>{e}</div>)}
                    </div>
                  </div>
                </div>
                {/* progress bar */}
                <div style={{ position: "absolute", top: 0, inset: "0 0 auto 0", height: 3, backgroundColor: "rgba(255,255,255,0.15)" }}>
                  <div style={{ height: "100%", width: "33%", backgroundColor: "rgba(255,255,255,0.8)" }} />
                </div>
              </div>

              {/* floating pills */}
              <FloatingPill icon={<Calendar size={14} />} text="✦ 23 Reels / mes"    style={{ left: -90, top: 80,  zIndex: 10, transform: "rotate(-3deg)" }} />
              <FloatingPill icon={<Bot size={14} />}      text="100% automático"       style={{ right: -95, top: 170, zIndex: 10, transform: "rotate(4deg)" }} />
              <FloatingPill icon={<Video size={14} />}    text="Avatar activo"          style={{ left: -70, bottom: 150, zIndex: 10, transform: "rotate(2deg)" }} />
              <FloatingPill icon={<Instagram size={14} />} text="Publicado en Instagram" style={{ right: -105, bottom: 80, zIndex: 10, transform: "rotate(-3deg)" }} />
            </div>
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
              Tienes el avatar. Te falta el sistema.
            </h2>
            <p style={{ color: "#666", maxWidth: 540, margin: "0 auto", fontSize: "0.95rem", lineHeight: 1.75 }}>
              El avatar es solo una herramienta. Sin un sistema detrás, sigue dependiendo de tu tiempo, tu energía y tu disciplina para publicar con consistencia.
            </p>
          </div>

          <div className="grid gap-6 reveal-up stagger-1" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
            {/* Caos */}
            <div className="rounded-3xl relative overflow-hidden" style={{ backgroundColor: "#111", border: "1px solid rgba(255,80,80,0.12)", padding: "2rem" }}>
              <div style={{ position: "absolute", top: 0, right: 0, padding: "1.5rem", opacity: 0.07 }}><X size={120} color="#ff4444" /></div>
              <div style={{ display: "inline-block", backgroundColor: "rgba(255,80,80,0.1)", color: "#ff6666", fontWeight: 700, fontSize: "0.72rem", letterSpacing: "0.08em", textTransform: "uppercase", borderRadius: 999, padding: "0.25rem 0.75rem", marginBottom: "1.25rem" }}>Sin Reelsona — Caos</div>
              <h3 style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "1.25rem", fontWeight: 800, color: "#e0e0e0", marginBottom: "1.25rem" }}>Producción manual</h3>
              <div className="flex flex-col gap-3">
                {[
                  { Icon: Clock, t: "Horas pensando ideas frente a la pantalla en blanco" },
                  { Icon: FilePen, t: "Escribiendo guiones que no enganchan" },
                  { Icon: Video, t: "Grabando, repitiendo tomas, editando cortes" },
                  { Icon: Settings2, t: "Sufriendo con apps de captions dinámicos" },
                ].map(({ Icon, t }) => (
                  <div key={t} className="flex gap-3 items-start rounded-xl" style={{ backgroundColor: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.05)", padding: "0.85rem 1rem" }}>
                    <Icon size={18} color="#884444" style={{ flexShrink: 0, marginTop: 1 }} />
                    <span style={{ color: "#666", fontSize: "0.855rem", lineHeight: 1.55 }}>{t}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Sistema */}
            <div className="rounded-3xl relative overflow-hidden" style={{ backgroundColor: "#111", border: "1px solid rgba(79,110,247,0.3)", padding: "2rem", boxShadow: "0 0 60px rgba(79,110,247,0.08)" }}>
              <div style={{ position: "absolute", bottom: -40, right: -40, width: 200, height: 200, backgroundColor: "rgba(79,110,247,0.08)", borderRadius: "9999px", filter: "blur(40px)" }} />
              <div style={{ display: "inline-block", backgroundColor: "rgba(79,110,247,0.12)", color: "#4F6EF7", fontWeight: 700, fontSize: "0.72rem", letterSpacing: "0.08em", textTransform: "uppercase", borderRadius: 999, padding: "0.25rem 0.75rem", marginBottom: "1.25rem" }}>Con Reelsona — Sistema</div>
              <h3 style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "1.25rem", fontWeight: 800, color: "#e0e0e0", marginBottom: "1.25rem" }}>Máquina en Autopilot</h3>
              <div className="flex flex-col gap-2 relative" style={{ zIndex: 1 }}>
                <div style={{ position: "absolute", left: 19, top: 24, bottom: 24, width: 2, background: "linear-gradient(to bottom,#4F6EF7,#9B5CF6)" }} />
                {[
                  { Icon: Brain, t: "Estrategia de 30 días generada automáticamente" },
                  { Icon: Bot,   t: "IA escribe guiones optimizados para Reels" },
                  { Icon: Play,  t: "Avatar graba el video en HeyGen" },
                  { Icon: Instagram, t: "Publicado con captions en Instagram" },
                ].map(({ Icon, t }) => (
                  <div key={t} className="flex gap-3 items-center rounded-xl" style={{ background: "linear-gradient(90deg,rgba(79,110,247,0.1),transparent)", border: "1px solid rgba(79,110,247,0.18)", padding: "0.85rem 1rem" }}>
                    <div style={{ width: 38, height: 38, borderRadius: "9999px", backgroundColor: "#4F6EF7", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, zIndex: 2, boxShadow: "0 0 14px rgba(79,110,247,0.5)" }}>
                      <Icon size={17} color="#fff" />
                    </div>
                    <span style={{ color: "#ccc", fontSize: "0.855rem", fontWeight: 500 }}>{t}</span>
                    <Check size={14} color="#4F6EF7" strokeWidth={3} style={{ marginLeft: "auto", flexShrink: 0 }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          QUÉ ES REELSONA — Fake product UI
      ══════════════════════════════════════ */}
      <section style={{ backgroundColor: "#000", borderTop: "1px solid transparent", backgroundImage: "linear-gradient(#000,#000), linear-gradient(to right,transparent,rgba(79,110,247,0.4),transparent)", backgroundOrigin: "border-box", backgroundClip: "padding-box, border-box", padding: "6rem 1.5rem" }}>
        <div className="mx-auto" style={{ maxWidth: 1040 }}>
          <div className="text-center reveal-up" style={{ marginBottom: "3rem" }}>
            <h2 style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "clamp(1.75rem,4vw,2.6rem)", fontWeight: 800, letterSpacing: "-0.025em", lineHeight: 1.15, marginBottom: "1.25rem" }}>
              "HeyGen crea el video.{" "}
              <span style={{ background: "linear-gradient(135deg,#4F6EF7,#9B5CF6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                Reelsona crea el sistema."
              </span>
            </h2>
            <p style={{ color: "#666", maxWidth: 560, margin: "0 auto", fontSize: "0.95rem", lineHeight: 1.75 }}>
              No es un editor de video más. Es tu sala de control. Tú defines la estrategia; el sistema produce, edita y publica por ti.
            </p>
          </div>

          {/* Fake platform UI */}
          <div className="reveal-up stagger-1 mx-auto" style={{ maxWidth: 960 }}>
            <div style={{ borderRadius: 20, border: "1px solid rgba(255,255,255,0.08)", backgroundColor: "#0f0f0f", overflow: "hidden", boxShadow: "0 40px 100px rgba(0,0,0,0.6)" }}>
              {/* Window chrome */}
              <div style={{ backgroundColor: "#161616", borderBottom: "1px solid rgba(255,255,255,0.05)", padding: "0.75rem 1.25rem", display: "flex", alignItems: "center", gap: "1rem" }}>
                <div className="flex gap-1.5">
                  {["#333","#333","#333"].map((c,i) => <div key={i} style={{ width: 12, height: 12, borderRadius: "9999px", backgroundColor: c }} />)}
                </div>
                <div className="flex gap-1" style={{ overflowX: "auto" }}>
                  {["Content Pipeline","Script Editor","HeyGen Config"].map((tab, i) => (
                    <div key={tab} style={{ padding: "0.3rem 0.9rem", borderRadius: 8, fontSize: "0.78rem", fontWeight: 600, backgroundColor: i === 0 ? "rgba(255,255,255,0.07)" : "transparent", color: i === 0 ? "#e0e0e0" : "#555", whiteSpace: "nowrap" }}>{tab}</div>
                  ))}
                </div>
              </div>

              {/* Dashboard content */}
              <div className="grid" style={{ gridTemplateColumns: "1fr 2fr", gap: 0 }}>
                {/* Left sidebar */}
                <div style={{ borderRight: "1px solid rgba(255,255,255,0.05)", padding: "1.5rem" }}>
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
              Conecta los cables.{" "}
              <span style={{ background: "linear-gradient(135deg,#4F6EF7,#9B5CF6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Déjalo correr.</span>
            </h2>
            <p style={{ color: "#666", maxWidth: 560, margin: "0 auto", fontSize: "0.95rem", lineHeight: 1.8 }}>
              Configura tu estrategia, conecta tus herramientas y deja que tu clon digital trabaje por ti. El sistema ejecuta el pipeline completo sin intervención manual.
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
              <p style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontWeight: 700, fontSize: "1rem", color: "#e0e0e0", marginBottom: "0.3rem" }}>No pagas por producir un video. Montas una máquina.</p>
              <p style={{ color: "#666", fontSize: "0.875rem", lineHeight: 1.7, margin: 0 }}>Una vez que Autopilot está activo, tu clon digital puede publicar Reels esta semana, la siguiente y el mes que viene.</p>
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
            <img src={`${BASE}/relaxed-creator.jpg`} alt="Creator while system works" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.35, mixBlendMode: "luminosity" }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg,#090909 0%,rgba(9,9,9,0.85) 50%,transparent 100%)" }} />
            <div style={{ position: "relative", zIndex: 1, padding: "clamp(2.5rem,6vw,5rem)", maxWidth: 540 }}>
              <h2 style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "clamp(1.75rem,4vw,2.8rem)", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.1, marginBottom: "1.25rem" }}>
                Mientras tú vives,<br />tu avatar publica.
              </h2>
              <p style={{ color: "#888", fontSize: "1rem", lineHeight: 1.8, marginBottom: "2rem" }}>
                No pagas por producir un video. Pagas por montar una máquina que te devuelve el tiempo mientras tu marca personal sigue creciendo.
              </p>
              <button
                onClick={() => setCheckoutOpen(true)}
                style={{ background: "linear-gradient(135deg,#4F6EF7,#7B5CF6)", color: "#fff", border: "none", borderRadius: 12, padding: "1rem 2rem", fontSize: "1rem", fontWeight: 700, cursor: "pointer", boxShadow: "0 0 28px rgba(79,110,247,0.35)", display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                Quiero mi máquina por $47 <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          COMPARATIVA DE COSTOS — visual bars
      ══════════════════════════════════════ */}
      <section style={{ backgroundColor: "#0b0b0b", borderTop: "1px solid rgba(255,255,255,0.04)", padding: "6rem 1.5rem" }}>
        <div className="mx-auto" style={{ maxWidth: 820 }}>
          <div className="text-center reveal-up" style={{ marginBottom: "1.5rem" }}>
            <SectionLabel>Comparativa de costos</SectionLabel>
            <h2 style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "clamp(1.6rem,4vw,2.4rem)", fontWeight: 800, letterSpacing: "-0.025em", lineHeight: 1.15, marginBottom: "0.75rem" }}>
              Cuánto cuesta la consistencia<br />sin Reelsona
            </h2>
            <p style={{ color: "#444", fontSize: "0.8rem", maxWidth: 480, margin: "0 auto" }}>
              Rangos de referencia aproximados del mercado — no una promesa de ahorro exacto. Cada caso varía.
            </p>
          </div>

          <div className="rounded-3xl reveal-up stagger-1" style={{ backgroundColor: "#111", border: "1px solid rgba(255,255,255,0.07)", padding: "2rem 2.5rem" }}>
            <div className="flex flex-col gap-6">
              {[
                { label: "Agencia de producción con video/Reels", cost: "$5,000 – $10,000+ / mes", w: "100%" },
                { label: "Agencia boutique de contenido",          cost: "$2,000 – $5,000 / mes",   w: "55%"  },
                { label: "Especialista de contenido",              cost: "$1,000 – $3,500 / mes",   w: "40%"  },
                { label: "Videógrafo para contenido social",       cost: "$500 – $3,000 / día",     w: "32%"  },
                { label: "Edición de Reels por unidad",            cost: "$50 – $500+ por Reel",    w: "22%"  },
              ].map(({ label, cost, w }) => (
                <div key={label}>
                  <div className="flex justify-between" style={{ fontSize: "0.855rem", marginBottom: "0.5rem", flexWrap: "wrap", gap: "0.25rem" }}>
                    <span style={{ color: "#777" }}>{label}</span>
                    <span style={{ color: "#aaa", fontWeight: 600 }}>{cost}</span>
                  </div>
                  <div style={{ height: 10, backgroundColor: "#0a0a0a", borderRadius: 999, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: w, backgroundColor: "#2a2a2a", borderRadius: 999 }} />
                  </div>
                </div>
              ))}

              <div style={{ height: 1, backgroundColor: "rgba(255,255,255,0.07)", margin: "0.5rem 0" }} />

              {/* Reelsona bar */}
              <div style={{ position: "relative", backgroundColor: "rgba(79,110,247,0.06)", border: "1px solid rgba(79,110,247,0.25)", borderRadius: 16, padding: "1.25rem 1.5rem", boxShadow: "0 0 30px rgba(79,110,247,0.1)" }}>
                <div className="flex justify-between" style={{ fontSize: "1rem", fontWeight: 800, fontFamily: "var(--font-display,'Outfit',sans-serif)", marginBottom: "0.6rem", flexWrap: "wrap", gap: "0.25rem" }}>
                  <span style={{ color: "#e0e0e0", display: "flex", alignItems: "center", gap: 8 }}><Sparkles size={16} color="#4F6EF7" /> Reelsona — Sistema completo</span>
                  <span style={{ color: "#4F6EF7" }}>$47 pago único</span>
                </div>
                <div style={{ height: 10, backgroundColor: "#0a0a0a", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: "4%", background: "linear-gradient(90deg,#4F6EF7,#9B5CF6)", borderRadius: 999, boxShadow: "0 0 8px #4F6EF7" }} />
                </div>
                <p style={{ fontSize: "0.75rem", color: "#444", marginTop: "0.75rem" }}>*Requiere cuentas de HeyGen y OpenAI con costos independientes.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          QUÉ INCLUYE
      ══════════════════════════════════════ */}
      <section style={{ padding: "6rem 1.5rem" }}>
        <div className="mx-auto" style={{ maxWidth: 820 }}>
          <div className="text-center reveal-up" style={{ marginBottom: "2.5rem" }}>
            <SectionLabel>Dentro del sistema</SectionLabel>
            <h2 style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "clamp(1.6rem,4vw,2.4rem)", fontWeight: 800, letterSpacing: "-0.025em", lineHeight: 1.15 }}>Qué obtienes al entrar</h2>
            <p style={{ color: "#666", fontSize: "0.9rem", lineHeight: 1.75, maxWidth: 480, margin: "0.75rem auto 0" }}>Todo lo que necesitas para montar tu sistema de Reels con avatar. Sin módulos de pago adicionales.</p>
          </div>
          <div className="rounded-2xl reveal-up stagger-1" style={{ backgroundColor: "#0f0f0f", border: "1px solid rgba(79,110,247,0.18)", padding: "2.25rem 2rem", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg,#4F6EF7,#9B5CF6,transparent)" }} />
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))" }}>
              {includes.map((item) => (
                <div key={item} className="flex items-center gap-3">
                  <span className="flex-shrink-0 flex items-center justify-center rounded-full" style={{ width: 22, height: 22, backgroundColor: "rgba(79,110,247,0.12)", border: "1px solid rgba(79,110,247,0.28)" }}>
                    <Check size={10} color="#4F6EF7" strokeWidth={3} />
                  </span>
                  <span style={{ color: "#ccc", fontSize: "0.875rem" }}>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          POR QUÉ NO ES OTRA HERRAMIENTA IA
      ══════════════════════════════════════ */}
      <section style={{ backgroundColor: "#0b0b0b", borderTop: "1px solid rgba(255,255,255,0.04)", padding: "6rem 1.5rem" }}>
        <div className="mx-auto" style={{ maxWidth: 820 }}>
          <div className="text-center reveal-up" style={{ marginBottom: "3rem" }}>
            <SectionLabel>No es otra herramienta IA</SectionLabel>
            <h2 style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "clamp(1.6rem,4vw,2.4rem)", fontWeight: 800, letterSpacing: "-0.025em", lineHeight: 1.15 }}>
              Hay decenas de apps de IA para contenido.<br />Reelsona no es ninguna de ellas.
            </h2>
          </div>
          <div className="flex flex-col gap-3 reveal-up stagger-1">
            {notJustAiToolItems.map(({ wrong, right }) => (
              <div key={wrong} className="grid rounded-2xl overflow-hidden" style={{ gridTemplateColumns: "1fr 1fr", border: "1px solid #1c1c1c" }}>
                <div className="flex items-start gap-3 p-4" style={{ backgroundColor: "#0d0d0d", borderRight: "1px solid #1c1c1c" }}>
                  <X size={14} color="#664444" style={{ flexShrink: 0, marginTop: 2 }} />
                  <span style={{ color: "#555", fontSize: "0.84rem", lineHeight: 1.6 }}>{wrong}</span>
                </div>
                <div className="flex items-start gap-3 p-4" style={{ backgroundColor: "#0f0f0f" }}>
                  <Check size={14} color="#4F6EF7" strokeWidth={3} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span style={{ color: "#aaa", fontSize: "0.84rem", lineHeight: 1.6 }}>{right}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          PRECIO $47
      ══════════════════════════════════════ */}
      <section style={{ padding: "6rem 1.5rem" }}>
        <div className="mx-auto" style={{ maxWidth: 540 }}>
          <div className="rounded-2xl text-center reveal-up" style={{ backgroundColor: "#0f0f0f", border: "1px solid rgba(79,110,247,0.28)", padding: "3rem 2.5rem", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg,#4F6EF7,#9B5CF6)" }} />
            <SectionLabel>Precio de lanzamiento</SectionLabel>
            <div style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "3.75rem", fontWeight: 900, lineHeight: 1, marginBottom: "0.4rem", background: "linear-gradient(135deg,#4F6EF7,#9B5CF6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>$47 USD</div>
            <p style={{ color: "#444", fontSize: "0.82rem", marginBottom: "0.75rem" }}>Pago único · Sin suscripción mensual · Acceso completo</p>
            <div className="flex justify-center flex-wrap gap-4" style={{ marginBottom: "1.75rem" }}>
              {["Acceso inmediato", "Sin cuota mensual", "Autopilot incluido"].map((t) => (
                <span key={t} className="flex items-center gap-1.5" style={{ fontSize: "0.8rem", color: "#555" }}>
                  <Check size={11} color="#4F6EF7" strokeWidth={3} /> {t}
                </span>
              ))}
            </div>
            <button
              onClick={() => setCheckoutOpen(true)}
              style={{ background: "linear-gradient(135deg,#4F6EF7,#7B5CF6)", color: "#fff", border: "none", borderRadius: 12, padding: "1.1rem 2rem", fontSize: "1.05rem", fontWeight: 700, cursor: "pointer", boxShadow: "0 0 28px rgba(79,110,247,0.3)", display: "inline-flex", alignItems: "center", gap: 8, width: "100%", justifyContent: "center" }}
            >
              Montar mi sistema de Reels <ArrowRight size={17} />
            </button>
            <div style={{ marginTop: "1.25rem", backgroundColor: "rgba(255,255,255,0.025)", border: "1px solid #1e1e1e", borderRadius: 12, padding: "0.85rem 1rem", textAlign: "left" }}>
              <p style={{ fontSize: "0.72rem", color: "#555", fontWeight: 700, marginBottom: "0.25rem" }}>Nota sobre costos externos</p>
              <p style={{ fontSize: "0.72rem", color: "#3a3a3a", lineHeight: 1.65, margin: 0 }}>Para generar videos con avatar Reelsona usa HeyGen y OpenAI. Esas herramientas tienen sus propios planes y costos, no incluidos en los $47.</p>
            </div>
            <p style={{ color: "#2e2e2e", fontSize: "0.72rem", marginTop: "0.85rem" }}>Recibirás un email de activación al completar el pago.</p>
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
              <div style={{ position: "absolute", bottom: "1rem", left: "50%", transform: "translateX(-50%)", backgroundColor: "rgba(9,9,9,0.82)", backdropFilter: "blur(10px)", border: "1px solid rgba(155,92,246,0.4)", borderRadius: 999, padding: "0.25rem 0.7rem", fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.07em", color: "#9B5CF6", whiteSpace: "nowrap" }}>✦ EN AUTOPILOT</div>
            </div>
          </div>

          {/* Copy */}
          <div>
            <h2 style={{ fontFamily: "var(--font-display,'Outfit',sans-serif)", fontSize: "clamp(2rem,5vw,3.2rem)", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1.07, marginBottom: "1.25rem" }}>
              Tu clon digital te está esperando.{" "}
              <span style={{ background: "linear-gradient(135deg,#4F6EF7 10%,#9B5CF6 90%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                Ponlo a trabajar.
              </span>
            </h2>
            <p style={{ color: "#666", fontSize: "1rem", lineHeight: 1.8, marginBottom: "2.25rem", maxWidth: 460 }}>
              Te enseñamos a crear tu avatar de forma efectiva, paso a paso. Después configuras el sistema y lo dejas publicando Reels en automático.
            </p>
            <button
              onClick={() => setCheckoutOpen(true)}
              style={{ background: "linear-gradient(135deg,#4F6EF7,#7B5CF6)", color: "#fff", border: "none", borderRadius: 12, padding: "1.1rem 2.5rem", fontSize: "1.05rem", fontWeight: 700, cursor: "pointer", boxShadow: "0 0 32px rgba(79,110,247,0.32)", display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              Montar mi sistema por $47 <ArrowRight size={17} />
            </button>
            <p style={{ marginTop: "0.85rem", color: "#333", fontSize: "0.78rem" }}>Pago único · Acceso inmediato · Sin suscripción</p>
          </div>
        </div>
      </section>

      {/* ── CHECKOUT MODAL ── */}
      <CheckoutModal isOpen={checkoutOpen} onClose={() => setCheckoutOpen(false)} />

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
