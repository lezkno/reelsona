import "./_group.css"
import { useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import {
  AlertTriangle, Check, CheckCircle2, ChevronDown, Clock3, Eye, FileText,
  ImageIcon, Instagram, Loader2, Play, Send, Sparkles, UserRound, Wand2, ZoomIn,
} from "lucide-react"

type CaptionStatus = "processing" | "done" | "failed" | "disabled" | null
type CopyStatus = "generating" | "done" | "failed" | null
type VideoStatus = "publishing" | "done" | null
type ItemStatus = "draft" | "scripting" | "scripted" | "generating" | "ready" | "published" | "failed"
type ScenarioKey = "awaiting_publish" | "generating" | "captioning" | "done"
type PipelineMode = "generating" | "captioning" | "copy_generating" | "publishing" | "awaiting_publish" | "scripted_waiting" | "next" | "done"
type Effects = { zoom: boolean; ai_broll: boolean; text_cards: boolean }
type Item = {
  topic: string; status: ItemStatus; scheduled_at: string | null; updated_at: string
  video_id: string | null; caption: string | null; hashtags: string | null
  caption_status: CaptionStatus; copy_status: CopyStatus; video_status: VideoStatus
  video_effects?: Partial<Effects> | null
}

const STEPS = [
  { key: "script", label: "Guion", desc: "Hook + estructura", icon: FileText, ms: 60000 },
  { key: "video", label: "Video con Avatar", desc: "Render del avatar", icon: UserRound, ms: 600000 },
  { key: "caption", label: "Studio de Efectos", desc: "Captions, zoom y B-roll", icon: Wand2, ms: 150000 },
  { key: "copy", label: "Descripción e IG", desc: "Copy + hashtags", icon: Sparkles, ms: 15000 },
  { key: "review", label: "Revisión Manual", desc: "Tu aprobación", icon: Eye, ms: 0 },
  { key: "publish", label: "Publicar en IG", desc: "Reel en Instagram", icon: Send, ms: 120000 },
] as const

const baseItem: Item = {
  topic: "Cómo duplicar tus ventas con contenido corto en Instagram",
  status: "ready", scheduled_at: "2025-07-22T18:00:00Z",
  updated_at: new Date(Date.now() - 4 * 60 * 1000).toISOString(), video_id: "reel-001",
  caption: "El contenido corto es la forma más eficiente de llegar a nuevos clientes en 2025. En este video te explico exactamente cómo estructuro cada Reel para que convierta.",
  hashtags: "#instagram #reels #marketing #ventas #contenido #emprendimiento",
  caption_status: "done", copy_status: "done", video_status: null,
  video_effects: { zoom: true, ai_broll: false, text_cards: false },
}

const scenarios: Record<ScenarioKey, { label: string; mode: PipelineMode; item: Item }> = {
  awaiting_publish: { label: "En revisión · listo para publicar", mode: "awaiting_publish", item: baseItem },
  generating: { label: "Generando video con Avatar", mode: "generating", item: { ...baseItem, status: "generating", caption_status: null, copy_status: null, updated_at: new Date(Date.now() - 7 * 60 * 1000).toISOString() } },
  captioning: { label: "Aplicando captions", mode: "captioning", item: { ...baseItem, caption_status: "processing", copy_status: null, updated_at: new Date(Date.now() - 2 * 60 * 1000).toISOString() } },
  done: { label: "Último video publicado", mode: "done", item: { ...baseItem, status: "published", caption_status: "done", copy_status: "done" } },
}

function progress(item: Item) {
  if (item.status === "published") return { step: 5, percent: 100 }
  if (item.status === "generating") return { step: 1, percent: 50 }
  if (item.caption_status === "processing" || item.caption_status === null) return { step: 2, percent: 65 }
  if (item.copy_status === null || item.copy_status === "generating") return { step: 3, percent: 75 }
  if (item.video_status === "publishing") return { step: 5, percent: 92 }
  return { step: 4, percent: 83 }
}

function header(mode: PipelineMode) {
  return ({ generating: "Producción en curso", captioning: "Aplicando captions al video", copy_generating: "Generando descripción e IG copy", publishing: "Publicando en Instagram", awaiting_publish: "Video listo · revisa y aprueba para publicar", scripted_waiting: "Guion listo · el sistema generará el video", next: "Próximo video en cola", done: "Último video producido" })[mode]
}

function elapsed(stepKey: string, item: Item, mode: PipelineMode, now: number) {
  const active = mode === "generating" ? "video" : mode === "captioning" ? "caption" : mode === "copy_generating" ? "copy" : mode === "publishing" ? "publish" : ""
  const step = STEPS.find((s) => s.key === stepKey)
  if (!step || step.key !== active || !step.ms) return null
  const pct = Math.min(95, ((now - new Date(item.updated_at).getTime()) / step.ms) * 100)
  const seconds = Math.max(0, Math.round((step.ms - (now - new Date(item.updated_at).getTime())) / 1000))
  return { pct, text: seconds < 60 ? `~${seconds} seg` : `~${Math.ceil(seconds / 60)} min` }
}

function Tool({ icon: Icon, label, active, status }: { icon: typeof CaptionsIcon; label: string; active: boolean; status?: string }) {
  return <span className={`tool ${active ? "tool-on" : "tool-off"}`} title={`${label}: ${active ? "activo" : "apagado"}`}>
    <Icon size={12} aria-hidden="true" /> {label}{status ? ` · ${status}` : ""}
  </span>
}
const CaptionsIcon = Wand2

export function Redesigned() {
  const [scenario, setScenario] = useState<ScenarioKey>("awaiting_publish")
  const [reviewOpen, setReviewOpen] = useState(false)
  const [caption, setCaption] = useState(baseItem.caption ?? "")
  const [hashtags, setHashtags] = useState(baseItem.hashtags ?? "")
  const [saved, setSaved] = useState(false)
  const [now, setNow] = useState(Date.now)
  const reduceMotion = useReducedMotion()
  const { item, mode } = scenarios[scenario]
  const { step, percent } = progress(item)
  const manual = true
  const captionsEnabled = true
  const effects: Effects = { zoom: item.video_effects?.zoom === true, ai_broll: item.video_effects?.ai_broll === true, text_cards: false }
  const visible = useMemo(() => STEPS.filter((s) => s.key !== "caption" || captionsEnabled || effects.zoom || effects.ai_broll).filter((s) => s.key !== "review" || manual), [effects.ai_broll, effects.zoom])
  const activeKey = step === 0 ? "script" : step === 1 ? "video" : step === 2 ? "caption" : step === 3 ? "copy" : step >= 4 ? (manual ? "review" : "publish") : ""
  const activeIndex = visible.findIndex((s) => s.key === activeKey)
  const processing = ["generating", "captioning", "copy_generating", "publishing"].includes(mode)
  const awaiting = mode === "awaiting_publish"

  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 5000); return () => window.clearInterval(id) }, [])
  useEffect(() => { setCaption(item.caption ?? ""); setHashtags(item.hashtags ?? ""); setSaved(false) }, [item.caption, item.hashtags, scenario])

  return <section className="cp-shell" aria-label="Pipeline de producción de contenido">
    <div className="cp-orbit cp-orbit-a" aria-hidden="true" /><div className="cp-orbit cp-orbit-b" aria-hidden="true" />
    <header className="cp-header">
      <div className="cp-brand"><span className="cp-mark"><Sparkles size={17} /></span><div><p className="eyebrow">CONTENTPILOT / CONTROL ROOM</p><h1>Tu siguiente Reel, en movimiento.</h1></div></div>
      <div className="scenario-wrap"><label htmlFor="scenario">Escenario</label><select id="scenario" value={scenario} onChange={(e) => setScenario(e.target.value as ScenarioKey)}>{Object.entries(scenarios).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></div>
    </header>

    <div className="cp-status-row">
      <div className="live-status"><span className="live-dot" /> <strong>{header(mode)}</strong><span className="status-note">· motor creativo activo</span></div>
      <div className="status-meta"><span><Clock3 size={14} /> {item.scheduled_at ? new Date(item.scheduled_at).toLocaleDateString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Sin programación"}</span><strong className="percent">{percent}%</strong></div>
    </div>

    <div className="cp-progress" aria-label={`Progreso de producción: ${percent}%`} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><motion.div animate={{ width: `${percent}%` }} transition={{ duration: reduceMotion ? 0 : 1.1, ease: "easeOut" }} /></div>
    <div className="cp-topic"><span className="topic-kicker">TEMA EN PRODUCCIÓN</span><h2>{item.topic}</h2><span className="topic-id">REEL / 001 · actualizado hace {mode === "done" ? "un momento" : "4 min"}</span></div>

    <div className="timeline" role="list">
      {visible.map((s, index) => {
        const Icon = s.icon; const done = activeIndex > index || mode === "done"; const current = activeIndex === index && mode !== "done"; const review = s.key === "review" && current && awaiting; const tick = elapsed(s.key, item, mode, now)
        let label = done ? "Completado" : current ? "En espera..." : ({ video: "~5–15 min", script: "~1–3 min", caption: "~1–3 min", copy: "~10 seg" } as Record<string, string>)[s.key] ?? ""
        if (s.key === "video" && current) label = mode === "generating" ? tick?.text ?? "Renderizando..." : "En espera de la IA"
        if (s.key === "caption" && current) label = item.caption_status === "processing" ? tick?.text ?? "Procesando..." : "En cola..."
        if (s.key === "copy" && current) label = item.copy_status === "generating" ? tick?.text ?? "Generando..." : "En cola..."
        if (s.key === "review" && current) label = "Toca para revisar"
        if (s.key === "publish" && current) label = mode === "publishing" ? tick?.text ?? "Subiendo a Instagram..." : "Listo para publicar"
        return <motion.div key={s.key} role="listitem" className={`step-card ${done ? "is-done" : ""} ${current ? "is-current" : ""} ${review ? "is-review" : ""}`} initial={reduceMotion ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduceMotion ? 0 : index * .08, duration: .45 }} tabIndex={review ? 0 : undefined} onClick={review ? () => setReviewOpen(true) : undefined} onKeyDown={(e) => review && (e.key === "Enter" || e.key === " ") && setReviewOpen(true)}>
          <div className="step-top"><span className="step-icon">{done ? <Check size={16} /> : review ? <Play size={15} fill="currentColor" /> : processing && current ? <Loader2 size={16} className="spin" /> : <Icon size={16} />}</span><span className="step-number">0{index + 1}</span></div>
          <h3>{s.label}</h3><p>{s.desc}</p><div className="step-state">{label}</div>
          {s.key === "caption" && <div className="tools"><Tool icon={CaptionsIcon} label="Captions" active={captionsEnabled} status={item.caption_status === "done" ? "listos" : "procesando"} /><Tool icon={ZoomIn} label="Zoom" active={effects.zoom} /><Tool icon={ImageIcon} label="B-roll IA" active={effects.ai_broll} /></div>}
          {tick && <div className="mini-progress"><span style={{ width: `${tick.pct}%` }} /></div>}
        </motion.div>
      })}
    </div>

    <footer className="cp-footer"><div><span className="footer-label">AUTOMATIZACIÓN</span><span className="footer-value"><span className="pulse" /> Captions activos · revisión manual</span></div><div className="footer-trail"><span><CheckCircle2 size={14} /> {doneCount(activeIndex, visible.length)} pasos completados</span><span className="ig-chip"><Instagram size={14} /> destino: Instagram</span></div></footer>

    <AnimatePresence>{reviewOpen && <motion.div className="review-backdrop" role="dialog" aria-modal="true" aria-labelledby="review-title" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setReviewOpen(false)}>
      <motion.div className="review-modal" initial={{ opacity: 0, y: 20, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20 }} onClick={(e) => e.stopPropagation()}>
        <div className="preview-pane"><div className="preview-grid" /><Play size={29} fill="currentColor" /><span>Vista previa del Reel</span><b>00:32</b></div>
        <div className="review-content"><button className="close-review" onClick={() => setReviewOpen(false)} aria-label="Cerrar revisión">×</button><span className="eyebrow">REVISIÓN MANUAL / 05</span><h2 id="review-title">{item.topic}</h2><p className="review-helper">Revisa el video y ajusta el copy antes de enviarlo a Instagram.</p><label>Caption para Instagram<textarea value={caption} onChange={(e) => { setCaption(e.target.value); setSaved(false) }} /></label><label>Hashtags<textarea className="hash" value={hashtags} onChange={(e) => { setHashtags(e.target.value); setSaved(false) }} /></label><div className="review-actions"><button className="secondary-btn" onClick={() => { setCaption(item.caption ?? ""); setHashtags(item.hashtags ?? ""); setSaved(false) }}>Descartar cambios</button><button className="primary-btn" onClick={() => setSaved(true)}>{saved ? <><Check size={15} /> Cambios guardados</> : <><Instagram size={15} /> Aprobar y publicar</>}</button></div></div>
      </motion.div>
    </motion.div>}</AnimatePresence>
    <style>{styles}</style>
  </section>
}

function doneCount(activeIndex: number, total: number) { return `${Math.max(0, activeIndex < 0 ? total : activeIndex)}/${total}` }

const styles = `
.cp-shell{--ink:#172031;--muted:#697387;--line:#dde4ee;--coral:#f06459;--coral-dark:#c8494d;--violet:#6656c8;--cream:#fbfaf7;position:relative;overflow:hidden;max-width:1180px;margin:24px auto;padding:34px 38px 22px;color:var(--ink);background:linear-gradient(135deg,#fffefa 0%,#f7f8fb 58%,#f2effa 100%);border:1px solid #e4e7ed;border-radius:27px;box-shadow:0 24px 70px rgba(50,49,80,.12);font-family:var(--app-font-sans,Plus Jakarta Sans,sans-serif)}.cp-shell:before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.45;background-image:radial-gradient(#d9dce5 .7px,transparent .7px);background-size:17px 17px;mask-image:linear-gradient(135deg,black,transparent 68%)}.cp-shell>*{position:relative}.cp-orbit{position:absolute!important;border:1px solid rgba(240,100,89,.17);border-radius:50%;pointer-events:none}.cp-orbit-a{width:500px;height:500px;right:-250px;top:-300px}.cp-orbit-b{width:280px;height:280px;right:-122px;top:-190px;border-color:rgba(102,86,200,.16)}.cp-header{display:flex;justify-content:space-between;gap:28px;align-items:flex-start}.cp-brand{display:flex;gap:13px;align-items:flex-start}.cp-mark{display:grid;place-items:center;width:36px;height:36px;border-radius:12px;color:#fff;background:var(--coral);box-shadow:0 7px 16px rgba(240,100,89,.28)}.eyebrow,.topic-kicker,.footer-label{font-size:10px;letter-spacing:.16em;font-weight:800;color:var(--coral-dark)}.cp-header h1{font-family:var(--app-font-display,Outfit,sans-serif);font-size:clamp(22px,3vw,32px);line-height:1.06;letter-spacing:-.035em;margin:5px 0 0}.scenario-wrap{display:flex;align-items:center;gap:9px;color:var(--muted);font-size:11px;font-weight:700}.scenario-wrap select{appearance:none;border:1px solid var(--line);border-radius:10px;background:#fff;padding:9px 29px 9px 11px;color:var(--ink);font:inherit;outline:none}.scenario-wrap select:focus{box-shadow:0 0 0 3px rgba(240,100,89,.18);border-color:var(--coral)}.cp-status-row{display:flex;justify-content:space-between;align-items:center;margin:37px 0 14px}.live-status{display:flex;align-items:center;gap:8px;font-size:13px}.live-dot,.pulse{width:7px;height:7px;border-radius:50%;background:#31ad82;box-shadow:0 0 0 4px rgba(49,173,130,.12)}.live-dot{animation:breath 2.2s ease-in-out infinite}.status-note{font-size:11px;color:var(--muted)}.status-meta{display:flex;align-items:center;gap:20px;color:var(--muted);font-size:11px}.status-meta span{display:flex;gap:5px;align-items:center}.percent{font-family:var(--app-font-display,Outfit,sans-serif);font-size:26px;color:var(--coral-dark)}.cp-progress{height:8px;border-radius:9px;background:#e7e9ef;overflow:hidden}.cp-progress>div{height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--coral),#f59a62 52%,var(--violet));box-shadow:0 2px 8px rgba(240,100,89,.25)}.cp-topic{padding:24px 0 27px;border-bottom:1px solid var(--line)}.topic-kicker{color:var(--muted);font-size:9px}.cp-topic h2{font-family:var(--app-font-display,Outfit,sans-serif);font-size:clamp(18px,2.7vw,27px);line-height:1.15;letter-spacing:-.025em;max-width:720px;margin:7px 0 10px}.topic-id{font-family:ui-monospace,SFMono-Regular,monospace;font-size:9px;letter-spacing:.09em;color:#8b94a4}.timeline{display:grid;grid-template-columns:repeat(6,1fr);gap:9px;padding:27px 0 31px}.step-card{position:relative;min-height:152px;padding:15px 14px 13px;border:1px solid transparent;border-radius:16px;background:rgba(238,241,246,.7);transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease,background .2s ease;outline:none}.step-card:hover{transform:translateY(-4px);box-shadow:0 12px 23px rgba(42,50,74,.1)}.step-card:focus-visible{box-shadow:0 0 0 3px rgba(240,100,89,.26)}.step-card.is-done{background:rgba(226,246,239,.72);border-color:#bde5d3}.step-card.is-current{background:#fff;border-color:#f1b2a8;box-shadow:0 8px 24px rgba(240,100,89,.1)}.step-card.is-review{cursor:pointer;background:linear-gradient(145deg,#6656c8,#5142a5);border-color:#6656c8;color:white;box-shadow:0 13px 26px rgba(82,66,165,.25)}.step-card.is-review:hover{box-shadow:0 16px 31px rgba(82,66,165,.36)}.step-top{display:flex;align-items:center;justify-content:space-between}.step-icon{display:grid;place-items:center;width:29px;height:29px;border-radius:9px;background:#fff;color:var(--muted);border:1px solid var(--line)}.is-done .step-icon{background:#d2f1e3;border-color:#b9e8d1;color:#218663}.is-current .step-icon{color:var(--coral-dark);border-color:#f4c8c0}.is-review .step-icon{background:rgba(255,255,255,.18);color:#fff;border-color:rgba(255,255,255,.3)}.step-number{font:700 10px ui-monospace,monospace;color:#a2aaba}.is-review .step-number{color:#d8d1ff}.step-card h3{font-family:var(--app-font-display,Outfit,sans-serif);font-size:13px;letter-spacing:-.01em;margin:15px 0 4px;line-height:1.1}.step-card p{font-size:10px;color:var(--muted);line-height:1.3;margin:0}.is-review p,.is-review .step-state{color:#dcd7ff}.step-state{font-size:10px;font-weight:700;color:#8b94a4;margin-top:17px}.is-done .step-state{color:#27916c}.is-current .step-state{color:var(--coral-dark)}.tools{display:flex;flex-wrap:wrap;gap:4px;margin-top:11px}.tool{display:flex;align-items:center;gap:3px;padding:4px 5px;border-radius:6px;font-size:8px;font-weight:700;border:1px solid}.tool-on{background:#e4f7ee;border-color:#b8e5d1;color:#268361}.tool-off{background:#f3f4f6;border-color:#e2e4e9;color:#9ba3b1}.mini-progress{height:4px;background:#f0ddda;border-radius:8px;overflow:hidden;margin-top:10px}.mini-progress span{display:block;height:100%;background:var(--coral);border-radius:inherit}.cp-footer{display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding-top:17px}.footer-label{display:block;color:var(--muted);font-size:8px;margin-bottom:7px}.footer-value,.footer-trail{display:flex;align-items:center;gap:8px;font-size:10px;font-weight:700}.pulse{display:inline-block}.footer-trail{gap:20px;color:var(--muted)}.footer-trail span{display:flex;align-items:center;gap:5px}.ig-chip{color:#b04e5e}.spin{animation:spin 1s linear infinite}.review-backdrop{position:fixed;inset:0;z-index:20;display:grid;place-items:center;padding:18px;background:rgba(28,30,47,.52);backdrop-filter:blur(8px)}.review-modal{display:grid;grid-template-columns:230px minmax(280px,460px);width:min(700px,100%);overflow:hidden;border-radius:20px;background:#fff;box-shadow:0 25px 70px rgba(21,26,53,.28)}.preview-pane{position:relative;min-height:420px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:rgba(255,255,255,.68);background:linear-gradient(145deg,#252c47,#44365e 52%,#c85a57)}.preview-pane b{font:700 11px ui-monospace,monospace;color:#fff}.preview-grid{position:absolute;inset:0;opacity:.3;background:linear-gradient(135deg,transparent 44%,rgba(255,255,255,.3) 45%,transparent 46%),linear-gradient(45deg,transparent 58%,rgba(255,255,255,.2) 59%,transparent 60%);background-size:90px 90px}.preview-pane>*{position:relative}.review-content{position:relative;padding:28px}.close-review{position:absolute;top:14px;right:16px;border:0;background:none;font-size:25px;color:#8991a0;cursor:pointer}.review-content h2{font-family:var(--app-font-display,Outfit,sans-serif);font-size:22px;line-height:1.1;margin:9px 25px 7px 0}.review-helper{font-size:11px;color:var(--muted);line-height:1.5;margin:0 0 23px}.review-content label{display:block;font-size:10px;font-weight:800;color:#70798b;text-transform:uppercase;letter-spacing:.08em;margin-top:13px}.review-content textarea{display:block;width:100%;resize:vertical;min-height:82px;margin-top:7px;padding:10px;border:1px solid var(--line);border-radius:9px;color:var(--ink);font:12px/1.45 var(--app-font-sans, sans-serif);outline:none}.review-content textarea:focus{border-color:var(--coral);box-shadow:0 0 0 3px rgba(240,100,89,.14)}.review-content textarea.hash{min-height:54px;color:#6656c8}.review-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:20px}.review-actions button{display:flex;align-items:center;gap:6px;border:0;border-radius:9px;padding:10px 13px;font:700 10px var(--app-font-sans,sans-serif);cursor:pointer}.secondary-btn{background:#f1f2f5;color:#626b7e}.primary-btn{background:var(--coral-dark);color:#fff}.primary-btn:hover{background:#aa3e45}.secondary-btn:focus-visible,.primary-btn:focus-visible,.close-review:focus-visible{outline:3px solid rgba(240,100,89,.3);outline-offset:2px}@keyframes spin{to{transform:rotate(360deg)}}@keyframes breath{50%{box-shadow:0 0 0 7px rgba(49,173,130,0)}}@media(max-width:900px){.cp-shell{margin:14px;padding:24px}.timeline{grid-template-columns:repeat(3,1fr)}.step-card{min-height:145px}}@media(max-width:620px){.cp-shell{padding:20px 16px;border-radius:20px}.cp-header{display:block}.scenario-wrap{margin-top:17px}.scenario-wrap select{flex:1}.cp-status-row{align-items:flex-start;gap:12px;flex-direction:column;margin-top:28px}.status-note{display:none}.status-meta{width:100%;justify-content:space-between}.timeline{grid-template-columns:repeat(2,1fr);gap:7px;padding:20px 0}.step-card{min-height:137px;padding:12px 11px}.step-card h3{font-size:12px}.step-card p{font-size:9px}.step-state{margin-top:13px}.tools{gap:3px}.tool{font-size:7px;padding:3px}.cp-footer{display:block}.footer-trail{margin-top:14px;justify-content:space-between}.review-modal{display:block;max-height:90vh;overflow:auto}.preview-pane{min-height:160px}.review-content{padding:24px 20px}.review-actions{flex-wrap:wrap}.review-actions button{flex:1;justify-content:center}.footer-trail{font-size:9px}}@media(prefers-reduced-motion:reduce){.cp-shell *,.cp-shell *:before,.cp-shell *:after{animation-duration:.01ms!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
`