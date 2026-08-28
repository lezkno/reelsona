import { useGetInstagramAccount, useDisconnectInstagram, useHandleInstagramCallback, getGetInstagramAccountQueryKey, getGetInstagramPostsQueryKey } from "@workspace/api-client-react"
import { AlertTriangle, RefreshCw, Instagram, LogOut, CheckCircle2, Users, Image as ImageIcon, Send, BarChart3, CalendarDays, Sparkles, Activity, BadgeCheck, ArrowRight, ShieldCheck } from "lucide-react"
import { useMutation } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { useEffect, useRef, useState } from "react"
import { useLocation } from "wouter"

// The redirect_uri must be exactly the same in both:
// 1. The OAuth URL sent to Meta  2. The code exchange call
// We derive it from window.location so it always matches the real domain.
function getRedirectUri() {
  return window.location.origin + "/connect"
}

// localStorage key for CSRF state — shared across tabs so the new-tab OAuth flow works
const IG_STATE_KEY = "ig_oauth_state"

function formatExpiry(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null
  const d = new Date(isoDate)
  const diff = d.getTime() - Date.now()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (days <= 0) return "Expirado"
  if (days === 1) return "Expira mañana"
  return `Expira en ${days} días`
}

function formatActivityDate(isoDate: string): string {
  const connectedAt = new Date(isoDate)
  const hoursAgo = Math.floor((Date.now() - connectedAt.getTime()) / (1000 * 60 * 60))
  if (hoursAgo < 1) return "Ahora mismo"
  if (hoursAgo < 24) return `Hace ${hoursAgo} h`
  return connectedAt.toLocaleDateString("es-ES", { day: "numeric", month: "short" })
}

function InstagramHeroMark({ connected = false }: { connected?: boolean }) {
  return (
    <div className="relative h-24 w-24 shrink-0 sm:h-28 sm:w-28">
      <span className="absolute -right-1 top-3 h-2 w-2 rounded-full bg-[#d946ef] shadow-[0_0_0_5px_rgba(217,70,239,0.12)]" />
      <span className="absolute bottom-1 left-1 h-2 w-2 rounded-full bg-[#f59e0b] shadow-[0_0_0_5px_rgba(245,158,11,0.12)]" />
      <div className="absolute inset-2 rotate-[-7deg] rounded-[25%] bg-gradient-to-br from-[#7757ff] via-[#d946ef] to-[#f59e0b] p-[5px] shadow-[0_14px_28px_rgba(93,65,220,0.28)]">
        <div className="flex h-full w-full items-center justify-center rounded-[23%] border-2 border-white/75 bg-gradient-to-br from-[#c026d3] via-[#ec4899] to-[#fb923c]">
          <Instagram className="h-12 w-12 text-white sm:h-14 sm:w-14" strokeWidth={1.75} />
        </div>
      </div>
      {connected && (
        <span className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border-4 border-[#f4f5ff] bg-emerald-500 text-white shadow-md">
          <CheckCircle2 className="h-5 w-5" strokeWidth={2.5} />
        </span>
      )}
    </div>
  )
}

function CapabilityCard({
  icon: Icon,
  title,
  description,
  tone,
}: {
  icon: typeof Send
  title: string
  description: string
  tone: "violet" | "blue" | "green" | "amber"
}) {
  const toneClasses = {
    violet: "from-[#8b5cf6] to-[#6d28d9] shadow-violet-200/60",
    blue: "from-[#3b82f6] to-[#2563eb] shadow-blue-200/60",
    green: "from-[#34d399] to-[#059669] shadow-emerald-200/60",
    amber: "from-[#fbbf24] to-[#f59e0b] shadow-amber-200/60",
  }

  return (
    <div className="group rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_8px_24px_rgba(30,41,96,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(30,41,96,0.11)] sm:p-5">
      <div className={`mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br text-white shadow-lg ${toneClasses[tone]}`}>
        <Icon className="h-5 w-5" strokeWidth={2.25} />
      </div>
      <h3 className="text-sm font-bold leading-tight text-slate-900">{title}</h3>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">{description}</p>
    </div>
  )
}

export default function Connect() {
  // Poll when not yet connected so the original tab auto-refreshes after the
  // new-tab OAuth flow completes.
  const { data: status, isLoading } = useGetInstagramAccount({
    query: { refetchInterval: (q: any) => (q.state.data?.connected ? false : 4000) } as any,
  })
  const disconnect = useDisconnectInstagram()
  const handleCallback = useHandleInstagramCallback()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [, setLocation] = useLocation()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [picBroken, setPicBroken] = useState(false)

  const refreshPicture = useMutation({
    mutationFn: () => fetch("/api/instagram/refresh-profile-picture", { method: "POST" }).then(r => r.json()),
    onSuccess: () => {
      setPicBroken(false)
      queryClient.invalidateQueries({ queryKey: getGetInstagramAccountQueryKey() })
    },
  })

  const handledCode = useRef<string | null>(null)
  const redirectUri = getRedirectUri()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const oauthError = params.get('error') || params.get('error_description')

    if (oauthError) {
      toast({ title: "Meta rechazó la autorización", description: params.get('error_description') ?? oauthError, variant: "destructive" })
      setLocation("/connect")
      return
    }

    if (code && code !== handledCode.current) {
      handledCode.current = code
      const returnedState = params.get('state')
      const expectedState = localStorage.getItem(IG_STATE_KEY)
      if (expectedState && returnedState !== expectedState) {
        toast({ title: "Error de seguridad", description: "El parámetro state no coincide. Intenta conectar de nuevo.", variant: "destructive" })
        setLocation("/connect")
        return
      }
      localStorage.removeItem(IG_STATE_KEY)
      // The canonical API/Zod contract already includes `state`, but the older
      // generated React client type has not been regenerated yet. Keep the
      // runtime payload correct and isolate the temporary type bridge here.
      const callbackData = {
        code,
        redirect_uri: redirectUri,
        state: returnedState ?? undefined,
      } as any
      handleCallback.mutate({ data: callbackData }, {
        onSuccess: () => {
          if (window.opener && !window.opener.closed) {
            // Running inside the OAuth popup — refresh the parent tab and close this popup.
            try { window.opener.location.reload() } catch { /* cross-origin guard */ }
            window.close()
            return
          }
          toast({ title: "Cuenta Conectada", description: "Tu cuenta de Instagram se vinculó correctamente." })
          queryClient.invalidateQueries({ queryKey: getGetInstagramAccountQueryKey() })
          queryClient.invalidateQueries({ queryKey: getGetInstagramPostsQueryKey() })
          setLocation("/connect")
        },
        onError: (err: any) => {
          const detail = err?.message ?? "Hubo un problema al conectar tu cuenta."
          toast({ title: "Error al conectar", description: detail, variant: "destructive" })
          if (window.opener && !window.opener.closed) {
            // Stay in the popup so the user can see the error toast before closing manually.
            return
          }
          setLocation("/connect")
        }
      })
    }
  }, [handleCallback, setLocation, queryClient, toast, redirectUri])

  const handleDisconnect = () => {
    disconnect.mutate(undefined, {
      onSuccess: () => {
        toast({
          title: "Cuenta desconectada",
          description: "Tu cuenta de Instagram ha sido desconectada.",
        })
        queryClient.invalidateQueries({ queryKey: getGetInstagramAccountQueryKey() })
      }
    })
  }

  const handleConnect = async () => {
    const state = crypto.randomUUID()
    localStorage.setItem(IG_STATE_KEY, state)
    const res = await fetch(`/api/instagram/auth-url?redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`)
    if (!res.ok) {
      toast({ title: "Error", description: "No se pudo generar la URL de autorización.", variant: "destructive" })
      return
    }
    const { url } = await res.json() as { url: string }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const handleRefreshToken = async () => {
    setIsRefreshing(true)
    try {
      const res = await fetch('/api/instagram/refresh-token', { method: 'POST' })
      if (res.ok) {
        toast({ title: "Token renovado", description: "Tu conexión con Instagram se actualizó correctamente." })
        queryClient.invalidateQueries({ queryKey: getGetInstagramAccountQueryKey() })
      } else {
        const data = await res.json().catch(() => ({}))
        toast({ title: "No se pudo renovar el token", description: data.error ?? "Reconecta tu cuenta manualmente.", variant: "destructive" })
        queryClient.invalidateQueries({ queryKey: getGetInstagramAccountQueryKey() })
      }
    } catch {
      toast({ title: "Error de red", description: "No se pudo conectar con el servidor.", variant: "destructive" })
    } finally {
      setIsRefreshing(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-full bg-[#f4f5ff]">
        <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
          <Skeleton className="h-12 w-64 bg-white/70" />
          <Skeleton className="h-20 w-full rounded-2xl bg-white/70" />
          <Skeleton className="h-40 w-full rounded-2xl bg-white/70" />
        </div>
      </div>
    )
  }

  const account = status?.account
  const needsReconnection = account?.needs_reconnection === true
  const expiryLabel = formatExpiry(account?.token_expires_at)
  const expiresInDays = account?.token_expires_at
    ? Math.floor((new Date(account.token_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null
  const tokenExpiringSoon = expiresInDays !== null && expiresInDays <= 7 && !needsReconnection

  return (
    <div className="relative min-h-full overflow-hidden bg-[#f4f5ff] text-slate-900 animate-in fade-in slide-in-from-bottom-4 duration-500 dark:bg-background dark:text-foreground">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-violet-300/15 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-0 h-64 w-64 rounded-full bg-blue-300/10 blur-3xl" />

      <div className="relative mx-auto max-w-6xl space-y-6 p-4 md:p-8">
        <div className="flex items-center justify-between gap-5">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-[#6754df]">Canal conectado</p>
            <h1 className="text-4xl font-display font-extrabold tracking-tight text-slate-950 sm:text-5xl dark:text-foreground">Instagram</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500 sm:text-base">
              Conecta tu cuenta para publicar automáticamente y analizar tu contenido.
            </p>
          </div>
          <div className="hidden pr-4 sm:block">
            <InstagramHeroMark connected={!!(status?.connected && account && !needsReconnection)} />
          </div>
        </div>

        {needsReconnection && (
          <Alert variant="destructive" className="border-red-200 bg-red-50/80 shadow-sm">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Tu token de Instagram expiró</AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              <span>La conexión caducó y la publicación automática está bloqueada. Reconecta tu cuenta para restablecer el acceso.</span>
              <div>
                <Button size="sm" variant="destructive" onClick={handleConnect}>
                  <Instagram className="mr-2 h-4 w-4" />
                  Reconectar cuenta
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {tokenExpiringSoon && (
          <Alert className="border-amber-200 bg-amber-50/80 text-amber-950 shadow-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertTitle>Conexión próxima a vencer — {expiryLabel}</AlertTitle>
            <AlertDescription className="flex flex-col gap-3 text-amber-900/80">
              <span>Renueva tu token ahora para evitar interrupciones en la publicación automática.</span>
              <Button size="sm" variant="outline" onClick={handleRefreshToken} disabled={isRefreshing} className="w-fit border-amber-300 bg-white/60 text-amber-900 hover:bg-white">
                <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
                {isRefreshing ? "Renovando…" : "Renovar token"}
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {!status?.connected || !account ? (
          <Card className="overflow-hidden border-violet-200/80 bg-white/90 shadow-[0_14px_40px_rgba(68,52,170,0.10)]">
            <CardContent className="flex flex-col items-center gap-6 px-6 py-12 text-center sm:px-12">
              <InstagramHeroMark />
              <div>
                <h2 className="text-2xl font-extrabold text-slate-950">Conecta tu cuenta de Instagram</h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">
                  Autoriza a Reelsona a publicar Reels en tu nombre, organizar tu contenido y leer las estadísticas de tus posts.
                </p>
              </div>
              <Button size="lg" onClick={handleConnect} className="gap-2 border-0 bg-gradient-to-r from-[#6d5dfc] via-[#5541e8] to-[#3827c8] px-7 text-white shadow-lg shadow-indigo-300/30 hover:opacity-90">
                <Instagram className="h-5 w-5" />
                Conectar con Instagram
              </Button>
              <p className="flex items-center gap-2 text-xs text-slate-400">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                Requiere una cuenta Business o Creator
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="overflow-hidden border-0 bg-gradient-to-r from-[#7560ff] via-[#5544e8] to-[#3828bc] text-white shadow-[0_14px_34px_rgba(76,61,211,0.26)]">
              <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                <div className="flex items-center gap-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25">
                    <CheckCircle2 className="h-7 w-7 text-emerald-300" strokeWidth={2.5} />
                  </span>
                  <div>
                    <h2 className="text-lg font-extrabold">Cuenta conectada</h2>
                    <p className="mt-0.5 text-sm text-white/75">Tu sistema está listo para publicar en esta cuenta.</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={disconnect.isPending} className="border-white/30 bg-white/10 text-white hover:bg-white hover:text-[#4939c8]">
                  <LogOut className="mr-2 h-4 w-4" />
                  {disconnect.isPending ? "Desconectando…" : "Desconectar"}
                </Button>
              </CardContent>
            </Card>

            <Card className="border-slate-200/80 bg-white/95 shadow-[0_10px_30px_rgba(30,41,96,0.07)]">
              <CardContent className="p-5 sm:p-7">
                <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
                  {account.profile_picture_url && !picBroken ? (
                    <img
                      src={account.profile_picture_url}
                      alt={account.username}
                      className="h-24 w-24 shrink-0 rounded-full border-4 border-white object-cover shadow-lg ring-1 ring-slate-200 sm:h-28 sm:w-28"
                      onError={() => {
                        setPicBroken(true)
                        refreshPicture.mutate()
                      }}
                    />
                  ) : (
                    <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#7962ff] to-[#3f2ac7] text-2xl font-extrabold text-white shadow-lg sm:h-28 sm:w-28">
                      {account.username.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-2xl font-extrabold text-slate-950 sm:text-3xl dark:text-foreground">@{account.username}</h2>
                      <BadgeCheck className="h-5 w-5 shrink-0 fill-blue-500 text-white" />
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{account.name || "Cuenta profesional de Instagram"}</p>
                    <div className="mt-6 grid max-w-xl grid-cols-3 divide-x divide-slate-200">
                      <div className="pr-4">
                        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-400"><Users className="h-4 w-4" /> Seguidores</p>
                        <p className="mt-1 text-2xl font-extrabold text-[#5142d8]">{account.followers_count.toLocaleString()}</p>
                      </div>
                      <div className="px-4">
                        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-400"><ImageIcon className="h-4 w-4" /> Publicaciones</p>
                        <p className="mt-1 text-2xl font-extrabold text-[#5142d8]">{account.media_count.toLocaleString()}</p>
                      </div>
                      <div className="pl-4">
                        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-400"><CalendarDays className="h-4 w-4" /> Estado</p>
                        <p className={`mt-1 text-sm font-extrabold ${tokenExpiringSoon ? "text-amber-500" : "text-emerald-500"}`}>
                          {tokenExpiringSoon ? "Por vencer" : "Activo"}
                        </p>
                      </div>
                    </div>
                    {!needsReconnection && expiryLabel && (
                      <p className={`mt-4 text-xs ${tokenExpiringSoon ? "font-semibold text-amber-600" : "text-slate-400"}`}>
                        {expiryLabel}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <CapabilityCard icon={Send} title="Publicar automáticamente" description="Publica Reels, carruseles e historias sin esfuerzo." tone="violet" />
              <CapabilityCard icon={BarChart3} title="Analíticas avanzadas" description="Monitorea tu rendimiento con métricas detalladas." tone="blue" />
              <CapabilityCard icon={CalendarDays} title="Plan de contenido inteligente" description="Organiza y programa tu contenido fácilmente." tone="green" />
              <CapabilityCard icon={Sparkles} title="IA para creación" description="Crea contenido viral con nuestra IA avanzada." tone="amber" />
            </div>

            <Card className="border-slate-200/80 bg-white/95 shadow-[0_10px_30px_rgba(30,41,96,0.07)]">
              <CardContent className="p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  <Activity className="h-5 w-5 text-[#6955e9]" />
                  <h2 className="text-lg font-extrabold text-slate-900">Actividad reciente</h2>
                </div>
                <div className="mt-5 flex flex-col gap-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 sm:flex-row sm:items-center">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#d946ef] to-[#f97316] text-white shadow-md shadow-pink-200">
                    <Instagram className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-800">Cuenta conectada exitosamente</p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">La cuenta @{account.username} está lista para publicar.</p>
                  </div>
                  <span className="text-xs font-medium text-slate-400">{formatActivityDate(account.connected_at)}</span>
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-bold text-emerald-700">Éxito</span>
                </div>
                <button type="button" onClick={() => setLocation("/content")} className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[#5142d8] transition-colors hover:text-[#3827bc]">
                  Ver tu plan de contenido
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </button>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}

function Users(props: any) {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
}
