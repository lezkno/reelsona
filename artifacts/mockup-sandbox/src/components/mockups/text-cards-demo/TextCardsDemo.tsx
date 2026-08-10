import { useEffect, useState } from "react"

// ─── Card definitions ─────────────────────────────────────────────────────────
// Three types that could appear at different moments of a Reel script

const CARDS = [
  {
    id: "hook",
    type: "🪝 Hook",
    typeColor: "bg-violet-500",
    timestamp: "0:02",
    headline: "¿Sabías que el 73% de las marcas no sabe qué publicar?",
    sub: null,
    style: "hook",
  },
  {
    id: "stat",
    type: "📊 Stat",
    typeColor: "bg-sky-500",
    timestamp: "0:11",
    headline: "2.3M",
    sub: "creadores ya usan IA para planificar su contenido",
    style: "stat",
  },
  {
    id: "cta",
    type: "📣 CTA",
    typeColor: "bg-rose-500",
    timestamp: "0:24",
    headline: "Seguime para más estrategias de contenido",
    sub: null,
    style: "cta",
  },
]

// ─── Individual card renderers ────────────────────────────────────────────────

function HookCard({ visible }: { visible: boolean }) {
  return (
    <div
      className={`transition-all duration-500 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
      }`}
    >
      <div className="bg-black/75 backdrop-blur-sm border border-white/20 rounded-2xl px-5 py-4 shadow-2xl">
        <p className="text-white font-bold text-[17px] leading-snug tracking-tight">
          ¿Sabías que el <span className="text-violet-300">73%</span> de las marcas no sabe qué publicar?
        </p>
      </div>
    </div>
  )
}

function StatCard({ visible }: { visible: boolean }) {
  return (
    <div
      className={`transition-all duration-500 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
      }`}
    >
      <div className="bg-sky-500/90 backdrop-blur-sm border border-sky-300/30 rounded-2xl px-5 py-4 shadow-2xl text-center">
        <p className="text-white font-black text-5xl tracking-tight leading-none">2.3M</p>
        <p className="text-sky-100 text-sm font-medium mt-1 leading-snug">
          creadores ya usan IA para planificar su contenido
        </p>
      </div>
    </div>
  )
}

function CtaCard({ visible }: { visible: boolean }) {
  return (
    <div
      className={`transition-all duration-500 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
      }`}
    >
      <div className="bg-gradient-to-r from-rose-500 to-orange-400 rounded-2xl px-5 py-4 shadow-2xl flex items-center gap-3">
        <p className="text-white font-bold text-[16px] leading-snug flex-1">
          Seguime para más estrategias de contenido
        </p>
        <div className="shrink-0 bg-white/25 rounded-full w-9 h-9 flex items-center justify-center">
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </div>
  )
}

// ─── Main demo ────────────────────────────────────────────────────────────────

export function TextCardsDemo() {
  const [active, setActive] = useState(0)
  const [visible, setVisible] = useState(true)
  const [playing, setPlaying] = useState(true)

  // Auto-cycle through cards
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setActive((p) => (p + 1) % CARDS.length)
        setVisible(true)
      }, 400)
    }, 3200)
    return () => clearInterval(timer)
  }, [playing])

  const card = CARDS[active]

  const handlePrev = () => {
    setPlaying(false)
    setVisible(false)
    setTimeout(() => {
      setActive((p) => (p - 1 + CARDS.length) % CARDS.length)
      setVisible(true)
    }, 200)
  }

  const handleNext = () => {
    setPlaying(false)
    setVisible(false)
    setTimeout(() => {
      setActive((p) => (p + 1) % CARDS.length)
      setVisible(true)
    }, 200)
  }

  return (
    <div className="min-h-screen bg-zinc-900 flex items-center justify-center p-4">
      <div className="flex flex-col items-center gap-4 w-full max-w-[320px]">

        {/* Label */}
        <p className="text-zinc-400 text-xs font-medium tracking-widest uppercase">
          Cards de texto — Preview
        </p>

        {/* Phone frame */}
        <div className="relative w-full" style={{ aspectRatio: "9/16" }}>

          {/* Video background simulation */}
          <div className="absolute inset-0 rounded-3xl overflow-hidden shadow-2xl">
            {/* Gradient bg simulating an avatar video */}
            <div className="absolute inset-0 bg-gradient-to-b from-zinc-800 via-zinc-700 to-zinc-900" />
            {/* Simulated avatar silhouette */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-28 h-28 rounded-full bg-zinc-600/60 flex items-center justify-center mb-10">
                <svg className="w-16 h-16 text-zinc-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
                </svg>
              </div>
            </div>
            {/* Top gradient fade */}
            <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/40 to-transparent" />
            {/* Bottom gradient fade */}
            <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/60 to-transparent" />
          </div>

          {/* Timestamp badge */}
          <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-sm text-white/70 text-[10px] font-mono px-2 py-0.5 rounded-full z-10">
            {card.timestamp}
          </div>

          {/* Card type pill */}
          <div className={`absolute top-4 right-4 ${card.typeColor} text-white text-[10px] font-bold px-2.5 py-1 rounded-full z-10`}>
            {card.type}
          </div>

          {/* The card itself — positioned at bottom */}
          <div className="absolute inset-x-4 bottom-16 z-10">
            {card.style === "hook" && <HookCard visible={visible} />}
            {card.style === "stat" && <StatCard visible={visible} />}
            {card.style === "cta" && <CtaCard visible={visible} />}
          </div>

          {/* IG-style caption area */}
          <div className="absolute inset-x-4 bottom-4 z-10">
            <p className="text-white/50 text-[10px] leading-tight line-clamp-1">
              Así es como los mejores creadores planifican su contenido cada semana...
            </p>
          </div>
        </div>

        {/* Dots + nav */}
        <div className="flex items-center gap-4">
          <button
            onClick={handlePrev}
            className="w-8 h-8 rounded-full bg-zinc-700 hover:bg-zinc-600 flex items-center justify-center transition-colors"
          >
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <div className="flex gap-2">
            {CARDS.map((c, i) => (
              <button
                key={c.id}
                onClick={() => { setPlaying(false); setVisible(false); setTimeout(() => { setActive(i); setVisible(true) }, 200) }}
                className={`h-2 rounded-full transition-all duration-300 ${
                  i === active ? "w-6 bg-white" : "w-2 bg-zinc-600 hover:bg-zinc-400"
                }`}
              />
            ))}
          </div>

          <button
            onClick={handleNext}
            className="w-8 h-8 rounded-full bg-zinc-700 hover:bg-zinc-600 flex items-center justify-center transition-colors"
          >
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Legend */}
        <div className="w-full grid grid-cols-3 gap-2 text-center">
          {CARDS.map((c, i) => (
            <button
              key={c.id}
              onClick={() => { setPlaying(false); setVisible(false); setTimeout(() => { setActive(i); setVisible(true) }, 200) }}
              className={`rounded-xl px-2 py-2 border transition-all ${
                i === active
                  ? "border-white/40 bg-white/10"
                  : "border-white/10 bg-white/5 hover:bg-white/10"
              }`}
            >
              <p className="text-white text-xs font-semibold">{c.type}</p>
              <p className="text-zinc-400 text-[9px] mt-0.5">en {c.timestamp}</p>
            </button>
          ))}
        </div>

        <p className="text-zinc-600 text-[10px] text-center">
          Las cards se generan automáticamente desde el guión del video
        </p>
      </div>
    </div>
  )
}
