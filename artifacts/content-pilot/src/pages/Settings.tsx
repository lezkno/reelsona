import { useGetSettings, useUpdateSettings, getGetSettingsQueryKey, SettingsTone, type SettingsInput } from "@workspace/api-client-react"
import {
  useHeyGenAccount, useConnectHeyGen, useDisconnectHeyGen,
  HEYGEN_ACCOUNT_QUERY_KEY,
} from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Slider } from "@/components/ui/slider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Progress } from "@/components/ui/progress"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { useEffect, useState } from "react"
import { Save, CheckCircle2, XCircle, Loader2, Link2, Link2Off, Eye, EyeOff, RefreshCw } from "lucide-react"

// ── Supported script languages ────────────────────────────────────────────────
const LANGUAGES = [
  { code: "es", label: "🇪🇸 Español" },
  { code: "en", label: "🇺🇸 English" },
  { code: "pt", label: "🇧🇷 Português" },
  { code: "fr", label: "🇫🇷 Français" },
  { code: "de", label: "🇩🇪 Deutsch" },
  { code: "it", label: "🇮🇹 Italiano" },
]

/** Normalize legacy values ("es-ES", "en-US", "español"…) to a canonical code. */
function normalizeLanguage(value: string | null | undefined): string {
  if (!value) return "es"
  const v = value.toLowerCase().trim()
  if (v.startsWith("es") || v === "español") return "es"
  if (v.startsWith("en") || v === "english" || v === "inglés") return "en"
  if (v.startsWith("pt") || v === "português") return "pt"
  if (v.startsWith("fr") || v === "français") return "fr"
  if (v.startsWith("de") || v === "deutsch") return "de"
  if (v.startsWith("it") || v === "italiano") return "it"
  return "es"
}

// ── HeyGen integration card ───────────────────────────────────────────────────

function HeyGenIntegrationCard() {
  const { data: account, isLoading, refetch, isRefetching } = useHeyGenAccount()
  const connect    = useConnectHeyGen()
  const disconnect = useDisconnectHeyGen()
  const { toast }  = useToast()

  const [apiKeyInput, setApiKeyInput]   = useState("")
  const [showKey, setShowKey]           = useState(false)
  const [editing, setEditing]           = useState(false)

  const isConnected  = account?.connected ?? false
  const keySource    = account?.key_source ?? "none"
  const remaining    = account?.remaining_quota
  const total        = account?.total_quota
  const hasQuota     = remaining !== null && remaining !== undefined
  const hasTotal     = total !== null && total !== undefined
  const used         = hasTotal && hasQuota ? total! - remaining! : null
  const usedPct      = hasTotal && used !== null && total! > 0
    ? Math.round((used / total!) * 100) : null
  const remainingPct = usedPct !== null ? 100 - usedPct : null

  const handleConnect = () => {
    if (!apiKeyInput.trim()) return
    connect.mutate({ api_key: apiKeyInput.trim() }, {
      onSuccess: () => {
        toast({ title: "HeyGen conectado", description: "Tu cuenta quedó vinculada correctamente." })
        setApiKeyInput("")
        setEditing(false)
      },
      onError: (err: any) => {
        toast({
          title: "Error al conectar",
          description: err?.message || "API Key inválida. Verificá que sea correcta.",
          variant: "destructive",
        })
      },
    })
  }

  const handleDisconnect = () => {
    disconnect.mutate(undefined, {
      onSuccess: () => toast({ title: "Cuenta desvinculada", description: "Se eliminó la API Key guardada." }),
      onError:   () => toast({ title: "Error", variant: "destructive" }),
    })
    setEditing(false)
    setApiKeyInput("")
  }

  const startEdit = () => {
    setEditing(true)
    setApiKeyInput("")
    setShowKey(false)
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* HeyGen brand mark */}
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-violet-800 flex items-center justify-center shrink-0 shadow-sm">
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white" aria-hidden>
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
              </svg>
            </div>
            <div>
              <CardTitle className="text-base">HeyGen</CardTitle>
              <CardDescription className="text-xs mt-0.5">Generación de videos con avatares de IA</CardDescription>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isLoading ? (
              <Skeleton className="h-6 w-24" />
            ) : isConnected ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-800">
                <CheckCircle2 className="w-3 h-3" /> Conectado
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-muted px-2.5 py-1 rounded-full border">
                <XCircle className="w-3 h-3" /> No conectado
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={() => refetch()}
              disabled={isRefetching}
              title="Actualizar estado"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">

        {/* ── API Key section ── */}
        <div className="space-y-2">
          <Label className="text-sm">API Key</Label>

          {isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : !isConnected || editing ? (
            <div className="space-y-3">
              <div className="relative">
                <Input
                  type={showKey ? "text" : "password"}
                  value={apiKeyInput}
                  onChange={e => setApiKeyInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleConnect()}
                  placeholder="Pegá tu API Key de HeyGen aquí..."
                  className="pr-10 font-mono text-sm"
                  disabled={connect.isPending}
                />
                <button
                  type="button"
                  onClick={() => setShowKey(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <p className="text-xs text-muted-foreground">
                Encontrá tu API Key en{" "}
                <a
                  href="https://app.heygen.com/settings?nav=API"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 text-primary"
                >
                  app.heygen.com → Settings → API
                </a>
              </p>

              <div className="flex gap-2">
                <Button
                  onClick={handleConnect}
                  disabled={!apiKeyInput.trim() || connect.isPending}
                  size="sm"
                  className="gap-2"
                >
                  {connect.isPending ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Verificando...</>
                  ) : (
                    <><Link2 className="w-3.5 h-3.5" /> {isConnected ? "Actualizar clave" : "Conectar cuenta"}</>
                  )}
                </Button>
                {editing && (
                  <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setApiKeyInput("") }}>
                    Cancelar
                  </Button>
                )}
              </div>
            </div>
          ) : (
            /* Connected — show masked key + actions */
            <div className="flex items-center gap-2">
              <div className="flex-1 font-mono text-sm bg-muted/50 border rounded-md px-3 py-2 text-muted-foreground select-none">
                {keySource === "env"
                  ? "●●●●●●●●●●●●  (configurada en el servidor)"
                  : "●●●●●●●●●●●●●●●●●●●●●●●●●●●"}
              </div>
              {keySource === "db" && (
                <div className="flex gap-1.5 shrink-0">
                  <Button variant="outline" size="sm" onClick={startEdit} className="gap-1.5 text-xs">
                    <Link2 className="w-3 h-3" /> Cambiar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDisconnect}
                    disabled={disconnect.isPending}
                    className="gap-1.5 text-xs text-destructive hover:text-destructive"
                  >
                    {disconnect.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2Off className="w-3 h-3" />}
                    Desconectar
                  </Button>
                </div>
              )}
              {keySource === "env" && (
                <span className="text-xs text-muted-foreground italic shrink-0">Solo lectura</span>
              )}
            </div>
          )}
        </div>

        {/* ── Credit usage bar ── */}
        {isConnected && (
          <div className="space-y-2 pt-1 border-t">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Créditos del Plan</Label>
              {hasQuota && (
                <span className="text-xs font-semibold tabular-nums">
                  {remaining!.toLocaleString()}
                  {hasTotal && <> / {total!.toLocaleString()}</>}
                  <span className="text-muted-foreground font-normal"> restantes</span>
                </span>
              )}
            </div>

            {isLoading ? (
              <Skeleton className="h-3 w-full rounded-full" />
            ) : hasQuota && hasTotal ? (
              <div className="space-y-1.5">
                <div className="relative h-3 w-full rounded-full bg-muted overflow-hidden">
                  {/* used (consumed) fill */}
                  <div
                    className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ${
                      remainingPct! < 20
                        ? "bg-destructive"
                        : remainingPct! < 50
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                    }`}
                    style={{ width: `${remainingPct!}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>{used!.toLocaleString()} créditos usados</span>
                  <span>{total!.toLocaleString()} en el plan</span>
                </div>
                {remainingPct! < 20 && (
                  <p className="text-xs text-destructive font-medium">
                    ⚠ Quedan pocos créditos. Recargá tu plan en HeyGen.
                  </p>
                )}
              </div>
            ) : hasQuota ? (
              /* No total — just show remaining */
              <div className="space-y-1">
                <p className="text-sm font-semibold">{remaining!.toLocaleString()} créditos disponibles</p>
                <p className="text-xs text-muted-foreground">
                  El total del plan no está disponible en tu cuenta.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                No se pudo obtener la información de créditos de tu cuenta.
              </p>
            )}
          </div>
        )}

      </CardContent>
    </Card>
  )
}

// ── Main settings page ────────────────────────────────────────────────────────

export default function Settings() {
  const { data: settings, isLoading } = useGetSettings()
  const updateSettings = useUpdateSettings()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [formData, setFormData] = useState<SettingsInput | null>(null)
  const [keywordsRaw, setKeywordsRaw] = useState<string>("")

  useEffect(() => {
    if (settings && !formData) {
      setFormData(settings)
      setKeywordsRaw(settings.topic_keywords?.join(", ") ?? "")
    }
  }, [settings, formData])

  const handleChange = (key: keyof SettingsInput, value: any) => {
    if (!formData) return
    setFormData((prev: SettingsInput | null) => prev ? { ...prev, [key]: value } : null)
  }

  const handleKeywordsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setKeywordsRaw(e.target.value)
  }

  const handleKeywordsBlur = () => {
    handleChange('topic_keywords', keywordsRaw.split(',').map(k => k.trim()).filter(Boolean))
  }

  const handleSave = () => {
    if (!formData) return
    updateSettings.mutate({ data: formData }, {
      onSuccess: () => {
        toast({ title: "Configuración guardada", description: "Tus preferencias han sido actualizadas." })
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() })
      },
      onError: () => {
        toast({ title: "Error", description: "No se pudieron guardar los cambios.", variant: "destructive" })
      }
    })
  }

  if (isLoading || !formData) {
    return (
      <div className="space-y-6 max-w-3xl">
        <h1 className="text-4xl font-display font-bold">Configuración</h1>
        <Card>
          <CardHeader><Skeleton className="h-8 w-1/3" /></CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-8 max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* ── Header ── */}
      <div>
        <h1 className="text-4xl font-display font-bold tracking-tight">Configuración</h1>
        <p className="text-muted-foreground mt-1 text-lg">Personalizá tu marca e integraciones.</p>
      </div>

      {/* ── Integraciones ── */}
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-display font-semibold">Integraciones</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Conecta tus herramientas externas para activar el pipeline de producción.</p>
        </div>
        <HeyGenIntegrationCard />
      </div>

      {/* ── Identidad y Tono ── */}
      <Card>
        <CardHeader>
          <CardTitle>Identidad y Tono</CardTitle>
          <CardDescription>Estos datos se usan en cada prompt de generación.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Tu Nicho Principal</Label>
            <Input
              value={formData.niche || ''}
              onChange={e => handleChange('niche', e.target.value)}
              placeholder="Ej: Finanzas Personales, Fitness para Emprendedores..."
            />
          </div>

          <div className="space-y-2">
            <Label>Descripción Detallada</Label>
            <Textarea
              value={formData.niche_description || ''}
              onChange={e => handleChange('niche_description', e.target.value)}
              placeholder="Describe a quién le hablas, qué problemas resuelves y tu propuesta de valor única..."
              className="min-h-[120px]"
            />
          </div>

          <div className="space-y-2">
            <Label>Palabras Clave (separadas por coma)</Label>
            <Input
              value={keywordsRaw}
              onChange={handleKeywordsChange}
              onBlur={handleKeywordsBlur}
              placeholder="ahorro, inversión, bolsa, libertad financiera..."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tono de Voz</Label>
              <Select
                value={formData.tone || SettingsTone.professional}
                onValueChange={(v) => handleChange('tone', v as SettingsTone)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SettingsTone.professional}>Profesional & Autoritario</SelectItem>
                  <SelectItem value={SettingsTone.casual}>Casual & Cercano</SelectItem>
                  <SelectItem value={SettingsTone.educational}>Educativo & Didáctico</SelectItem>
                  <SelectItem value={SettingsTone.entertaining}>Entretenido & Dinámico</SelectItem>
                  <SelectItem value={SettingsTone.inspirational}>Inspiracional & Motivador</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Idioma de los Guiones</Label>
              <Select
                value={normalizeLanguage(formData.language)}
                onValueChange={(v) => handleChange('language', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccioná un idioma" />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map(l => (
                    <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                La IA generará guiones, captions y temas de contenido en este idioma.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Ajustes de Video ── */}
      <Card>
        <CardHeader>
          <CardTitle>Ajustes de Video (HeyGen)</CardTitle>
          <CardDescription>Preferencias para la generación de avatares.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Duración del Video (Segundos)</Label>
              <span className="font-bold text-primary">{formData.video_duration_seconds}s</span>
            </div>
            <Slider
              value={[formData.video_duration_seconds || 45]}
              min={15}
              max={90}
              step={5}
              onValueChange={([v]) => handleChange('video_duration_seconds', v)}
            />
            <p className="text-xs text-muted-foreground">La IA ajustará el largo del guion para que se lea en este tiempo aprox.</p>
          </div>

          <div className="space-y-2">
            <Label>Texto de Marca de Agua (Opcional)</Label>
            <Input
              value={formData.watermark_text || ''}
              onChange={e => handleChange('watermark_text', e.target.value)}
              placeholder="@tuusuario"
            />
          </div>
        </CardContent>
        <CardFooter className="flex justify-end pt-6 border-t bg-muted/20">
          <Button onClick={handleSave} disabled={updateSettings.isPending} className="px-8 gap-2">
            {updateSettings.isPending ? (
              "Guardando..."
            ) : (
              <><Save className="w-4 h-4" /> Guardar Configuración</>
            )}
          </Button>
        </CardFooter>
      </Card>

    </div>
  )
}
