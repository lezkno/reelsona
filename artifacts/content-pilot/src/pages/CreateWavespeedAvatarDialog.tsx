/**
 * CreateWavespeedAvatarDialog — 5-step wizard for creating a WaveSpeed AI avatar.
 *
 * Step 1 — Photo:    Upload an image or take a webcam selfie
 * Step 2 — Generate: WaveSpeed generates 5 look variations; polls until all done
 * Step 3 — Select:   User picks which generated looks to keep (≥1)
 * Step 4 — Voice:    Record ≥30s audio; upload + submit clone job
 * Step 5 — Done:     Poll voice status; when ready assign to selected looks; close
 */

import { useState, useRef, useCallback, useEffect } from "react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import {
  Camera, CameraOff, Upload, Loader2, CheckCircle2, Image as ImageIcon, Mic,
  Square, Sparkles, X, RefreshCw, AlertCircle, ChevronRight,
} from "lucide-react"
import {
  useCreateWavespeedPersona,
  useWavespeedPersonaLooksStatus,
  useCloneWavespeedVoice,
  useWavespeedVoiceStatus,
  usePatchWavespeedLook,
  WAVESPEED_PERSONAS_KEY,
  type WavespeedLookRow,
} from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"

// ── Object storage upload helper ──────────────────────────────────────────────
// Uses plain fetch — session cookie is sent automatically by the browser.

async function uploadToObjectStorage(
  data: Blob | File,
  name: string,
  contentType: string,
): Promise<string> {
  const res = await fetch("/api/storage/uploads/request-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, size: data.size, contentType }),
  })
  if (!res.ok) throw new Error(`Upload request failed: ${res.status}`)
  const { uploadURL, objectPath } = (await res.json()) as { uploadURL: string; objectPath: string }
  const put = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": contentType }, body: data })
  if (!put.ok) throw new Error(`GCS PUT failed: ${put.status}`)
  return objectPath
}

// ── Audio quality analysis (inline) ───────────────────────────────────────────

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

// ── LazyLookImage — skeleton while loading, fade-in on ready ─────────────────

function LazyLookImage({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  return (
    <div className="relative w-full h-full">
      {/* Shimmer skeleton shown until image loads */}
      {!loaded && !error && (
        <div className="absolute inset-0 bg-muted animate-pulse" />
      )}
      {error ? (
        <div className="absolute inset-0 bg-muted flex items-center justify-center">
          <AlertCircle className="w-5 h-5 text-destructive/50" />
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"} ${className}`}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          loading="eager"
        />
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

type WizardStep = "photo" | "generating" | "select" | "voice" | "done"

interface Props {
  onClose: () => void
  onCreated: () => void
}

export function CreateWavespeedAvatarDialog({ onClose, onCreated }: Props) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<WizardStep>("photo")
  const [avatarName, setAvatarName] = useState("")
  const [referenceObjectPath, setReferenceObjectPath] = useState<string | null>(null)
  const [referencePreviewUrl, setReferencePreviewUrl] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [personaId, setPersonaId] = useState<number | null>(null)
  const [selectedLookIds, setSelectedLookIds] = useState<Set<number>>(new Set())
  const [voiceDbId, setVoiceDbId] = useState<number | null>(null)
  const [voiceName, setVoiceName] = useState("Mi voz")
  const [assigning, setAssigning] = useState(false)

  // Webcam
  const [webcamActive, setWebcamActive] = useState(false)
  const [photoSource, setPhotoSource] = useState<"upload" | "webcam">("upload")
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([])
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Audio recording
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

  // Mutations
  const createPersona = useCreateWavespeedPersona()
  const cloneVoice = useCloneWavespeedVoice()
  const patchLook = usePatchWavespeedLook()

  // Polling
  // Poll in "generating" AND "select" — looks may have null imageUrl on first
  // arrival at select if the recovery re-poll hasn't fired yet.
  const looksStatusQuery = useWavespeedPersonaLooksStatus(
    personaId,
    step === "generating" || step === "select",
  )
  const voiceStatusQuery = useWavespeedVoiceStatus(
    voiceDbId,
    step === "done",
  )

  // Advance to select step when all looks are done
  useEffect(() => {
    if (step !== "generating") return
    if (looksStatusQuery.data?.allDone) {
      setStep("select")
      // Default: select all looks that succeeded
      const readyIds = new Set<number>(
        (looksStatusQuery.data.looks ?? [])
          .filter((l: WavespeedLookRow) => {
            try { return (JSON.parse(l.config ?? "{}") as { generationStatus?: string }).generationStatus === "ready" } catch { return false }
          })
          .map((l: WavespeedLookRow) => l.id),
      )
      setSelectedLookIds(readyIds)
    }
  }, [looksStatusQuery.data?.allDone, step]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup webcam on unmount
  useEffect(() => {
    return () => {
      stopWebcam()
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
      audioStreamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Attach the acquired stream to the <video> element after it mounts.
  // startWebcam() only acquires the MediaStream and sets webcamActive=true;
  // this effect runs after React re-renders and the <video> ref is populated.
  // Also re-attaches when the stream changes (camera switch).
  useEffect(() => {
    if (!webcamActive || !streamRef.current) return
    const vid = videoRef.current
    if (!vid) return
    vid.srcObject = streamRef.current
    vid.play().catch(() => {})
  }, [webcamActive, streamRef.current]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Webcam helpers ──────────────────────────────────────────────────────────

  /** Enumerate video input devices. Called before opening the webcam. */
  const enumerateCameras = async () => {
    try {
      // A brief permissions-prompt stream is needed on first call so labels are populated.
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      tempStream.getTracks().forEach((t) => t.stop())
      const devices = await navigator.mediaDevices.enumerateDevices()
      const videoDevices = devices.filter((d) => d.kind === "videoinput")
      setAvailableCameras(videoDevices)
      // Default: prefer the front-facing camera (user-facing)
      const front = videoDevices.find((d) =>
        d.label.toLowerCase().includes("front") ||
        d.label.toLowerCase().includes("facetime") ||
        d.label.toLowerCase().includes("user")
      )
      setSelectedCameraId(front?.deviceId ?? videoDevices[0]?.deviceId ?? null)
    } catch {
      // If enumeration fails, we'll just use the default camera
    }
  }

  const startWebcam = async (deviceId?: string) => {
    // Stop any existing stream before starting a new one
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null

    const videoConstraint: MediaTrackConstraints = deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode: "user" }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraint, audio: false })
      streamRef.current = stream
      // Do NOT touch videoRef here — the <video> element may not be mounted yet.
      // The useEffect above attaches srcObject after React renders the <video>.
      setWebcamActive(true)
    } catch {
      toast({ title: "No se pudo acceder a la cámara", variant: "destructive" })
    }
  }

  const stopWebcam = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setWebcamActive(false)
  }

  /** Switch to a different camera while the webcam is already active.
   *  The video element is already mounted, so we attach srcObject directly
   *  instead of relying on the useEffect (which only fires on state changes). */
  const switchCamera = async (deviceId: string) => {
    setSelectedCameraId(deviceId)
    if (!webcamActive) return

    // Stop existing tracks
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId } },
        audio: false,
      })
      streamRef.current = stream

      // Attach directly — video element is already in the DOM
      const vid = videoRef.current
      if (vid) {
        vid.srcObject = stream
        vid.play().catch(() => {})
      }
    } catch {
      toast({ title: "No se pudo cambiar la cámara", variant: "destructive" })
    }
  }

  const captureWebcamPhoto = async () => {
    if (!videoRef.current) return
    const canvas = document.createElement("canvas")
    canvas.width = videoRef.current.videoWidth || 640
    canvas.height = videoRef.current.videoHeight || 480
    canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0)
    canvas.toBlob(async (blob) => {
      if (!blob) return
      stopWebcam()
      await handlePhotoBlob(blob, "image/png", "selfie.png")
    }, "image/png")
  }

  // ── Photo upload helpers ────────────────────────────────────────────────────

  const handlePhotoBlob = async (blob: Blob, contentType: string, name: string) => {
    setUploadingPhoto(true)
    setReferencePreviewUrl(URL.createObjectURL(blob))
    try {
      const objectPath = await uploadToObjectStorage(blob, name, contentType)
      setReferenceObjectPath(objectPath)
    } catch (err: any) {
      toast({ title: "Error al subir la foto", description: err.message, variant: "destructive" })
      setReferencePreviewUrl(null)
    } finally {
      setUploadingPhoto(false)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast({ title: "Solo se aceptan imágenes", variant: "destructive" })
      return
    }
    await handlePhotoBlob(file, file.type, file.name)
  }

  // ── Generate looks ──────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (!referenceObjectPath || !avatarName.trim()) return
    try {
      const result = await createPersona.mutateAsync({
        name: avatarName.trim(),
        referenceObjectPath,
      })
      setPersonaId(result.persona.id)
      setStep("generating")
    } catch (err: any) {
      toast({ title: "Error al crear el avatar", description: err.message, variant: "destructive" })
    }
  }

  // ── Look selection ──────────────────────────────────────────────────────────

  const toggleLook = (id: number) => {
    setSelectedLookIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── Audio helpers ────────────────────────────────────────────────────────────

  const playBeep = () => {
    try {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.4, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
      osc.start()
      osc.stop(ctx.currentTime + 0.4)
    } catch { /* ignore */ }
  }

  // Notify at 30 s
  useEffect(() => {
    if (recordSeconds === 30 && isRecording && !reached30s) {
      setReached30s(true)
      playBeep()
    }
  }, [recordSeconds, isRecording, reached30s])

  // Auto-scroll teleprompter while recording (completes in ~65 s)
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

  // ── Audio recording ─────────────────────────────────────────────────────────

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
        try {
          const quality = await analyzeAudioBlob(blob)
          setAudioQuality(quality)
        } catch { /* ignore */ }
        setAnalyzingAudio(false)
        audioStreamRef.current?.getTracks().forEach((t) => t.stop())
        audioStreamRef.current = null
      }
      mr.start(500)
      mediaRecorderRef.current = mr
      setIsRecording(true)
      setRecordSeconds(0)
      setReached30s(false)
      recordTimerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000)
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

  const handleVoiceSubmit = async () => {
    if (!recordedBlob || !voiceName.trim()) return
    const fd = new FormData()
    fd.append("audio", recordedBlob, "voice.webm")
    fd.append("name", voiceName.trim())
    try {
      const result = await cloneVoice.mutateAsync(fd)
      setVoiceDbId(result.voiceId)
      setStep("done")
    } catch (err: any) {
      toast({ title: "Error al clonar la voz", description: err.message, variant: "destructive" })
    }
  }

  // ── Final assignment ────────────────────────────────────────────────────────

  const voiceStatus = voiceStatusQuery.data
  const voiceReady = voiceStatus?.status === "ready"
  const voiceFailed = voiceStatus?.status === "failed"

  const handleCreateAvatar = async () => {
    if (!voiceReady || !voiceDbId) return
    setAssigning(true)
    try {
      // Patch each selected look with voiceId and selected flag
      for (const lookId of selectedLookIds) {
        await patchLook.mutateAsync({ id: lookId, config: { voiceId: voiceDbId, selected: true } })
      }
      queryClient.invalidateQueries({ queryKey: WAVESPEED_PERSONAS_KEY })
      toast({ title: "¡Avatar AI creado!", description: "Ya puedes usar tus looks en la generación de videos." })
      onCreated()
    } catch (err: any) {
      toast({ title: "Error al guardar el avatar", description: err.message, variant: "destructive" })
    } finally {
      setAssigning(false)
    }
  }

  // ── Step: Photo ─────────────────────────────────────────────────────────────

  const renderPhoto = () => (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <div className="w-6 h-6 bg-primary rounded-full text-primary-foreground text-xs flex items-center justify-center font-bold">1</div>
          Foto de referencia
        </DialogTitle>
        <DialogDescription>
          Sube una foto tuya o tómate una selfie. La IA usará tu rostro para generar 3 looks diferentes.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div>
          <Label htmlFor="avatar-name">Nombre de tu avatar AI</Label>
          <Input
            id="avatar-name"
            className="mt-1.5"
            placeholder="Ej: Mi Avatar AI"
            value={avatarName}
            onChange={(e) => setAvatarName(e.target.value)}
          />
        </div>

        {/* Source toggle */}
        <div className="flex gap-2">
          <Button
            variant={photoSource === "upload" ? "default" : "outline"}
            size="sm"
            onClick={() => { setPhotoSource("upload"); stopWebcam() }}
          >
            <Upload className="w-3.5 h-3.5 mr-1.5" /> Subir foto
          </Button>
          <Button
            variant={photoSource === "webcam" ? "default" : "outline"}
            size="sm"
            onClick={async () => {
              setPhotoSource("webcam")
              if (!webcamActive) {
                await enumerateCameras()
                await startWebcam(selectedCameraId ?? undefined)
              }
            }}
          >
            <Camera className="w-3.5 h-3.5 mr-1.5" /> Selfie
          </Button>
        </div>

        {photoSource === "upload" ? (
          <div>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
            {referencePreviewUrl ? (
              <div className="relative w-40 mx-auto">
                <img src={referencePreviewUrl} alt="Preview" className="w-40 h-52 object-cover rounded-xl border-2 border-primary" />
                <button
                  type="button"
                  onClick={() => { setReferencePreviewUrl(null); setReferenceObjectPath(null) }}
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-destructive text-white flex items-center justify-center"
                >
                  <X className="w-3 h-3" />
                </button>
                {uploadingPhoto && (
                  <div className="absolute inset-0 bg-black/50 rounded-xl flex items-center justify-center">
                    <Loader2 className="w-6 h-6 text-white animate-spin" />
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-3 text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
              >
                <ImageIcon className="w-8 h-8" />
                <span className="text-sm font-medium">Haz clic para subir una foto</span>
                <span className="text-xs">JPG, PNG — rostro frontal, buena iluminación</span>
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            {webcamActive ? (
              <>
                {/* Portrait video — 3:4 aspect, matches a selfie/portrait photo */}
                <div className="relative w-48 rounded-xl overflow-hidden border-2 border-primary shadow-lg" style={{ aspectRatio: "3/4" }}>
                  <video
                    ref={videoRef}
                    className="w-full h-full object-cover"
                    autoPlay
                    muted
                    playsInline
                  />
                </div>

                {/* Camera selector — shown when >1 camera detected */}
                {availableCameras.length > 1 && (
                  <div className="flex items-center gap-2 w-full max-w-[12rem]">
                    <Camera className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <select
                      className="flex-1 text-xs rounded-md border border-input bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
                      value={selectedCameraId ?? ""}
                      onChange={(e) => switchCamera(e.target.value)}
                    >
                      {availableCameras.map((cam, i) => (
                        <option key={cam.deviceId} value={cam.deviceId}>
                          {cam.label || `Cámara ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button onClick={captureWebcamPhoto} className="gap-2">
                    <Camera className="w-4 h-4" /> Capturar
                  </Button>
                  <Button variant="outline" size="icon" onClick={stopWebcam} title="Cerrar cámara">
                    <CameraOff className="w-4 h-4" />
                  </Button>
                </div>
              </>
            ) : referencePreviewUrl ? (
              <div className="relative w-48 mx-auto" style={{ aspectRatio: "3/4" }}>
                <img src={referencePreviewUrl} alt="Selfie" className="w-full h-full object-cover rounded-xl border-2 border-primary" />
                <button
                  type="button"
                  onClick={async () => {
                    setReferencePreviewUrl(null)
                    setReferenceObjectPath(null)
                    await enumerateCameras()
                    await startWebcam(selectedCameraId ?? undefined)
                  }}
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-destructive text-white flex items-center justify-center"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <Button
                variant="outline"
                onClick={async () => {
                  await enumerateCameras()
                  await startWebcam(selectedCameraId ?? undefined)
                }}
                className="gap-2"
              >
                <Camera className="w-4 h-4" /> Activar cámara
              </Button>
            )}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button
          onClick={handleGenerate}
          disabled={!referenceObjectPath || !avatarName.trim() || createPersona.isPending || uploadingPhoto}
          className="gap-2"
        >
          {createPersona.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {createPersona.isPending ? "Iniciando…" : "Generar looks"}
        </Button>
      </DialogFooter>
    </>
  )

  // ── Step: Generating ─────────────────────────────────────────────────────────

  const renderGenerating = () => {
    const looks = looksStatusQuery.data?.looks ?? []
    const readyCount = looks.filter((l) => {
      try { return (JSON.parse(l.config ?? "{}") as { generationStatus?: string }).generationStatus === "ready" } catch { return false }
    }).length
    const pct = looks.length > 0 ? Math.round((readyCount / looks.length) * 100) : 0

    return (
      <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-6 h-6 bg-primary rounded-full text-primary-foreground text-xs flex items-center justify-center font-bold">2</div>
            Generando looks
          </DialogTitle>
          <DialogDescription>
            La IA está creando 5 variaciones de tu imagen — misma persona, diferentes looks.
          </DialogDescription>
        </DialogHeader>

        <div className="py-6 space-y-5">
          <div className="relative mx-auto w-16 h-16">
            <Loader2 className="w-16 h-16 animate-spin text-primary/30" />
            <Sparkles className="w-6 h-6 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-primary" />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{readyCount}/{looks.length || 3} looks generados</span>
              <span>{pct}%</span>
            </div>
            <Progress value={pct} />
          </div>

          {looks.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {looks.map((l) => {
                let cfg: { generationStatus?: string } = {}
                try { cfg = JSON.parse(l.config ?? "{}") } catch { cfg = {} }
                const status = cfg.generationStatus
                return (
                  <div key={l.id} className="aspect-[3/4] rounded-lg overflow-hidden border-2 border-border bg-muted flex items-center justify-center">
                    {l.imageUrl ? (
                      <LazyLookImage src={l.imageUrl} alt={l.name} />
                    ) : status === "failed" ? (
                      <AlertCircle className="w-5 h-5 text-destructive/60" />
                    ) : (
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <p className="text-xs text-center text-muted-foreground">Esto puede tardar 1–3 minutos.</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </>
    )
  }

  // ── Step: Select looks ───────────────────────────────────────────────────────

  const renderSelect = () => {
    const looks = looksStatusQuery.data?.looks ?? []
    const readyLooks = looks.filter((l) => {
      try { return (JSON.parse(l.config ?? "{}") as { generationStatus?: string }).generationStatus === "ready" } catch { return false }
    })

    return (
      <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-6 h-6 bg-primary rounded-full text-primary-foreground text-xs flex items-center justify-center font-bold">3</div>
            Selecciona tus looks
          </DialogTitle>
          <DialogDescription>
            Elige cuáles looks quieres conservar. Puedes seleccionar varios. Necesitas al menos 1.
          </DialogDescription>
        </DialogHeader>

        {readyLooks.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-destructive/60" />
            <p className="text-sm">No se generó ningún look correctamente.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={onClose}>Cerrar</Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-72 overflow-y-auto">
            {readyLooks.map((look) => {
              const isSelected = selectedLookIds.has(look.id)
              return (
                <button
                  key={look.id}
                  type="button"
                  onClick={() => toggleLook(look.id)}
                  className={`relative aspect-[3/4] rounded-lg overflow-hidden border-2 transition-all text-left
                    ${isSelected ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/40"}`}
                >
                  {look.imageUrl ? (
                    <LazyLookImage src={look.imageUrl} alt={look.name} />
                  ) : (
                    <div className="w-full h-full bg-muted flex items-center justify-center">
                      <ImageIcon className="w-6 h-6 text-muted-foreground" />
                    </div>
                  )}
                  {isSelected && (
                    <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                      <CheckCircle2 className="w-4 h-4 text-primary-foreground" />
                    </div>
                  )}
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
                    <p className="text-white text-xs font-medium truncate">{look.name}</p>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {readyLooks.length > 0 && (
          <DialogFooter>
            <span className="text-xs text-muted-foreground mr-auto">
              {selectedLookIds.size} look{selectedLookIds.size !== 1 ? "s" : ""} seleccionado{selectedLookIds.size !== 1 ? "s" : ""}
            </span>
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button
              onClick={() => setStep("voice")}
              disabled={selectedLookIds.size === 0}
              className="gap-2"
            >
              Siguiente <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </DialogFooter>
        )}
      </>
    )
  }

  // ── Step: Voice ──────────────────────────────────────────────────────────────

  const fmtSec = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`

  const renderVoice = () => (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <div className="w-6 h-6 bg-primary rounded-full text-primary-foreground text-xs flex items-center justify-center font-bold">4</div>
          Clona tu voz
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
            onChange={(e) => setVoiceName(e.target.value)}
            disabled={isRecording || cloneVoice.isPending}
          />
        </div>

        {/* Teleprompter — auto-scrolls while recording; locked to prevent manual interference */}
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
          ].map((r) => (
            <p key={r} className="text-xs text-muted-foreground flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
              {r}
            </p>
          ))}
        </div>

        {/* Recording controls */}
        <div className="flex flex-col items-center gap-3">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors
            ${isRecording && reached30s ? "bg-emerald-500/15 border-2 border-emerald-500" :
              isRecording ? "bg-red-500/15 border-2 border-red-500 animate-pulse" : "bg-muted"}`}>
            {isRecording
              ? <Mic className={`w-7 h-7 ${reached30s ? "text-emerald-500" : "text-red-500"}`} />
              : <Mic className="w-7 h-7 text-muted-foreground" />}
          </div>
          {isRecording && (
            <div className="text-center">
              <span className={`font-mono text-2xl font-bold tabular-nums transition-colors ${reached30s ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
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
              <Button onClick={startRecording} disabled={!!recordedBlob} className="gap-2">
                <Mic className="w-4 h-4" /> {recordedBlob ? "Grabado" : "Grabar"}
              </Button>
            )}
            {recordedBlob && !isRecording && (
              <Button variant="outline" size="icon" title="Volver a grabar"
                onClick={() => { setRecordedBlob(null); setAudioQuality(null); setRecordSeconds(0); setReached30s(false) }}>
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
          <div className={`rounded-lg border px-3 py-2.5 space-y-1 text-xs ${audioQuality.hasBlocker ? "border-destructive/40 bg-destructive/5" : "border-emerald-400/40 bg-emerald-50 dark:bg-emerald-950/20"}`}>
            <p className="font-semibold flex items-center gap-1">
              {audioQuality.hasBlocker
                ? <><AlertCircle className="w-3.5 h-3.5 text-destructive" /> Problemas detectados</>
                : <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Audio listo ({Math.round(audioQuality.duration)}s)</>
              }
            </p>
            {audioQuality.issues.map((iss, i) => (
              <p key={i} className={`flex items-center gap-1.5 ${iss.level === "error" ? "text-destructive" : "text-amber-600 dark:text-amber-400"}`}>
                <AlertCircle className="w-3 h-3 shrink-0" /> {iss.message}
              </p>
            ))}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => setStep("select")}>Atrás</Button>
        <Button
          onClick={handleVoiceSubmit}
          disabled={!recordedBlob || !voiceName.trim() || cloneVoice.isPending || (audioQuality?.hasBlocker ?? false)}
          className="gap-2"
        >
          {cloneVoice.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronRight className="w-3.5 h-3.5" />}
          {cloneVoice.isPending ? "Enviando…" : "Continuar"}
        </Button>
      </DialogFooter>
    </>
  )

  // ── Step: Done ───────────────────────────────────────────────────────────────

  const renderDone = () => {
    const looks = looksStatusQuery.data?.looks?.filter((l) => selectedLookIds.has(l.id)) ?? []

    return (
      <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-6 h-6 bg-primary rounded-full text-primary-foreground text-xs flex items-center justify-center font-bold">5</div>
            Confirmación
          </DialogTitle>
          <DialogDescription>
            {voiceReady
              ? "Tu voz está lista. Haz clic en 'Crear Avatar' para guardar."
              : voiceFailed
              ? "Hubo un error clonando la voz."
              : "Clonando tu voz… esto puede tardar unos minutos."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Selected looks preview */}
          <div>
            <p className="text-sm font-medium mb-2">Looks seleccionados ({looks.length})</p>
            <div className="flex gap-2 flex-wrap">
              {looks.map((l) => (
                <div key={l.id} className="w-14 h-[4.5rem] rounded-lg overflow-hidden border-2 border-primary/40 flex-shrink-0">
                  {l.imageUrl
                    ? <img src={l.imageUrl} alt={l.name} className="w-full h-full object-cover" />
                    : <div className="w-full h-full bg-muted" />}
                </div>
              ))}
            </div>
          </div>

          {/* Voice status */}
          <div className={`rounded-lg border px-4 py-3 flex items-center gap-3 ${voiceReady ? "border-emerald-400/40 bg-emerald-50 dark:bg-emerald-950/20" : voiceFailed ? "border-destructive/40 bg-destructive/5" : "border-border"}`}>
            {voiceReady ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
            ) : voiceFailed ? (
              <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
            ) : (
              <Loader2 className="w-5 h-5 animate-spin shrink-0 text-muted-foreground" />
            )}
            <div>
              <p className="text-sm font-medium">Voz: {voiceName || "—"}</p>
              <p className="text-xs text-muted-foreground">
                {voiceReady ? "Lista para usar" : voiceFailed ? (voiceStatus?.errorMessage ?? "Error desconocido") : "Procesando clonación…"}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={assigning}>Cancelar</Button>
          <Button
            onClick={handleCreateAvatar}
            disabled={!voiceReady || assigning}
            className="gap-2"
          >
            {assigning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            {assigning ? "Guardando…" : "Crear Avatar"}
          </Button>
        </DialogFooter>
      </>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const canClose = step !== "generating" && step !== "done"

  return (
    <Dialog open onOpenChange={(open) => { if (!open && canClose) onClose() }}>
      <DialogContent className={`sm:max-w-lg ${step === "generating" ? "[&>button]:hidden" : ""}`}>
        {step === "photo" && renderPhoto()}
        {step === "generating" && renderGenerating()}
        {step === "select" && renderSelect()}
        {step === "voice" && renderVoice()}
        {step === "done" && renderDone()}
      </DialogContent>
    </Dialog>
  )
}
