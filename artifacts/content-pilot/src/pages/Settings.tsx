import {
  useGetSettings, useUpdateSettings, useExtractBrandPalette,
  getGetSettingsQueryKey, SettingsTone, type SettingsInput,
} from "@workspace/api-client-react"
import {
  useHeyGenAccount, useConnectHeyGen, useDisconnectHeyGen,
  HEYGEN_ACCOUNT_QUERY_KEY,
} from "@workspace/api-client-react"
import { useUpload } from "@workspace/object-storage-web"
import heygenLogoUrl from "@/assets/heygen-logo.png"
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
import { useEffect, useRef, useState } from "react"
import { Save, CheckCircle2, XCircle, Loader2, Link2, Link2Off, Eye, EyeOff, RefreshCw, Play, Upload, X, Palette } from "lucide-react"
import AccessStatus from "@/components/AccessStatus"

const WELCOME_STORAGE_KEY = "reelsona_welcome_dismissed"

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

// ── Brand Identity card ───────────────────────────────────────────────────────

function BrandIdentityCard() {
  const { data: settings, isLoading } = useGetSettings()
  const updateSettings = useUpdateSettings()
  const extractPalette = useExtractBrandPalette()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [uploading, setUploading] = useState(false)
  const [extracting, setExtracting] = useState(false)
  // Local copy of palette overrides the server one while the user is working
  const [localPalette, setLocalPalette] = useState<string[] | null>(null)

  const { uploadFile } = useUpload()

  const palette: string[] = localPalette ?? (settings?.brand_palette as string[] | null) ?? []
  const primaryColor = settings?.brand_primary_color ?? null
  const accentColor  = settings?.brand_accent_color  ?? null
  const logoUrl = settings?.brand_logo_url ? `/api/storage${settings.brand_logo_url}` : null

  const busy = uploading || extracting || updateSettings.isPending

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
      toast({ title: "Solo PNG, JPEG o WEBP", description: "El análisis de color no funciona con SVG.", variant: "destructive" })
      return
    }

    setUploading(true)
    try {
      const result = await uploadFile(file)
      if (!result) return

      setUploading(false)
      setExtracting(true)
      const data = await extractPalette.mutateAsync({ data: { object_path: result.objectPath } })
      setLocalPalette(data.palette)
      await queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() })
      toast({
        title: "¡Logo analizado!",
        description: `Se detectaron ${data.palette.length} colores. Hacé clic en uno para asignarlo como primario o acento.`,
      })
    } catch (err: any) {
      toast({ title: "Error al procesar el logo", description: err?.message ?? "Intentá de nuevo.", variant: "destructive" })
    } finally {
      setUploading(false)
      setExtracting(false)
    }
  }

  async function assignColor(hex: string, role: "primary" | "accent") {
    const update = role === "primary"
      ? { brand_primary_color: hex }
      : { brand_accent_color: hex }
    await updateSettings.mutateAsync({ data: update })
    await queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() })
    toast({ title: role === "primary" ? "Color primario guardado" : "Color de acento guardado", description: hex })
  }

  async function handleRemove() {
    await updateSettings.mutateAsync({
      data: { brand_logo_url: null, brand_primary_color: null, brand_accent_color: null, brand_palette: null },
    })
    await queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() })
    setLocalPalette(null)
    toast({ title: "Identidad de marca eliminada" })
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center shrink-0">
            <Palette className="w-5 h-5 text-white" />
          </div>
          <div>
            <CardTitle className="text-base">Identidad Visual</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Subí tu logo y el sistema detecta tu paleta automáticamente
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {isLoading ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />

            {/* ── Logo loaded state ── */}
            {logoUrl ? (
              <div className="flex items-center gap-4 rounded-xl border bg-muted/30 p-4">
                {/* Logo preview */}
                <div className="shrink-0 w-20 h-20 rounded-lg border bg-white flex items-center justify-center overflow-hidden shadow-sm">
                  <img
                    src={logoUrl}
                    alt="Logo de marca"
                    className="w-full h-full object-contain p-1"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
                  />
                </div>

                {/* Info + actions */}
                <div className="flex-1 min-w-0 space-y-2">
                  <p className="text-sm font-medium leading-tight">Logo cargado</p>
                  <p className="text-xs text-muted-foreground leading-snug">
                    {palette.length > 0
                      ? `${palette.length} colores extraídos · clic en los swatches para asignar roles`
                      : "Cambiá el logo para re-analizar la paleta"}
                  </p>
                  <div className="flex gap-2 pt-0.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-3 text-xs gap-1.5"
                      disabled={busy}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploading ? (
                        <><Loader2 className="w-3 h-3 animate-spin" /> Subiendo…</>
                      ) : extracting ? (
                        <><Loader2 className="w-3 h-3 animate-spin" /> Analizando…</>
                      ) : (
                        <><Upload className="w-3 h-3" /> Cambiar logo</>
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-3 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
                      disabled={busy}
                      onClick={handleRemove}
                    >
                      <X className="w-3 h-3" /> Eliminar
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              /* ── Upload area (no logo yet) ── */
              <div
                className={`
                  flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8
                  transition-colors cursor-pointer
                  ${busy ? "opacity-60 pointer-events-none" : "hover:border-primary/50 hover:bg-muted/30"}
                  border-muted-foreground/30
                `}
                onClick={() => !busy && fileInputRef.current?.click()}
              >
                {uploading || extracting ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">
                      {uploading ? "Subiendo logo…" : "Analizando colores…"}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
                      <Upload className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium">Subí tu logo</p>
                      <p className="text-xs text-muted-foreground mt-0.5">PNG, JPEG o WEBP</p>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Palette swatches ── */}
            {palette.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm font-medium">Colores detectados</p>
                <p className="text-xs text-muted-foreground -mt-1">
                  Clic en "1°" para primario · "2°" para acento
                </p>
                <div className="flex flex-wrap gap-3">
                  {palette.map((hex) => {
                    const isPrimary = primaryColor === hex
                    const isAccent  = accentColor  === hex
                    return (
                      <div key={hex} className="flex flex-col items-center gap-1.5">
                        {/* Color swatch */}
                        <div
                          className="w-10 h-10 rounded-full border-2 shadow-sm relative"
                          style={{
                            backgroundColor: hex,
                            borderColor: isPrimary || isAccent ? hex : "transparent",
                            outline: isPrimary || isAccent ? "2px solid white" : undefined,
                            outlineOffset: isPrimary || isAccent ? "-3px" : undefined,
                          }}
                        >
                          {isPrimary && (
                            <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center leading-none">1°</span>
                          )}
                          {isAccent && (
                            <span className="absolute -top-1 -right-1 bg-violet-500 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center leading-none">2°</span>
                          )}
                        </div>
                        {/* Role buttons */}
                        <div className="flex gap-1">
                          <button
                            onClick={() => assignColor(hex, "primary")}
                            disabled={busy || isPrimary}
                            className={`text-[10px] px-1.5 py-0.5 rounded font-medium transition-colors
                              ${isPrimary
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted hover:bg-primary/10 text-muted-foreground hover:text-primary"
                              }`}
                          >
                            1°
                          </button>
                          <button
                            onClick={() => assignColor(hex, "accent")}
                            disabled={busy || isAccent}
                            className={`text-[10px] px-1.5 py-0.5 rounded font-medium transition-colors
                              ${isAccent
                                ? "bg-violet-500 text-white"
                                : "bg-muted hover:bg-violet-100 text-muted-foreground hover:text-violet-600"
                              }`}
                          >
                            2°
                          </button>
                        </div>
                        <span className="text-[9px] text-muted-foreground font-mono">{hex}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ── Active colors summary ── */}
            {(primaryColor || accentColor) && (
              <div className="flex flex-wrap gap-3 pt-2 border-t">
                {primaryColor && (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full border border-border shadow-sm" style={{ backgroundColor: primaryColor }} />
                    <span className="text-xs text-muted-foreground">Primario</span>
                    <span className="text-xs font-mono font-medium">{primaryColor}</span>
                  </div>
                )}
                {accentColor && (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full border border-border shadow-sm" style={{ backgroundColor: accentColor }} />
                    <span className="text-xs text-muted-foreground">Acento</span>
                    <span className="text-xs font-mono font-medium">{accentColor}</span>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
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
          description: err?.message || "API Key inválida. Verifica que sea correcta.",
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* HeyGen brand mark */}
            <img
              src={heygenLogoUrl}
              alt="HeyGen"
              className="w-10 h-10 rounded-xl shrink-0 object-cover"
            />
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
            /* Input form: when disconnected or editing */
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
            /* Connected — show masked key + change/disconnect */
            <div className="flex items-center gap-2">
              <div className="flex-1 font-mono text-sm bg-muted/50 border rounded-md px-3 py-2 text-muted-foreground select-none">
                ●●●●●●●●●●●●●●●●●●●●●●●●●●●
              </div>
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
            </div>
          )}
        </div>

        {/* ── Plan Creator credits + API wallet note ── */}
        {isConnected && (
          <div className="space-y-3 pt-3 border-t">

            {/* API wallet — not accessible via API, link out */}
            <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-2.5 flex items-start gap-2.5">
              <span className="text-base mt-0.5">💳</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground">Wallet API (generación de videos)</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  HeyGen no expone el saldo de la wallet por API. Para ver cuánto te queda de los dólares precargados,
                  revisa directamente en{" "}
                  <a
                    href="https://app.heygen.com/settings?nav=Billing"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 text-primary"
                  >
                    HeyGen → Billing
                  </a>.
                </p>
              </div>
            </div>

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

      {/* ── Identidad Visual de Marca ── */}
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-display font-semibold">Identidad Visual</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Los colores seleccionados se guardan y se usarán automáticamente en las portadas de cada Reel.
          </p>
        </div>
        <BrandIdentityCard />
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Velocidad de Voz</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Ajusta la velocidad del avatar. Valores menores a 1.0 pueden reducir pausas bruscas entre frases.</p>
              </div>
              <span className="font-bold text-primary text-sm tabular-nums">{(formData.heygen_voice_speed ?? 1.0).toFixed(2)}×</span>
            </div>
            <Slider
              value={[formData.heygen_voice_speed ?? 1.0]}
              min={0.7}
              max={1.3}
              step={0.05}
              onValueChange={([v]) => handleChange('heygen_voice_speed', v)}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0.70× (más lento)</span>
              <span className="font-medium text-foreground">1.00× (defecto)</span>
              <span>1.30× (más rápido)</span>
            </div>
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

      {/* ── Licencia y acceso ── */}
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-display font-semibold">Licencia y acceso</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Estado de tu suscripción y acceso a la plataforma.</p>
        </div>
        <AccessStatus />
      </div>

      {/* ── Ayuda ── */}
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-display font-semibold">Ayuda</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Recursos para sacar el máximo provecho de la plataforma.</p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Video de bienvenida</p>
                <p className="text-xs text-muted-foreground">
                  Volvé a ver la introducción y el curso de implementación paso a paso.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-2"
                onClick={() => {
                  // Clear local dismissal flag
                  localStorage.removeItem(WELCOME_STORAGE_KEY)
                  // Reset server-side flag
                  updateSettings.mutate(
                    { data: { welcome_dismissed: false } },
                    {
                      onSuccess: () => {
                        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() })
                      },
                    }
                  )
                  // Open the modal
                  window.dispatchEvent(new Event("open-welcome-modal"))
                }}
              >
                <Play className="w-3.5 h-3.5" />
                Ver video de bienvenida
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

    </div>
  )
}
