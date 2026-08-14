/**
 * CloneWavespeedVoiceDialog — standalone dialog for recording and submitting a
 * WaveSpeed voice clone.  Extracted from CreateWavespeedAvatarDialog so it can
 * be opened from the Voces tab independently of the avatar creation wizard.
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
  Mic, Square, Loader2, CheckCircle2, RefreshCw, AlertCircle,
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
    if (duration < 30) issues.push({ level: "error", message: "Mínimo 30 segundos de grabación" })
    if (rmsDb < -42) issues.push({ level: "error", message: "Señal demasiado débil — revisá el micrófono" })
    else if (rmsDb < -32) issues.push({ level: "warning", message: "Audio bajo — grabá más cerca del micrófono" })
    if (silenceRatio > 0.80) issues.push({ level: "error", message: "Más del 80 % es silencio" })
    if (clippingRatio > 0.002) issues.push({ level: "warning", message: "Distorsión detectada" })
    return { duration, rmsDb, issues, hasBlocker: issues.some(i => i.level === "error") }
  } finally {
    ctx.close()
  }
}

// ── Teleprompter text ─────────────────────────────────────────────────────────

const TELEPROMPTER = `Hola, bienvenido. Hoy quiero compartir contigo algo que puede marcar una diferencia real en tu vida. A lo largo del tiempo he aprendido que el éxito no llega por casualidad. Llega cuando tomamos decisiones conscientes y actuamos con determinación, día tras día. Cada mañana es una oportunidad para mejorar, para aprender algo nuevo, para dar un paso más hacia donde queremos estar. No importa cuál sea tu punto de partida. Lo que importa es la dirección en la que caminas y la constancia con la que avanzas. El progreso sostenido, aunque parezca pequeño, es lo que genera resultados extraordinarios con el tiempo. Los grandes logros no son el resultado de un solo momento brillante, sino de muchas acciones pequeñas y consistentes acumuladas. Así que sigue adelante. Confía en el proceso, celebra cada avance, y recuerda que cada paso cuenta. Estoy aquí para acompañarte en ese camino.`

const fmtSec = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`

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
  const [isRecording, setIsRecording] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [reached30s, setReached30s] = useState(false)
  const [audioQuality, setAudioQuality] = useState<AudioQualityResult | null>(null)
  const [analyzingAudio, setAnalyzingAudio] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<BlobPart[]>([])
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioStreamRef = useRef<MediaStream | null>(null)
  const teleprompterRef = useRef<HTMLDivElement>(null)
  const scrollRafRef = useRef<number | null>(null)
  const scrollStartRef = useRef<number>(0)

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setVoiceName("Mi voz")
      setIsRecording(false)
      setRecordedBlob(null)
      setRecordSeconds(0)
      setReached30s(false)
      setAudioQuality(null)
      setAnalyzingAudio(false)
      if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null }
      mediaRecorderRef.current?.stop()
      audioStreamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [open])

  // Beep at 30 s
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
    if (recordSeconds === 30 && isRecording && !reached30s) {
      setReached30s(true)
      playBeep()
    }
  }, [recordSeconds, isRecording, reached30s, playBeep])

  // Auto-scroll teleprompter
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
    const DURATION_MS = 65_000
    const tick = (now: number) => {
      const fraction = Math.min((now - scrollStartRef.current) / DURATION_MS, 1)
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
      setReached30s(false)
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

  const handleSubmit = async () => {
    if (!recordedBlob || !voiceName.trim()) return
    const fd = new FormData()
    fd.append("audio", recordedBlob, "voice.webm")
    fd.append("name", voiceName.trim())
    try {
      await cloneVoice.mutateAsync(fd)
      queryClient.invalidateQueries({ queryKey: ["wavespeed", "voices"] })
      toast({ title: "¡Voz enviada!", description: "Tu voz está siendo procesada. Te avisamos cuando esté lista." })
      onCloned()
    } catch (err: any) {
      toast({ title: "Error al clonar la voz", description: err.message, variant: "destructive" })
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
            Graba al menos 30 segundos leyendo el texto en voz alta. Habla de manera natural y clara.
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

          {/* Teleprompter */}
          <div
            ref={teleprompterRef}
            className="rounded-lg border bg-muted/40 px-4 py-3 max-h-28 overflow-hidden select-none"
          >
            <p className="text-xs text-muted-foreground leading-relaxed">{TELEPROMPTER}</p>
          </div>

          {/* Requirements */}
          <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Requisitos</p>
            {[
              "Mínimo 30 segundos de voz continua",
              "Sin música ni ruido de fondo",
              "Habla directo al micrófono",
            ].map(r => (
              <p key={r} className="text-xs text-muted-foreground flex items-center gap-1.5">
                <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" /> {r}
              </p>
            ))}
          </div>

          {/* Recording controls */}
          <div className="flex flex-col items-center gap-3">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors
              ${isRecording && reached30s
                ? "bg-emerald-500/15 border-2 border-emerald-500"
                : isRecording
                  ? "bg-red-500/15 border-2 border-red-500 animate-pulse"
                  : "bg-muted"}`}>
              <Mic className={`w-7 h-7 ${isRecording
                ? (reached30s ? "text-emerald-500" : "text-red-500")
                : "text-muted-foreground"}`} />
            </div>

            {isRecording && (
              <div className="text-center">
                <span className={`font-mono text-2xl font-bold tabular-nums transition-colors
                  ${reached30s ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                  {fmtSec(recordSeconds)}
                </span>
                {reached30s ? (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-0.5 flex items-center justify-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> ¡Listo! Detén cuando quieras
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Grabando… ({30 - recordSeconds}s restantes para el mínimo)
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              {isRecording ? (
                <Button
                  onClick={stopRecording}
                  variant={reached30s ? "default" : "destructive"}
                  className={`gap-2 ${reached30s ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}`}
                >
                  <Square className="w-4 h-4" /> Detener
                </Button>
              ) : (
                <Button onClick={startRecording} disabled={!!recordedBlob || cloneVoice.isPending} className="gap-2">
                  <Mic className="w-4 h-4" /> {recordedBlob ? "Grabado ✓" : "Grabar"}
                </Button>
              )}
              {recordedBlob && !isRecording && (
                <Button
                  variant="outline" size="icon" title="Volver a grabar"
                  onClick={() => { setRecordedBlob(null); setAudioQuality(null); setRecordSeconds(0); setReached30s(false) }}
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
