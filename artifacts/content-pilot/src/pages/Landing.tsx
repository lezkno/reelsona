import { useState } from "react";
import {
  ArrowRight,
  Calendar,
  Camera,
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
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Data ──────────────────────────────────────────────────────────────────────

const steps = [
  {
    n: "01",
    Icon: Camera,
    title: "Configura tu avatar",
    desc: "Conecta tus APIs y elige el avatar que te representará en tus Reels.",
  },
  {
    n: "02",
    Icon: Brain,
    title: "Genera tu estrategia",
    desc: "El sistema analiza tu nicho y crea un plan de contenido con hooks y guiones listos.",
  },
  {
    n: "03",
    Icon: Zap,
    title: "Crea tus Reels",
    desc: "Genera los videos con tu avatar, captions y estructura visual optimizada.",
  },
  {
    n: "04",
    Icon: Calendar,
    title: "Publica y repite",
    desc: "Programa la publicación en Instagram y mantén el flujo sin esfuerzo manual.",
  },
];

const benefits = [
  { Icon: Sparkles, text: "Sin quedarte sin ideas de contenido" },
  { Icon: Clock, text: "Sin grabarte frente a cámara todos los días" },
  { Icon: MessageSquare, text: "Guiones y hooks pensados para formato avatar" },
  { Icon: LayoutTemplate, text: "Captions y estructura visual incluida" },
  { Icon: Calendar, text: "Calendario y automatización de publicaciones" },
  { Icon: TrendingUp, text: "Sistema guiado paso a paso desde cero" },
];

const includes = [
  "Ruta guiada de implementación desde cero",
  "Plataforma para generar estrategia, guiones y videos",
  "Estudio de mercado con análisis de competidores",
  "Generador de guiones con hooks para Reels",
  "Creación de videos con avatar IA",
  "Captions con estilo visual automáticos",
  "Publicación programada en Instagram",
  "Área de clases paso a paso",
  "Plantillas y checklists de producción",
];

const demoItems = [
  "Configurar avatar y conectar APIs",
  "Estudio de mercado automático",
  "Estrategia y plan de contenido",
  "Generación de guiones con hooks",
  "Crear videos con avatar IA",
  "Captions y publicación en Instagram",
];

const faqs = [
  {
    q: "¿Necesito saber editar videos?",
    a: "No. El sistema genera los videos completos con tu avatar. No necesitas editar nada manualmente.",
  },
  {
    q: "¿Tengo que grabarme frente a una cámara?",
    a: "No. Usas un avatar IA que habla por ti. Tú escribes o editas el guión, el sistema hace el video.",
  },
  {
    q: "¿Qué herramientas externas necesito?",
    a: "Para generar los videos necesitarás cuentas en HeyGen y OpenAI. Sus costos no están incluidos y te guiamos paso a paso para configurarlas desde cero.",
  },
  {
    q: "¿Esto funciona si no tengo experiencia técnica?",
    a: "Sí. El sistema está diseñado para que sigas una ruta guiada. No necesitas conocimientos técnicos previos.",
  },
  {
    q: "¿Puedo usar mi propio avatar personalizado?",
    a: "Sí. Puedes crear y conectar tu propio avatar en HeyGen y usarlo dentro de la plataforma.",
  },
  {
    q: "¿Qué pasa después de comprar?",
    a: "Recibirás un email de activación. Con ese link creas tu contraseña y accedes al sistema completo de inmediato.",
  },
  {
    q: "¿Puedo publicar directamente en Instagram?",
    a: "Sí, puedes conectar tu cuenta de Instagram Business desde la plataforma y programar la publicación de tus Reels.",
  },
];

// ─── Sub-components ────────────────────────────────────────────────────────────

function VideoPlaceholder({ label, tall }: { label: string; tall?: boolean }) {
  return (
    <div
      className="relative w-full rounded-2xl overflow-hidden"
      style={{
        paddingTop: tall ? "75%" : "56.25%",
        backgroundColor: "#111",
        border: "1px solid #1e1e1e",
      }}
    >
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-3"
        style={{
          background: "linear-gradient(135deg, #0f0f0f 0%, #161616 100%)",
        }}
      >
        <div
          className="flex items-center justify-center rounded-full"
          style={{
            width: 64,
            height: 64,
            backgroundColor: "rgba(79,110,247,0.12)",
            border: "2px solid rgba(79,110,247,0.35)",
          }}
        >
          <Play size={26} color="#4F6EF7" fill="#4F6EF7" />
        </div>
        <span className="text-sm" style={{ color: "#444" }}>
          {label}
        </span>
      </div>
    </div>
  );
}

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
          <img src={`${BASE}/logo.png`} alt="Reelsona" style={{ width: 30, height: 30, objectFit: "contain" }} />
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
          <a
            href={`${BASE}/checkout`}
            className="text-sm font-semibold rounded-lg transition-opacity hover:opacity-90"
            style={{
              backgroundColor: "#4F6EF7",
              color: "#fff",
              padding: "0.45rem 1rem",
              textDecoration: "none",
            }}
          >
            Empezar →
          </a>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section
        className="relative flex flex-col items-center justify-center text-center overflow-hidden"
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
            background:
              "radial-gradient(ellipse, rgba(79,110,247,0.11) 0%, transparent 70%)",
          }}
        />
        {/* coral accent glow */}
        <div
          className="absolute pointer-events-none"
          style={{
            bottom: "10%",
            right: "5%",
            width: 350,
            height: 250,
            background:
              "radial-gradient(ellipse, rgba(255,94,91,0.07) 0%, transparent 70%)",
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
                Avatar Content Machine
              </div>

              <h1
                className="font-bold tracking-tight"
                style={{
                  fontFamily: "var(--font-display, 'Outfit', sans-serif)",
                  fontSize: "clamp(2.1rem, 5vw, 3.8rem)",
                  lineHeight: 1.08,
                  letterSpacing: "-0.035em",
                  marginBottom: "1.5rem",
                }}
              >
                Crea Reels con tu avatar{" "}
                <span
                  style={{
                    background: "linear-gradient(135deg, #4F6EF7 10%, #9B5CF6 90%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                    display: "block",
                  }}
                >
                  sin grabarte todos los días
                </span>
              </h1>

              <p
                style={{
                  fontSize: "clamp(0.95rem, 1.8vw, 1.15rem)",
                  color: "#777",
                  lineHeight: 1.75,
                  maxWidth: 500,
                  marginBottom: "2.5rem",
                }}
              >
                Accede a un sistema guiado que te lleva desde la estrategia hasta
                tus primeros videos listos para publicar.
              </p>

              <div className="flex flex-wrap gap-3">
                <a
                  href={`${BASE}/checkout`}
                  className="inline-flex items-center gap-2 rounded-xl font-bold transition-opacity hover:opacity-90"
                  style={{
                    backgroundColor: "#4F6EF7",
                    color: "#fff",
                    padding: "0.9rem 2rem",
                    fontSize: "1rem",
                    textDecoration: "none",
                  }}
                >
                  Acceder ahora <ArrowRight size={16} />
                </a>
                <a
                  href="#video-ventas"
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
                  <Play size={14} fill="currentColor" /> Ver demo
                </a>
              </div>

              {/* social proof strip */}
              <div
                className="flex items-center gap-5 flex-wrap mt-9"
                style={{ color: "#444", fontSize: "0.8rem" }}
              >
                {["Sin grabar cámara", "Avatar IA", "Publicación automática"].map(
                  (t) => (
                    <span key={t} className="flex items-center gap-1.5">
                      <Check size={11} color="#4F6EF7" strokeWidth={3} /> {t}
                    </span>
                  )
                )}
              </div>
            </div>

            {/* ── RIGHT: avatar image ── */}
            <div
              className="hidden md:block flex-shrink-0"
              style={{ position: "relative" }}
            >
              {/* glow behind image */}
              <div
                className="absolute pointer-events-none"
                style={{
                  inset: "-20px",
                  background: "radial-gradient(ellipse at center, rgba(79,110,247,0.22) 0%, transparent 70%)",
                  borderRadius: "9999px",
                  zIndex: 0,
                }}
              />
              <img
                src={`${BASE}/hero-avatar.jpg`}
                alt="Avatar IA presentador"
                style={{
                  position: "relative",
                  zIndex: 1,
                  width: "clamp(260px, 22vw, 360px)",
                  aspectRatio: "9/16",
                  objectFit: "cover",
                  objectPosition: "top",
                  borderRadius: "2rem",
                  border: "1px solid rgba(79,110,247,0.25)",
                  boxShadow: "0 0 60px rgba(79,110,247,0.18), 0 24px 60px rgba(0,0,0,0.6)",
                }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── VIDEO VENTAS ── */}
      <section
        id="video-ventas"
        className="mx-auto px-6"
        style={{ maxWidth: 900, paddingTop: "5rem", paddingBottom: "5rem" }}
      >
        <div className="text-center mb-8">
          <SectionTitle>Mira cómo funciona el sistema</SectionTitle>
          <p
            className="mx-auto mt-4"
            style={{ color: "#666", maxWidth: 520, lineHeight: 1.75, fontSize: "0.95rem" }}
          >
            En este video te explico la transformación: cómo pasar de no saber
            qué publicar a tener un flujo para crear contenido con avatar.
          </p>
        </div>
        <VideoPlaceholder label="Video de presentación próximamente" />
      </section>

      {/* ── PASOS ── */}
      <section
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
            <SectionTitle>Cómo funciona</SectionTitle>
          </div>

          <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
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
                {/* ghost number */}
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
                <p style={{ color: "#555", fontSize: "0.855rem", lineHeight: 1.65 }}>
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── VIDEO DEMO ── */}
      <section
        id="video-demo"
        className="mx-auto px-6"
        style={{ maxWidth: 960, paddingTop: "5rem", paddingBottom: "5rem" }}
      >
        <div className="grid gap-12 items-center" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          {/* text */}
          <div>
            <SectionLabel>Demo de la plataforma</SectionLabel>
            <SectionTitle>
              Ve la plataforma<br />por dentro
            </SectionTitle>
            <ul className="mt-6 flex flex-col gap-3">
              {demoItems.map((item) => (
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
          {/* video */}
          <VideoPlaceholder label="Demo próximamente" tall />
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
                <span style={{ color: "#bbb", fontSize: "0.875rem", lineHeight: 1.55, paddingTop: 2 }}>
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
        <div className="text-center mb-10">
          <SectionLabel>Dentro del sistema</SectionLabel>
          <SectionTitle>Qué obtienes al entrar</SectionTitle>
        </div>

        <div
          className="rounded-2xl"
          style={{
            backgroundColor: "#111",
            border: "1px solid #1e1e1e",
            padding: "2.25rem 2rem",
          }}
        >
          {/* accent line top */}
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
                    style={{ color: "#666", fontSize: "0.875rem", lineHeight: 1.75 }}
                  >
                    {faq.a}
                  </p>
                )}
              </div>
            ))}
          </div>
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
        {/* bg glows */}
        <div
          className="absolute pointer-events-none"
          style={{
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: 600,
            height: 360,
            background:
              "radial-gradient(ellipse, rgba(79,110,247,0.09) 0%, transparent 70%)",
          }}
        />
        <div
          className="absolute pointer-events-none"
          style={{
            top: "40%",
            left: "30%",
            width: 300,
            height: 200,
            background:
              "radial-gradient(ellipse, rgba(255,94,91,0.06) 0%, transparent 70%)",
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
            Empieza a crear Reels{" "}
            <span
              style={{
                background:
                  "linear-gradient(135deg, #4F6EF7 10%, #9B5CF6 90%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                display: "block",
              }}
            >
              sin grabarte todos los días
            </span>
          </h2>
          <p
            style={{
              color: "#555",
              fontSize: "1rem",
              lineHeight: 1.75,
              marginBottom: "2.75rem",
            }}
          >
            Accede al sistema, configura tu avatar y publica tus primeros Reels
            con IA esta semana.
          </p>
          <a
            href={`${BASE}/checkout`}
            className="inline-flex items-center gap-2 rounded-xl font-bold transition-opacity hover:opacity-90"
            style={{
              backgroundColor: "#4F6EF7",
              color: "#fff",
              padding: "1.05rem 2.5rem",
              fontSize: "1.05rem",
              textDecoration: "none",
            }}
          >
            Acceder ahora <ArrowRight size={18} />
          </a>
        </div>
      </section>

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
              style={{
                color: "#444",
                fontSize: "0.8rem",
                textDecoration: "none",
              }}
            >
              {label}
            </a>
          ))}
        </div>
        <p style={{ color: "#2a2a2a", fontSize: "0.75rem" }}>
          © 2025 Reelsona. Todos los derechos reservados.
        </p>
      </footer>
    </div>
  );
}
