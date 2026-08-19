/**
 * CloneWavespeedVoiceDialog — standalone dialog for recording and submitting a
 * WaveSpeed voice clone.  Extracted from CreateWavespeedAvatarDialog so it can
 * be opened from the Voces tab independently of the avatar creation wizard.
 *
 * Flow: instructions → single guided recording (20-30 s) → quality check → submit
 */

import { useState, useRef, useEffect, useCallback } from "react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import {
  Mic, Square, Loader2, CheckCircle2, RefreshCw, AlertCircle, Copy, Check,
} from "lucide-react"
import { useCloneWavespeedVoice } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"

// ── Audio quality analysis ────────────────────────────────────────────────────

type AudioIssue = { level: "error" | "warning"; message: string }
type AudioQualityResult = {
  duration: number
  rmsDb: number
  issues: AudioIssue[]
  hasBlocker: boolean
}

async function analyzeAudioBlob(blob: Blob): Promise<AudioQualityResult> {
  const ctx = new AudioContext()
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
    const ch = decoded.getChannelData(0)
    const n = ch.length
    const duration = decoded.duration
    let sumSq = 0, clipped = 0, silent = 0
    for (let i = 0; i < n; i++) {
      const s = Math.abs(ch[i])
      sumSq += s * s
      if (s > 0.98) clipped++
      if (s < 0.005) silent++
    }
    const rms = Math.sqrt(sumSq / n)
    const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -100
    const clippingRatio = clipped / n
    const silenceRatio = silent / n
    const issues: AudioIssue[] = []
    // Minimum 20 s — matches the ~25-30 s guided text
    if (duration < 20) issues.push({ level: "error", message: "Mínimo 20 segundos de grabación" })
    if (rmsDb < -42) issues.push({ level: "error", message: "Señal demasiado débil — revisá el micrófono" })
    else if (rmsDb < -32) issues.push({ level: "warning", message: "Audio bajo — grabá más cerca del micrófono" })
    if (silenceRatio > 0.80) issues.push({ level: "error", message: "Más del 80 % es silencio" })
    if (clippingRatio > 0.002) issues.push({ level: "warning", message: "Distorsión detectada" })
    return { duration, rmsDb, issues, hasBlocker: issues.some(i => i.level === "error") }
  } finally {
    ctx.close()
  }
}

// ── Guided sample text (~25-30 s at natural pace) ─────────────────────────────
//
// Designed to capture four natural tonal registers in a single reading:
//   • Apertura cálida  → calma y cercanía
//   • Declaración directa → energía y claridad
//   • Reflexión pausada  → seriedad y profundidad
//   • Cierre motivador  → confianza y convicción

const GUIDED_TEXT =
  "Hola, me alegra que estés aquí. Lo que quiero compartir contigo es esto: " +
  "el momento de actuar es ahora. No mañana — ahora. " +
  "Cuando tomas decisiones con claridad, los resultados llegan. " +
  "He visto esto pasar una y otra vez. " +
  "La confianza no se espera, se construye. " +
  "Y tú tienes todo lo necesario para empezar. " +
  "Así que vamos — demos ese primer paso juntos."

// Scroll duration calibrated to ~30 s reading + small buffer
const SCROLL_DURATION_MS = 42_000

const fmtSec = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`

// ── Recording tips ─────────────────────────────────────────────────────────────

const TIPS = [
  { emoji: "🔇", text: "Silencio total — cierra ventanas, apaga música y TV" },
  { emoji: "🎙️", text: "Habla directo al micrófono, a unos 15-20 cm de distancia" },
  { emoji: "🗣️", text: "Varía el tono — no leas plano, como si hablaras con un cliente real" },
  { emoji: "⏸️", text: "Haz pausas naturales entre ideas; no hay que correr" },
]

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onClose: () => void
  onCloned: () => void
}

export function CloneWavespeedVoiceDialog({ open, onClose, onCloned }: Props) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const cloneVoice = useCloneWavespeedVoice()

  // Form
  const [voiceName, setVoiceName] = useState("Mi voz")

  // Recording
  const [isRecording, setIsRecording]     = useState(false)
  const [recordedBlob, setRecordedBlob]   = useState<Blob | null>(null)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [reached20s, setReached20s]       = useState(false)
  const [audioQuality, setAudioQuality]   = useState<AudioQualityResult | null>(null)
  const [analyzingAudio, setAnalyzingAudio] = useState(false)
  const [textCopied, setTextCopied]       = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef   = useRef<BlobPart[]>([])
  const recordTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioStreamRef   = useRef<MediaStream | null>(null)
  const teleprompterRef  = useRef<HTMLDivElement>(null)
  const scrollRafRef     = useRef<number | null>(null)
  const scrollStartRef   = useRef<number>(0)

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setVoiceName("Mi voz")
      setIsRecording(false)
      setRecordedBlob(null)
      setRecordSeconds(0)
      setReached20s(false)
      setAudioQuality(null)
      setAnalyzingAudio(false)
      setTextCopied(false)
      if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null }
      mediaRecorderRef.current?.stop()
      audioStreamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [open])

  // Beep at 20 s
  const playBeep = useCallback(() => {
    try {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.4, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
      osc.start(); osc.stop(ctx.currentTime + 0.4)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (recordSeconds === 20 && isRecording && !reached20s) {
      setReached20s(true)
      playBeep()
    }
  }, [recordSeconds, isRecording, reached20s, playBeep])

  // Auto-scroll teleprompter during recording
  useEffect(() => {
    const el = teleprompterRef.current
    if (!el) return
    if (!isRecording) {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current)
      return
    }
    el.scrollTop = 0
    scrollStartRef.current = performance.now()
    const totalHeight = el.scrollHeight - el.clientHeight
    const tick = (now: number) => {
      const fraction = Math.min((now - scrollStartRef.current) / SCROLL_DURATION_MS, 1)
      el.scrollTop = totalHeight * fraction
      if (fraction < 1) scrollRafRef.current = requestAnimationFrame(tick)
    }
    scrollRafRef.current = requestAnimationFrame(tick)
    return () => { if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current) }
  }, [isRecording])

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioStreamRef.current = stream
      audioChunksRef.current = []
      const mr = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
        audioBitsPerSecond: 128000,
      })
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      mr.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: mr.mimeType })
        setRecordedBlob(blob)
        setAnalyzingAudio(true)
        try { setAudioQuality(await analyzeAudioBlob(blob)) } catch { /* ignore */ }
        setAnalyzingAudio(false)
        audioStreamRef.current?.getTracks().forEach(t => t.stop())
        audioStreamRef.current = null
      }
      mr.start(500)
      mediaRecorderRef.current = mr
      setIsRecording(true)
      setRecordSeconds(0)
      setReached20s(false)
      recordTimerRef.current = setInterval(() => setRecordSeconds(s => s + 1), 1000)
    } catch {
      toast({ title: "No se pudo acceder al micrófono", variant: "destructive" })
    }
  }

  const stopRecording = () => {
    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null }
    mediaRecorderRef.current?.stop()
    mediaRecorderRef.current = null
    setIsRecording(false)
  }

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(GUIDED_TEXT)
      setTextCopied(true)
      setTimeout(() => setTextCopied(false), 2000)
    } catch {
      toast({ title: "No se pudo copiar", description: "Selecciona el texto manualmente", variant: "destructive" })
    }
  }

  const handleSubmit = async () => {
    if (!recordedBlob || !voiceName.trim()) return
    const fd = new FormData()
    fd.append("audio", recordedBlob, "voice.webm")
    fd.append("name", voiceName.trim())
    // Metadata — logged by backend for future Voice Director routing (no migration needed)
    fd.append("sampleType", "guided_dynamic_sample")
    try {
      await cloneVoice.mutateAsync(fd)
      queryClient.invalidateQueries({ queryKey: ["wavespeed", "voices"] })
      toast({ title: "¡Voz enviada!", description: "Tu voz está siendo procesada. Te avisamos cuando esté lista." })
      onCloned()
    } catch {
      toast({ title: "Error al clonar la voz", description: "No se pudo iniciar la clonación de voz. Intenta de nuevo.", variant: "destructive" })
    }
  }

  const canSubmit = !!recordedBlob && !!voiceName.trim() && !analyzingAudio && !(audioQuality?.hasBlocker)

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !cloneVoice.isPending) onClose() }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="w-5 h-5 text-violet-500" />
            Clonar mi voz
          </DialogTitle>
          <DialogDescription>
            Solo necesitas <strong>una grabación</strong> — lee el texto guiado en 20-30 segundos,
            con variedad de tono natural, y el AI capturará tu voz completa.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">

          {/* Voice name */}
          <div>
            <Label>Nombre de la voz</Label>
            <Input
              className="mt-1.5"
              placeholder="Ej: Mi voz"
              value={voiceName}
              onChange={e => setVoiceName(e.target.value)}
              disabled={isRecording || cloneVoice.isPending}
            />
          </div>

          {/* Tips — visible before and after recording, hidden during */}
          {!isRecording && !recordedBlob && (
            <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Antes de grabar
              </p>
              {TIPS.map(tip => (
                <p key={tip.text} className="text-xs text-muted-foreground flex items-start gap-2 leading-snug">
                  <span className="shrink-0">{tip.emoji}</span>
                  <span>{tip.text}</span>
                </p>
              ))}
            </div>
          )}

          {/* Guided text with copy button */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Texto guiado — leé en voz alta
              </p>
              <Button
                size="sm" variant="ghost"
                className="h-6 px-2 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
                onClick={handleCopyText}
                type="button"
              >
                {textCopied
                  ? <><Check className="w-3 h-3 text-emerald-500" /> Copiado</>
                  : <><Copy className="w-3 h-3" /> Copiar texto</>
                }
              </Button>
            </div>
            <div
              ref={teleprompterRef}
              className="rounded-lg border bg-muted/40 px-4 py-3 max-h-44 overflow-hidden cursor-default"
            >
              <p className="text-sm text-foreground leading-relaxed font-medium">
                {GUIDED_TEXT}
              </p>
              <p className="text-[10px] text-muted-foreground mt-2 italic">
                ≈ 25-30 segundos al ritmo natural de habla
              </p>
            </div>
            {!isRecording && !recordedBlob && (
              <p className="text-[10px] text-muted-foreground">
                💡 Al empezar a grabar, el texto comenzará a desplazarse automáticamente.
              </p>
            )}
          </div>

          {/* Recording controls */}
          <div className="flex flex-col items-center gap-3">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors
              ${isRecording && reached20s
                ? "bg-emerald-500/15 border-2 border-emerald-500"
                : isRecording
                  ? "bg-red-500/15 border-2 border-red-500 animate-pulse"
                  : recordedBlob
                    ? "bg-emerald-500/10 border-2 border-emerald-500/50"
                    : "bg-muted"}`}>
              <Mic className={`w-7 h-7 ${
                isRecording
                  ? (reached20s ? "text-emerald-500" : "text-red-500")
                  : recordedBlob
                    ? "text-emerald-500"
                    : "text-muted-foreground"
              }`} />
            </div>

            {isRecording && (
              <div className="text-center">
                <span className={`font-mono text-2xl font-bold tabular-nums transition-colors
                  ${reached20s ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                  {fmtSec(recordSeconds)}
                </span>
                {reached20s ? (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-0.5 flex items-center justify-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> ¡Listo! Detén cuando termines el texto
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Grabando… ({20 - recordSeconds}s restantes para el mínimo)
                  </p>
                )}
              </div>
            )}

            {recordedBlob && !isRecording && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Grabación lista — {Math.round(audioQuality?.duration ?? 0)}s
              </p>
            )}

            <div className="flex gap-2">
              {isRecording ? (
                <Button
                  onClick={stopRecording}
                  variant={reached20s ? "default" : "destructive"}
                  className={`gap-2 ${reached20s ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}`}
                >
                  <Square className="w-4 h-4" /> Detener
                </Button>
              ) : (
                <Button
                  onClick={startRecording}
                  disabled={!!recordedBlob || cloneVoice.isPending}
                  className="gap-2"
                >
                  <Mic className="w-4 h-4" />
                  {recordedBlob ? "Grabado ✓" : "Comenzar grabación"}
                </Button>
              )}
              {recordedBlob && !isRecording && (
                <Button
                  variant="outline" size="icon" title="Volver a grabar"
                  onClick={() => { setRecordedBlob(null); setAudioQuality(null); setRecordSeconds(0); setReached20s(false) }}
                  disabled={cloneVoice.isPending}
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Audio quality */}
          {analyzingAudio && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" /> Analizando audio…
            </div>
          )}
          {audioQuality && !analyzingAudio && (
            <div className={`rounded-lg border px-3 py-2.5 space-y-1 text-xs
              ${audioQuality.hasBlocker
                ? "border-destructive/40 bg-destructive/5"
                : "border-emerald-400/40 bg-emerald-50 dark:bg-emerald-950/20"}`}>
              <p className="font-semibold flex items-center gap-1">
                {audioQuality.hasBlocker
                  ? <><AlertCircle className="w-3.5 h-3.5 text-destructive" /> Problemas detectados</>
                  : <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Audio listo ({Math.round(audioQuality.duration)}s)</>}
              </p>
              {audioQuality.issues.map((iss, i) => (
                <p key={i} className={`flex items-center gap-1.5
                  ${iss.level === "error" ? "text-destructive" : "text-amber-600 dark:text-amber-400"}`}>
                  <AlertCircle className="w-3 h-3 shrink-0" /> {iss.message}
                </p>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={cloneVoice.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || cloneVoice.isPending} className="gap-2">
            {cloneVoice.isPending
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Enviando…</>
              : <><Mic className="w-3.5 h-3.5" /> Clonar voz</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
