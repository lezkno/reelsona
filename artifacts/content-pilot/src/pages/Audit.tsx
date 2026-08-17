import { useState, useEffect, useRef } from "react"
import { useLocation } from "wouter"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useToast } from "@/hooks/use-toast"
import {
  useGetStrategyProfile,
  useRunAccountAudit,
  useGetRadarAccounts,
  useGetRadarStatus,
  useGetRadarSuggestions,
  useAddRadarAccount,
  useUpdateRadarAccount,
  useDeleteRadarAccount,
  useRunMarketStudy,
  useRunContentStrategy,
  useGetContentPlan,
  useGetInstagramAccount,
  type StrategyProfile,
  type NicheRadarAccount,
} from "@workspace/api-client-react"
import {
  TrendingUp, Users, Clock, BarChart2, Target, Lightbulb, Zap,
  AlertTriangle, CheckCircle2, Circle, RefreshCw, Loader2, Plus,
  Trash2, ExternalLink, ChevronRight, Star,
  Heart, Flame, Sparkles, Instagram, Check,
  Map, FileText, ArrowRight, Award, Lock,
} from "lucide-react"

// ── Step definitions ──────────────────────────────────────────────────────────
const STEPS = [
  { id: "account",  label: "Cuenta",    icon: BarChart2 },
  { id: "radar",    label: "Radar",     icon: Map },
  { id: "market",   label: "Mercado",   icon: TrendingUp },
  { id: "strategy", label: "Estrategia", icon: Target },
  { id: "plan",     label: "Generar Plan", icon: Zap },
] as const

type StepId = typeof STEPS[number]["id"]

// ── Helpers ───────────────────────────────────────────────────────────────────
function StepBadge({ completed }: { completed: boolean }) {
  return completed
    ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
    : <Circle className="w-4 h-4 text-muted-foreground/40 shrink-0" />
}

function SectionChips({ items, color = "default" }: { items: string[]; color?: "default" | "red" | "blue" | "violet" | "amber" }) {
  const cls: Record<string, string> = {
    default: "bg-muted text-foreground",
    red:     "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400",
    blue:    "bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
    violet:  "bg-violet-100 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400",
    amber:   "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  }
  if (!items.length) return <p className="text-sm text-muted-foreground italic">No hay datos aún.</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <span key={i} className={`text-xs font-medium px-2.5 py-1 rounded-full ${cls[color]}`}>{item}</span>
      ))}
    </div>
  )
}

function SectionList({ items, icon: Icon }: { items: string[]; icon?: React.ComponentType<any> }) {
  if (!items.length) return <p className="text-sm text-muted-foreground italic">No hay datos aún.</p>
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          {Icon ? <Icon className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" /> : <span className="text-primary shrink-0">•</span>}
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function FormatBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold">{value}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

// ── Tab: Cuenta ───────────────────────────────────────────────────────────────
function TabCuenta({ profile, onNext }: { profile: StrategyProfile | null; onNext: () => void }) {
  const runAudit = useRunAccountAudit()
  const { toast } = useToast()

  const ad = profile?.account_data
  const done = profile?.steps_completed.includes("account") ?? false

  const handleRun = () => {
    runAudit.mutate(undefined, {
      onSuccess: () => { toast({ title: "Auditoría lista", description: "Datos de tu cuenta analizados." }); onNext() },
      onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "No se pudo auditar la cuenta. Verifica que Instagram esté conectado.", variant: "destructive" }),
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold font-display">Auditoría de Cuenta</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Análisis de tus últimos 20 posts de Instagram.</p>
        </div>
        <Button onClick={handleRun} disabled={runAudit.isPending} className="gap-2" variant={done ? "outline" : "default"}>
          {runAudit.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Analizando…</> : done ? <><RefreshCw className="w-4 h-4" /> Actualizar</> : <><BarChart2 className="w-4 h-4" /> Analizar Cuenta</>}
        </Button>
      </div>

      {!ad && !runAudit.isPending && (
        <div className="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed rounded-xl">
          <BarChart2 className="w-12 h-12 text-muted-foreground/40 mb-3" />
          <h3 className="font-semibold">Sin datos aún</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs">Haz clic en "Analizar Cuenta" para leer tus últimos posts y calcular métricas reales.</p>
        </div>
      )}

      {runAudit.isPending && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1,2,3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      )}

      {ad && !runAudit.isPending && (
        <>
          {/* Métricas */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Engagement promedio</p>
                <p className="text-3xl font-bold mt-1">{ad.avg_engagement.toFixed(1)}<span className="text-base font-normal text-muted-foreground">%</span></p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Alcance promedio</p>
                <p className="text-3xl font-bold mt-1">{Math.round(ad.avg_reach).toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Mejores horarios</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {ad.best_posting_times.slice(0, 4).map((t) => (
                    <span key={t} className="text-xs font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">{t}</span>
                  ))}
                  {ad.best_posting_times.length === 0 && <span className="text-sm text-muted-foreground">No detectados</span>}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Top posts */}
          {ad.top_posts.length > 0 && (
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-3">Mejores publicaciones</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {ad.top_posts.slice(0, 6).map((post) => (
                  <a key={post.id} href={post.permalink ?? "#"} target="_blank" rel="noopener noreferrer"
                    className="group relative aspect-square rounded-xl overflow-hidden border bg-muted">
                    {post.thumbnail_url
                      ? <img src={post.thumbnail_url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                      : <div className="w-full h-full flex items-center justify-center"><FileText className="w-8 h-8 text-muted-foreground" /></div>
                    }
                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                      <div className="flex items-center gap-2 text-white text-[11px] font-semibold">
                        <span>❤️ {post.like_count}</span>
                        <span>💬 {post.comments_count}</span>
                        {post.engagement_rate != null && <span className="ml-auto bg-primary/80 px-1.5 py-0.5 rounded-full">{post.engagement_rate.toFixed(1)}%</span>}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="text-xs text-muted-foreground">
            Actualizado {format(new Date(ad.fetched_at), "d 'de' MMMM 'a las' HH:mm", { locale: es })}
          </div>
        </>
      )}
    </div>
  )
}

// ── Tab: Radar de Nicho ───────────────────────────────────────────────────────
function TabRadar() {
  const { data: accountsData, isLoading: loadingAccounts } = useGetRadarAccounts()
  const { data: suggestionsData, isLoading: loadingSuggestions, refetch: refetchSuggestions } = useGetRadarSuggestions()
  const addAccount   = useAddRadarAccount()
  const updateAccount = useUpdateRadarAccount()
  const deleteAccount = useDeleteRadarAccount()
  const { toast } = useToast()

  const [newUsername, setNewUsername] = useState("")
  const accounts       = accountsData?.accounts ?? []
  const suggestions    = suggestionsData?.suggestions ?? []

  const handleAdd = (username: string) => {
    const u = username.trim().toLowerCase().replace(/^@/, "")
    if (!u) return
    addAccount.mutate({ ig_username: u, source: "manual" }, {
      onSuccess: () => { setNewUsername(""); toast({ title: "Referente agregado", description: `@${u} agregado al radar.` }) },
      onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "No se pudo agregar.", variant: "destructive" }),
    })
  }

  const handleAddSuggestion = (username: string, reason: string) => {
    addAccount.mutate({ ig_username: username, source: "ai_suggested", bio: reason }, {
      onSuccess: () => toast({ title: "Referente agregado", description: `@${username} agregado al radar.` }),
      onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Ya está en el radar.", variant: "destructive" }),
    })
  }

  const handleToggle = (account: NicheRadarAccount) => {
    updateAccount.mutate({ id: account.id, use_as_reference: !account.use_as_reference }, {
      onError: () => toast({ title: "Error", description: "No se pudo actualizar.", variant: "destructive" }),
    })
  }

  const handleDelete = (id: number) => {
    deleteAccount.mutate(id, {
      onError: () => toast({ title: "Error", description: "No se pudo eliminar.", variant: "destructive" }),
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold font-display">Radar de Nicho</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Monitoreá referentes y competidores de tu nicho para nutrir la estrategia.</p>
        </div>
      </div>

      {/* ── Progress indicator ─────────────────────────────────────────── */}
      {(() => {
        const MIN_RECOMMENDED = 5
        const MAX_RECOMMENDED = 10
        const activeCount = accounts.filter((a) => a.use_as_reference).length
        const isComplete  = activeCount >= MIN_RECOMMENDED
        const pct         = Math.min(100, Math.round((activeCount / MIN_RECOMMENDED) * 100))

        return (
          <div className={`rounded-xl border px-4 py-3.5 space-y-2.5 transition-colors ${
            isComplete
              ? "border-emerald-500/30 bg-emerald-500/5"
              : "border-border bg-muted/30"
          }`}>
            {/* Header row */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-sm font-semibold">
                Cuentas de referencia&nbsp;
                <span className="font-normal text-muted-foreground text-xs">
                  — recomendado {MIN_RECOMMENDED}–{MAX_RECOMMENDED} cuentas para comenzar
                </span>
              </span>
              {isComplete ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
                  <Check className="w-2.5 h-2.5" /> Completado
                </span>
              ) : (
                <span className="text-xs font-semibold text-muted-foreground shrink-0">
                  {activeCount} / {MIN_RECOMMENDED}
                </span>
              )}
            </div>

            {/* Progress bar */}
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${isComplete ? "bg-emerald-500" : "bg-primary"}`}
                style={{ width: `${pct}%` }}
              />
            </div>

            {/* Contextual message */}
            {activeCount === 0 ? (
              <p className="text-xs text-muted-foreground">
                Agrega entre {MIN_RECOMMENDED} y {MAX_RECOMMENDED} cuentas referentes de tu nicho. La IA las usará para calibrar tu estrategia y temas de contenido.
              </p>
            ) : isComplete ? (
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                Estás siguiendo <strong>{activeCount}</strong> cuenta{activeCount !== 1 ? "s" : ""} de referencia. Tomaremos esta información para generar tus contenidos.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Estás siguiendo <strong>{activeCount}</strong> cuenta{activeCount !== 1 ? "s" : ""} — agrega {MIN_RECOMMENDED - activeCount} más para completar el radar mínimo recomendado.
              </p>
            )}
          </div>
        )
      })()}


      {/* Add manual account */}
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-2">Agregar referente</h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            placeholder="@username o username"
            className="flex-1 h-10 rounded-md border bg-background px-3 text-sm"
            onKeyDown={(e) => e.key === "Enter" && handleAdd(newUsername)}
          />
          <Button onClick={() => handleAdd(newUsername)} disabled={addAccount.isPending || !newUsername.trim()} className="gap-1.5">
            {addAccount.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Agregar
          </Button>
        </div>
      </div>

      {/* Saved accounts */}
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-2">
          Referentes guardados {accounts.length > 0 && <span className="text-foreground">({accounts.length})</span>}
        </h3>
        {loadingAccounts ? (
          <div className="space-y-2">{[1,2].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center border-2 border-dashed rounded-xl">Sin referentes todavía. Agrega uno arriba o usa las sugerencias de IA.</p>
        ) : (
          <div className="space-y-2">
            {accounts.map((acc) => (
              <div key={acc.id} className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${acc.use_as_reference ? "border-primary/30 bg-primary/3" : "border-border bg-muted/30 opacity-60"}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">@{acc.ig_username}</span>
                    {acc.followers != null && <span className="text-xs text-muted-foreground">{acc.followers.toLocaleString()} seg.</span>}
                    {acc.source === "ai_suggested" && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400">IA</span>}
                    {!acc.bio && !(acc.top_posts_json && (acc.top_posts_json as unknown[]).length > 0) && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 cursor-default">
                              <AlertTriangle className="w-2.5 h-2.5" />
                              Sin datos
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs max-w-[220px] text-center">
                            {acc.use_as_reference
                              ? "Esta cuenta no tiene bio ni posts sincronizados y será ignorada en el Estudio de Mercado. Sincronizala para que aporte datos al análisis."
                              : "Sin bio ni posts sincronizados. Sincronizala para que aporte datos al análisis."}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                  {acc.bio && <p className="text-xs text-muted-foreground mt-0.5 truncate">{acc.bio}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => handleToggle(acc)}
                          disabled={updateAccount.isPending}
                          className={`w-8 h-5 rounded-full transition-colors ${acc.use_as_reference ? "bg-primary" : "bg-muted-foreground/30"} disabled:cursor-not-allowed`}
                          aria-label="Usar como referencia"
                        >
                          <span className={`block w-4 h-4 rounded-full bg-white shadow-sm transition-transform mx-0.5 ${acc.use_as_reference ? "translate-x-3" : "translate-x-0"}`} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">{acc.use_as_reference ? "Usar como referencia (activo)" : "No usar como referencia"}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  {acc.profile_url && (
                    <a href={acc.profile_url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                  <button type="button" onClick={() => handleDelete(acc.id)} disabled={deleteAccount.isPending} className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI Suggestions */}
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-500" /> Sugerencias de IA para tu nicho
        </h3>
        {loadingSuggestions ? (
          <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
        ) : suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No se pudieron generar sugerencias. Verifica que el nicho esté configurado en Ajustes.</p>
        ) : (
          <div className="space-y-2">
            {suggestions
              .filter((s) => !accounts.some((a) => a.ig_username === s.ig_username))
              .map((s, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-muted/20">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">@{s.ig_username}</span>
                      <span className="text-xs text-muted-foreground">{s.approximate_followers}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{s.reason}</p>
                  </div>
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => handleAddSuggestion(s.ig_username, s.reason)}>
                    <Plus className="w-3 h-3" /> Agregar
                  </Button>
                </div>
              ))}
            {suggestions.filter((s) => !accounts.some((a) => a.ig_username === s.ig_username)).length === 0 && (
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <p className="text-sm text-muted-foreground">Agregaste todas las sugerencias.</p>
                <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => refetchSuggestions()}>
                  <RefreshCw className="w-3 h-3" /> Buscar más referentes
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Tab: Mercado ──────────────────────────────────────────────────────────────
function TabMercado({ profile, onNext }: { profile: StrategyProfile | null; onNext: () => void }) {
  const runMarket = useRunMarketStudy()
  const { toast } = useToast()
  const mi = profile?.market_insights
  const hasAccount = !!profile?.account_data
  const done = profile?.steps_completed.includes("market") ?? false

  const handleRun = () => {
    runMarket.mutate(undefined, {
      onSuccess: () => { toast({ title: "Estudio listo", description: "Mercado analizado con éxito." }); onNext() },
      onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Completa primero la auditoría de Cuenta.", variant: "destructive" }),
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold font-display">Estudio de Mercado</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Síntesis de patrones de tu cuenta + referentes del radar + ajustes.</p>
        </div>
        <Button onClick={handleRun} disabled={runMarket.isPending || !hasAccount} variant={done ? "outline" : "default"} className="gap-2">
          {runMarket.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Sintetizando…</> : done ? <><RefreshCw className="w-4 h-4" /> Actualizar</> : <><TrendingUp className="w-4 h-4" /> Sintetizar Mercado</>}
        </Button>
      </div>

      {!hasAccount && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-50/50 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Primero completa la auditoría de <strong>Cuenta</strong> (paso 1).
        </div>
      )}

      {!mi && !runMarket.isPending && hasAccount && (
        <div className="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed rounded-xl">
          <TrendingUp className="w-12 h-12 text-muted-foreground/40 mb-3" />
          <h3 className="font-semibold">Sin estudio de mercado aún</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs">La IA analizará tus datos de cuenta + referentes del radar para encontrar patrones, oportunidades y huecos de contenido.</p>
        </div>
      )}

      {runMarket.isPending && (
        <div className="space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      )}

      {mi && !runMarket.isPending && (
        <div className="grid gap-5">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-500" /> Temas que funcionan en tu cuenta</CardTitle></CardHeader>
            <CardContent><SectionChips items={mi.top_themes} color="blue" /></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><BarChart2 className="w-4 h-4 text-blue-500" /> Formatos con mejor engagement</CardTitle></CardHeader>
            <CardContent><SectionChips items={mi.working_formats} color="default" /></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Heart className="w-4 h-4 text-pink-500" /> Dolores y deseos de tu audiencia</CardTitle></CardHeader>
            <CardContent><SectionList items={mi.audience_pains} icon={ChevronRight} /></CardContent>
          </Card>
          <div className="grid sm:grid-cols-2 gap-5">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Lightbulb className="w-4 h-4 text-amber-500" /> Huecos de contenido</CardTitle></CardHeader>
              <CardContent><SectionList items={mi.content_gaps} icon={ChevronRight} /></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Zap className="w-4 h-4 text-violet-500" /> Oportunidades detectadas</CardTitle></CardHeader>
              <CardContent><SectionList items={mi.opportunities} icon={ChevronRight} /></CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Flame className="w-4 h-4 text-orange-500" /> Hooks que generan shares</CardTitle></CardHeader>
            <CardContent><SectionList items={mi.shareable_hooks} icon={ChevronRight} /></CardContent>
          </Card>
          {mi.saturated_topics.length > 0 && (
            <Card className="border-red-500/20">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-500" /> Temas saturados (evitar)</CardTitle></CardHeader>
              <CardContent><SectionChips items={mi.saturated_topics} color="red" /></CardContent>
            </Card>
          )}
          <div className="text-xs text-muted-foreground">Analizado {format(new Date(mi.analyzed_at), "d 'de' MMMM 'a las' HH:mm", { locale: es })}</div>
        </div>
      )}
    </div>
  )
}

// ── Tab: Estrategia ───────────────────────────────────────────────────────────
function TabEstrategia({ profile, onNext }: { profile: StrategyProfile | null; onNext: () => void }) {
  const runStrategy = useRunContentStrategy()
  const { toast } = useToast()
  const cs = profile?.content_strategy
  const hasMarket = !!profile?.market_insights
  const done = profile?.steps_completed.includes("strategy") ?? false

  const FORMAT_CONFIG = [
    { key: "educational",   label: "Educativo",   color: "bg-blue-500" },
    { key: "emotional",     label: "Emocional",   color: "bg-pink-500" },
    { key: "controversial", label: "Polémico",    color: "bg-orange-500" },
    { key: "storytelling",  label: "Narrativo",   color: "bg-violet-500" },
    { key: "sales",         label: "Ventas",      color: "bg-emerald-500" },
  ] as const

  const handleRun = () => {
    runStrategy.mutate(undefined, {
      onSuccess: () => { toast({ title: "Estrategia generada", description: "Tu estrategia de contenido está lista." }); onNext() },
      onError: (e: any) => toast({ title: "Error", description: e?.data?.error ?? "Completa primero el Estudio de Mercado.", variant: "destructive" }),
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold font-display">Estrategia de Contenido</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Pilares, ángulos editoriales, mix de formatos y propuesta diferencial.</p>
        </div>
        <Button onClick={handleRun} disabled={runStrategy.isPending || !hasMarket} variant={done ? "outline" : "default"} className="gap-2">
          {runStrategy.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Generando…</> : done ? <><RefreshCw className="w-4 h-4" /> Regenerar</> : <><Target className="w-4 h-4" /> Generar Estrategia</>}
        </Button>
      </div>

      {!hasMarket && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-50/50 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Primero completa el <strong>Estudio de Mercado</strong> (paso 3).
        </div>
      )}

      {!cs && !runStrategy.isPending && hasMarket && (
        <div className="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed rounded-xl">
          <Target className="w-12 h-12 text-muted-foreground/40 mb-3" />
          <h3 className="font-semibold">Sin estrategia aún</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs">La IA construirá tu estrategia completa: pilares, ángulos editoriales, mix de formatos y propuesta de valor única.</p>
        </div>
      )}

      {runStrategy.isPending && (
        <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      )}

      {cs && !runStrategy.isPending && (
        <div className="space-y-6">
          {/* Propuesta diferencial */}
          {cs.unique_value_prop && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-primary mb-1.5 flex items-center gap-1.5"><Award className="w-3.5 h-3.5" /> Propuesta de valor única</p>
              <p className="text-sm font-medium leading-relaxed">{cs.unique_value_prop}</p>
            </div>
          )}

          {/* Pilares */}
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-3">Pilares de contenido</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              {cs.pillars.map((pillar, i) => (
                <Card key={i}>
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <p className="font-bold text-sm">{pillar.name}</p>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">{pillar.frequency_pct}%</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">{pillar.objective}</p>
                    {pillar.example_topics?.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {pillar.example_topics.slice(0, 2).map((t, j) => (
                          <span key={j} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{t}</span>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Mix de formatos */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Mix de formatos recomendado</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {FORMAT_CONFIG.map(({ key, label, color }) => (
                  <FormatBar key={key} label={label} value={cs.format_mix[key] ?? 0} color={color} />
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Ángulos editoriales */}
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-2">Ángulos editoriales</h3>
            <SectionChips items={cs.editorial_angles} color="violet" />
          </div>

          {/* Hooks + CTAs */}
          <div className="grid sm:grid-cols-2 gap-5">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-2">Tipos de hooks</h3>
              <SectionList items={cs.hook_types} icon={Flame} />
            </div>
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-2">CTAs recomendados</h3>
              <SectionList items={cs.recommended_ctas} icon={ChevronRight} />
            </div>
          </div>

          {cs.posting_frequency && (
            <div className="flex items-center gap-2 text-sm px-4 py-3 rounded-xl border bg-muted/40">
              <Clock className="w-4 h-4 text-primary" />
              <span><strong>Frecuencia sugerida:</strong> {cs.posting_frequency}</span>
            </div>
          )}

          <div className="text-xs text-muted-foreground">Generada {format(new Date(cs.generated_at), "d 'de' MMMM 'a las' HH:mm", { locale: es })}</div>
        </div>
      )}
    </div>
  )
}

// ── Tab: Generar Plan ─────────────────────────────────────────────────────────
function TabPlan({ profile }: { profile: StrategyProfile | null }) {
  const [, navigate] = useLocation()
  const steps = profile?.steps_completed ?? []
  const isComplete = steps.includes("strategy")
  const cs = profile?.content_strategy

  // Radar step: derive completion from actual saved accounts, not steps_completed
  const { data: radarData } = useGetRadarAccounts()
  const radarDone = (radarData?.accounts?.length ?? 0) > 0

  // Content plan summary
  const { data: allItems } = useGetContentPlan({ limit: 100 })
  const total     = allItems?.length ?? 0
  const published = allItems?.filter(i => i.status === "published").length ?? 0
  const inProg    = allItems?.filter(i => i.status === "generating" || i.status === "ready").length ?? 0
  const pending   = allItems?.filter(i => i.status === "draft" || i.status === "scripted").length ?? 0
  const hasPlan   = total > 0

  const STEP_META = [
    { id: "account",  label: "Auditoría de cuenta analizada",     tab: "account",  done: steps.includes("account") },
    { id: "radar",    label: "Radar de nicho configurado",         tab: "radar",    done: radarDone, optional: true },
    { id: "market",   label: "Estudio de mercado sintetizado",     tab: "market",   done: steps.includes("market") },
    { id: "strategy", label: "Estrategia de contenido generada",   tab: "strategy", done: steps.includes("strategy") },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold font-display">Plan de Contenido</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          {hasPlan
            ? "Tu plan activo — revisa el estado y agrega más ideas cuando quieras."
            : "Usá tu estrategia para crear un plan de Reels inteligente y personalizado."}
        </p>
      </div>

      {/* Progress checklist */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Estado de tu perfil estratégico</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {STEP_META.map((s) => (
              <div key={s.id} className={`flex items-center gap-3 py-1 ${!s.done && !s.optional ? "opacity-60" : ""}`}>
                <StepBadge completed={s.done} />
                <span className={`text-sm ${s.done ? "text-foreground" : "text-muted-foreground"}`}>{s.label}</span>
                {s.optional && !s.done && <span className="text-[10px] font-semibold text-muted-foreground ml-auto">Opcional</span>}
                {s.done && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 ml-auto" />}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Plan already exists: summary + two actions ── */}
      {hasPlan ? (
        <>
          {/* Summary card */}
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                Tu plan activo
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg bg-background border p-3">
                  <p className="text-2xl font-bold">{total}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Total</p>
                </div>
                <div className="rounded-lg bg-background border p-3">
                  <p className="text-2xl font-bold text-emerald-600">{published}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Publicados</p>
                </div>
                <div className="rounded-lg bg-background border p-3">
                  <p className="text-2xl font-bold text-amber-500">{pending + inProg}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Pendientes</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Strategy preview (compact) */}
          {isComplete && cs && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-900/10 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Estrategia activa</p>
              </div>
              <p className="text-xs text-emerald-800 dark:text-emerald-300 leading-relaxed">{cs.unique_value_prop}</p>
            </div>
          )}

          {/* Two CTAs */}
          <div className="flex flex-col gap-3">
            <Button
              size="lg"
              className="gap-3 w-full bg-gradient-to-r from-primary to-violet-600 shadow-lg shadow-primary/20 text-base h-14"
              onClick={() => navigate("/content")}
            >
              <FileText className="w-5 h-5" />
              Ver mi Plan de Contenido
              <ArrowRight className="w-5 h-5 ml-auto" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="gap-3 w-full h-12"
              onClick={() => navigate("/content?generate=1")}
            >
              <Zap className="w-5 h-5 text-primary" />
              Agregar más ideas al plan
            </Button>
          </div>
        </>
      ) : (
        <>
          {/* Strategy preview */}
          {isComplete && cs && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-900/10 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                <p className="font-bold text-emerald-700 dark:text-emerald-400">Estrategia activa</p>
              </div>
              <p className="text-sm text-emerald-800 dark:text-emerald-300 leading-relaxed">{cs.unique_value_prop}</p>
              <div className="flex flex-wrap gap-1.5">
                {cs.pillars.slice(0, 3).map((p, i) => (
                  <span key={i} className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">{p.name} {p.frequency_pct}%</span>
                ))}
              </div>
            </div>
          )}

          {!isComplete && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-50/50 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Estrategia incompleta</p>
                <p className="text-xs mt-0.5">Completa al menos los pasos: Cuenta, Mercado y Estrategia para generar un plan con contexto estratégico. De lo contrario se usará el plan genérico.</p>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <Button
              size="lg"
              className="gap-3 w-full bg-gradient-to-r from-primary to-violet-600 shadow-lg shadow-primary/20 text-base h-14"
              onClick={() => navigate("/content?generate=1")}
            >
              <Zap className="w-5 h-5" />
              {isComplete ? "Generar Plan basado en esta Estrategia" : "Ir a Plan de Contenido"}
              <ArrowRight className="w-5 h-5 ml-auto" />
            </Button>
            {isComplete && (
              <p className="text-xs text-center text-muted-foreground">
                El plan usará tus pilares, ángulos editoriales, dolores de audiencia y oportunidades detectadas en el estudio de mercado.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Audit() {
  const [tab, setTab] = useState<StepId>("account")
  const { data, isLoading } = useGetStrategyProfile()
  const profile = data?.profile ?? null
  const steps = profile?.steps_completed ?? []
  const { data: igStatus } = useGetInstagramAccount()
  const igConnected = !!(igStatus?.connected && igStatus.account)
  const [, navigate] = useLocation()

  // On first profile load, jump to the step after the last completed one so
  // returning to this page doesn't reset the user back to step 1.
  const initialTabSet = useRef(false)
  useEffect(() => {
    if (!profile || initialTabSet.current) return
    initialTabSet.current = true
    const completedIds = STEPS.map((s) => s.id).filter((id) =>
      profile.steps_completed.includes(id)
    )
    if (completedIds.length === 0) return
    const lastIdx = STEPS.findIndex((s) => s.id === completedIds[completedIds.length - 1])
    const nextIdx = Math.min(lastIdx + 1, STEPS.length - 1)
    setTab(STEPS[nextIdx].id)
  }, [profile])

  const goNext = (current: StepId) => {
    const idx = STEPS.findIndex((s) => s.id === current)
    if (idx < STEPS.length - 1) setTab(STEPS[idx + 1].id)
  }

  const updatedAt = profile?.updated_at
    ? format(new Date(profile.updated_at), "d 'de' MMMM 'a las' HH:mm", { locale: es })
    : null

  return (
    <TooltipProvider>
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl md:text-4xl font-display font-bold tracking-tight">Estudio Estratégico</h1>
          <p className="text-muted-foreground mt-1">Analiza tu cuenta, estudia el mercado y genera un plan basado en datos.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {steps.includes("strategy") && (
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400 gap-1.5">
              <CheckCircle2 className="w-3 h-3" /> Estrategia activa
            </Badge>
          )}
          {updatedAt && (
            <span className="text-xs text-muted-foreground">Actualizado {updatedAt}</span>
          )}
        </div>
      </div>

      {/* Instagram not connected banner */}
      {!igConnected && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-50/60 dark:bg-amber-900/10 px-4 sm:px-5 py-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
            <p className="text-sm text-amber-800 dark:text-amber-300 font-medium">
              Necesitas conectar tu cuenta de Instagram para usar el Estudio Estratégico.
            </p>
          </div>
          <Button size="sm" className="shrink-0 gap-2 w-full sm:w-auto" onClick={() => navigate("/connect")}>
            <Instagram className="w-4 h-4" /> Conectar cuenta
          </Button>
        </div>
      )}

      {/* Step progress */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {STEPS.map((step, idx) => {
          const done = steps.includes(step.id)
          const current = tab === step.id
          const Icon = step.icon
          return (
            <div key={step.id} className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setTab(step.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  current
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : done
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {done && !current ? <CheckCircle2 className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
                {step.label}
              </button>
              {idx < STEPS.length - 1 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />}
            </div>
          )
        })}
      </div>

      {/* Tab content */}
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : (
        <div className="bg-card border rounded-xl p-6 shadow-sm min-h-[400px]">
          {tab === "account"  && <TabCuenta   profile={profile} onNext={() => goNext("account")} />}
          {tab === "radar"    && <TabRadar />}
          {tab === "market"   && <TabMercado  profile={profile} onNext={() => goNext("market")} />}
          {tab === "strategy" && <TabEstrategia profile={profile} onNext={() => goNext("strategy")} />}
          {tab === "plan"     && <TabPlan     profile={profile} />}
        </div>
      )}
    </div>
    </TooltipProvider>
  )
}
