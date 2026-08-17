import {
  useGetSettings, useUpdateSettings, useExtractBrandPalette,
  getGetSettingsQueryKey, SettingsTone, type SettingsInput,
  useAuthStatus,
} from "@workspace/api-client-react"
import { useUpload } from "@workspace/object-storage-web"

import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Slider } from "@/components/ui/slider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { useEffect, useRef, useState } from "react"
import { Save, CheckCircle2, Loader2, RefreshCw, Play, Upload, X, Palette, Sparkles } from "lucide-react"
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
    // Brand identity fields (logo, palette, colors) are managed exclusively by
    // BrandIdentityCard via dedicated endpoints. We must NOT send them here:
    // formData is initialised once when settings first loads, so its brand values
    // are whatever was in the DB at that moment. If the user later uploads a logo
    // (which saves directly via POST /settings/brand-logo), formData still holds
    // the old null values — and sending them would silently overwrite the saved logo.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { brand_logo_url, brand_primary_color, brand_accent_color, brand_palette, ...generalData } = formData
    updateSettings.mutate({ data: generalData }, {
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
      <div className="space-y-6">
        <h1 className="text-2xl sm:text-4xl font-display font-bold">Configuración</h1>
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
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl sm:text-4xl font-display font-bold tracking-tight">Configuración</h1>
        <p className="text-muted-foreground mt-1 text-sm sm:text-lg">Personalizá tu marca e integraciones.</p>
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
              placeholder="Describe tu nicho en detalle: a quién le hablas, qué problema resuelve tu contenido y cuál es tu propuesta de valor única."
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
                  <SelectValue placeholder="Selecciona un idioma" />
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

          {/* ── Perfil del Negocio ── */}
          <div className="pt-2 border-t space-y-5">
            <div>
              <p className="text-sm font-medium">Perfil del Negocio</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                El avatar usa esta información para hablar con tu voz real y promover tu oferta en cada video.
              </p>
            </div>

            <div className="space-y-2">
              <Label>¿Qué ofreces? <span className="text-muted-foreground font-normal">(producto / servicio / curso)</span></Label>
              <Textarea
                value={formData.offer || ''}
                onChange={e => handleChange('offer', e.target.value)}
                placeholder="Ej: Un curso online de 8 semanas para emprendedores que quieren generar sus primeros $1.000 vendiendo servicios digitales."
                className="min-h-[80px]"
              />
            </div>

            <div className="space-y-2">
              <Label>¿Cómo hablas? <span className="text-muted-foreground font-normal">(estilo de comunicación y voz)</span></Label>
              <Textarea
                value={formData.voice_style || ''}
                onChange={e => handleChange('voice_style', e.target.value)}
                placeholder="Ej: Directo y sin rodeos. Uso ejemplos concretos y números reales. Palabras que uso siempre: 'accionable', 'sistema'. Evito: 'increíble', 'revolucionario', frases motivacionales vacías."
                className="min-h-[80px]"
              />
            </div>

            <div className="space-y-2">
              <Label>Objeciones frecuentes <span className="text-muted-foreground font-normal">(y cómo las respondes)</span></Label>
              <Textarea
                value={formData.common_objections || ''}
                onChange={e => handleChange('common_objections', e.target.value)}
                placeholder={'Ej:\n"No tengo tiempo" → Con 2 horas semanales es suficiente si tienes el sistema correcto.\n"Es muy caro" → Una sola venta recupera la inversión.\n"Ya lo intenté y no funcionó" → Muestro por qué este enfoque es diferente.'}
                className="min-h-[100px]"
              />
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                CTA personal del avatar
                <span className="text-xs font-normal bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                  Reemplaza el CTA genérico
                </span>
              </Label>
              <Textarea
                value={formData.custom_cta || ''}
                onChange={e => handleChange('custom_cta', e.target.value)}
                placeholder={'Ej: "Si quieres más información sobre mi curso, regístrate en el link de mi biografía." o "Escribe la palabra CURSO en los comentarios y te envío el link directo."'}
                className="min-h-[70px]"
              />
              <p className="text-xs text-muted-foreground">
                Esta frase exacta será la última oración de cada guion. Si la dejas vacía, el avatar usará el CTA genérico del sistema.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Ajustes de Video ── */}
      <Card>
        <CardHeader>
          <CardTitle>Ajustes de Video</CardTitle>
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
