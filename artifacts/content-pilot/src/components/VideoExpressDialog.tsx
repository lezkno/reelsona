import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { useQueryClient } from "@tanstack/react-query"
import { useVideoExpress, getGetContentPlanQueryKey } from "@workspace/api-client-react"
import { Mic, Square, Upload, RotateCcw, Loader2, Zap, CheckCircle2 } from "lucide-react"
import {
  exceedsVideoExpressAudioLimit,
  getVideoExpressElapsedSeconds,
  MAX_VIDEO_EXPRESS_ORDER_SECONDS,
} from "@/lib/video-express-audio"

/**
 * Video Express: record (or upload) a spoken order — "créame un video sobre X
 * con este CTA…" — and let the AI create + generate the video automatically.
 */
export function VideoExpressDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const videoExpress = useVideoExpress()

  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [audioDurationSeconds, setAudioDurationSeconds] = useState<number | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [result, setResult] = useState<{ topic: string; status: "generating" | "queued"; warning: string | null } | null>(null)

  const mediaRecRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recordingStartedAtRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const cleanupStream = () => {
    mediaRecRef.current?.stream.getTracks().forEach((t) => t.stop())
    mediaRecRef.current = null
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    recordingStartedAtRef.current = null
  }

  const resetAudio = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioBlob(null); setAudioUrl(null); setAudioDurationSeconds(null); setFileName(null); setSeconds(0); setResult(null)
  }

  // Full reset when the dialog closes
  useEffect(() => {
    if (!open) {
      if (recording) { mediaRecRef.current?.stop() }
      cleanupStream()
      setRecording(false)
      resetAudio()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      chunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" })
        setAudioBlob(blob)
        setAudioUrl(URL.createObjectURL(blob))
        setRecording(false)
        cleanupStream()
      }
      mediaRecRef.current = mr
      resetAudio()
      mr.start()
      setRecording(true)
      setSeconds(0)
      const startedAt = Date.now()
      recordingStartedAtRef.current = startedAt
      timerRef.current = setInterval(() => {
        const elapsedSeconds = (Date.now() - startedAt) / 1000
        setSeconds(getVideoExpressElapsedSeconds(startedAt))
        if (elapsedSeconds >= MAX_VIDEO_EXPRESS_ORDER_SECONDS) {
          const recorder = mediaRecRef.current
          if (recorder?.state === "recording") recorder.stop()
          if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
        }
      }, 250)
    } catch {
      toast({ title: "Micrófono no disponible", description: "Permite el acceso al micrófono o sube un archivo de audio.", variant: "destructive" })
    }
  }

  const stopRecording = () => {
    const startedAt = recordingStartedAtRef.current
    if (startedAt !== null) setSeconds(getVideoExpressElapsedSeconds(startedAt))
    if (mediaRecRef.current?.state === "recording") mediaRecRef.current.stop()
    setRecording(false)
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }

  const handleFile = (f: File | undefined) => {
    if (!f) return
    if (!f.type.startsWith("audio/")) {
      toast({ title: "Formato no válido", description: "Sube un archivo de audio (MP3, WAV, M4A…).", variant: "destructive" })
      return
    }
    if (f.size > 16 * 1024 * 1024) {
      toast({ title: "Archivo demasiado grande", description: "El audio no puede superar 16 MB.", variant: "destructive" })
      return
    }
    resetAudio()
    setAudioBlob(f)
    setAudioUrl(URL.createObjectURL(f))
    setFileName(f.name)
  }

  const handleSend = () => {
    if (!audioBlob) return
    if (exceedsVideoExpressAudioLimit(audioDurationSeconds)) {
      toast({ title: "Audio demasiado largo", description: `La orden no puede superar ${MAX_VIDEO_EXPRESS_ORDER_SECONDS} segundos. Recórtala y vuelve a intentarlo.`, variant: "destructive" })
      return
    }
    const fd = new FormData()
    const name = fileName ?? "orden.webm"
    fd.append("audio", audioBlob, name)
    videoExpress.mutate(fd, {
      onSuccess: (data) => {
        setResult({ topic: data.detected.topic, status: data.status, warning: data.warning })
        queryClient.invalidateQueries({ queryKey: getGetContentPlanQueryKey() })
      },
      onError: (err: any) => {
        toast({
          title: "No se pudo procesar la orden",
          description: err?.data?.error ?? err?.message ?? "Inténtalo de nuevo.",
          variant: "destructive",
        })
      },
    })
  }

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!videoExpress.isPending) onOpenChange(v) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Zap className="w-5 h-5 text-primary" /> Video Express</DialogTitle>
          <DialogDescription>
            Di qué video quieres — tema, CTA, duración, tono… — y la IA lo crea y lo genera por ti.
            Tu voz solo se usa como instrucción, nunca aparece en el video.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3 rounded-lg border border-green-500/30 bg-green-500/10 p-4">
              <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
              <div className="space-y-1 text-sm">
                <p className="font-medium">Guion creado: {result.topic}</p>
                <p className="text-muted-foreground">
                  {result.status === "generating"
                    ? "El video ya se está generando. Lo verás en tu plan y en Videos en unos minutos."
                    : result.warning ?? "El guion quedó en tu plan, listo para generar."}
                </p>
              </div>
            </div>
            <Button className="w-full" onClick={() => onOpenChange(false)}>Entendido</Button>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {/* Recorder */}
            <div className="flex flex-col items-center gap-3 rounded-lg border bg-muted/30 p-6">
              {recording ? (
                <>
                  <div className="flex items-center gap-2 text-red-500 font-medium">
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                    </span>
                    Grabando… {fmt(seconds)} / {fmt(MAX_VIDEO_EXPRESS_ORDER_SECONDS)}
                  </div>
                  <Button variant="destructive" onClick={stopRecording} className="gap-2">
                    <Square className="w-4 h-4" /> Detener
                  </Button>
                </>
              ) : audioUrl ? (
                <>
                  <audio
                    src={audioUrl}
                    controls
                    className="w-full"
                    onLoadedMetadata={(event) => {
                      const duration = event.currentTarget.duration
                      setAudioDurationSeconds(Number.isFinite(duration) ? duration : null)
                    }}
                  />
                  {audioDurationSeconds !== null && (
                    <p className={`text-xs ${exceedsVideoExpressAudioLimit(audioDurationSeconds) ? "text-destructive" : "text-muted-foreground"}`}>
                      Duración real: {fmt(Math.ceil(audioDurationSeconds))}
                      {exceedsVideoExpressAudioLimit(audioDurationSeconds) && ` — el máximo es ${fmt(MAX_VIDEO_EXPRESS_ORDER_SECONDS)}`}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={resetAudio} disabled={videoExpress.isPending} className="gap-1.5">
                      <RotateCcw className="w-4 h-4" /> Repetir
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <Button onClick={startRecording} className="gap-2 h-12 px-6">
                    <Mic className="w-5 h-5" /> Grabar orden
                  </Button>
                  <button
                    type="button"
                    className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="w-3.5 h-3.5 inline mr-1" /> o subir un audio
                  </button>
                  <input
                    ref={fileInputRef} type="file" accept="audio/*" className="hidden"
                    onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = "" }}
                  />
                </>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              Ejemplo: «Créame un video de 30 segundos sobre cómo vender más en Instagram,
              con tono cercano, y que termine diciendo: escríbeme la palabra VENTAS».
            </p>

            <Button
              className="w-full gap-2"
              onClick={handleSend}
              disabled={!audioBlob || recording || videoExpress.isPending || exceedsVideoExpressAudioLimit(audioDurationSeconds)}
            >
              {videoExpress.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Interpretando tu orden…</>
                : <><Zap className="w-4 h-4" /> Crear video con esta orden</>}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
