import { useGetInstagramAccount, useDisconnectInstagram, useHandleInstagramCallback, getGetInstagramAccountQueryKey, useGetInstagramPosts } from "@workspace/api-client-react"
import { Heart, MessageCircle, ExternalLink, Film } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Instagram, LogOut, CheckCircle2, User, Image as ImageIcon } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"
import { useEffect, useRef } from "react"
import { useLocation } from "wouter"

// The redirect_uri must be exactly the same in both:
// 1. The OAuth URL sent to Meta  2. The code exchange call
// We derive it from window.location so it always matches the real domain.
function getRedirectUri() {
  return window.location.origin + "/connect"
}

export default function Connect() {
  const { data: status, isLoading } = useGetInstagramAccount()
  const disconnect = useDisconnectInstagram()
  const handleCallback = useHandleInstagramCallback()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [, setLocation] = useLocation()
  
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
      const expectedState = sessionStorage.getItem('ig_oauth_state')
      if (expectedState && returnedState !== expectedState) {
        toast({ title: "Error de seguridad", description: "El parámetro state no coincide. Intentá conectar de nuevo.", variant: "destructive" })
        setLocation("/connect")
        return
      }
      sessionStorage.removeItem('ig_oauth_state')
      handleCallback.mutate({ data: { code, redirect_uri: redirectUri } }, {
        onSuccess: () => {
          toast({ title: "Cuenta Conectada", description: "Tu cuenta de Instagram se vinculó correctamente." })
          queryClient.invalidateQueries({ queryKey: getGetInstagramAccountQueryKey() })
          setLocation("/connect")
        },
        onError: () => {
          toast({ title: "Error", description: "Hubo un problema al conectar tu cuenta.", variant: "destructive" })
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
    // CSRF protection: random state, validated when Meta redirects back
    const state = crypto.randomUUID()
    sessionStorage.setItem('ig_oauth_state', state)
    // Fetch auth URL passing our real redirect_uri as a query param
    const res = await fetch(`/api/instagram/auth-url?redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`)
    if (!res.ok) {
      toast({ title: "Error", description: "No se pudo generar la URL de autorización.", variant: "destructive" })
      return
    }
    const { url } = await res.json() as { url: string }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-2xl mx-auto mt-10">
        <h1 className="text-4xl font-display font-bold">Instagram</h1>
        <Card>
          <CardHeader>
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-4 w-1/2" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-32 w-full rounded-xl" />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-8 max-w-3xl mx-auto mt-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-4xl font-display font-bold tracking-tight">Instagram</h1>
        <p className="text-muted-foreground mt-1 text-lg">Conecta tu cuenta para publicar automáticamente y analizar tu contenido.</p>
      </div>

      {!status?.connected || !status.account ? (
        <Card className="border-2 border-primary/20 shadow-lg shadow-primary/5">
          <CardHeader className="text-center pb-2">
            <div className="w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-4">
              <Instagram className="w-8 h-8" />
            </div>
            <CardTitle className="text-2xl">Conecta tu cuenta</CardTitle>
            <CardDescription className="text-base max-w-md mx-auto">
              Autoriza a ContentPilot a publicar Reels en tu nombre y leer las estadísticas de tus posts.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center pt-6">
            <Button size="lg" className="w-full sm:w-auto px-8 gap-2 bg-gradient-to-r from-[#833ab4] via-[#fd1d1d] to-[#fcb045] hover:opacity-90 border-0" onClick={handleConnect}>
              <Instagram className="w-5 h-5" />
              Conectar con Meta
            </Button>
            <p className="text-xs text-muted-foreground mt-4">
              Solo publicaremos el contenido que tú apruebes o que esté automatizado.
            </p>
            <div className="mt-6 text-left bg-muted/50 border rounded-lg p-4">
              <p className="text-xs font-medium mb-1">URI de redireccionamiento (debe estar registrada exactamente así en tu Meta App):</p>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-background border rounded px-2 py-1 flex-1 overflow-x-auto whitespace-nowrap">{redirectUri}</code>
                <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(redirectUri); toast({ title: "Copiada", description: "URI copiada al portapapeles." }) }}>
                  Copiar
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">
                Meta Dashboard → Instagram → Inicio de sesión con Instagram para empresas → Configurar → "URI de redireccionamiento de OAuth válidos". Usá el botón "Comprobar URI" con este valor exacto.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-green-500/20 shadow-lg shadow-green-500/5">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-2xl">
                  <CheckCircle2 className="w-6 h-6 text-green-500" />
                  Cuenta Conectada
                </CardTitle>
                <CardDescription className="text-base mt-1">
                  Tu sistema está listo para publicar en esta cuenta.
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={disconnect.isPending} className="text-destructive border-destructive/20 hover:bg-destructive hover:text-white">
                <LogOut className="w-4 h-4 mr-2" />
                Desconectar
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="bg-muted/50 rounded-xl p-6 border flex items-center gap-6">
              {status.account.profile_picture_url ? (
                <img 
                  src={status.account.profile_picture_url} 
                  alt={status.account.username} 
                  className="w-20 h-20 rounded-full border-4 border-background shadow-md object-cover"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center shadow-md">
                  <User className="w-8 h-8" />
                </div>
              )}
              
              <div className="flex-1">
                <h3 className="text-2xl font-bold font-display">@{status.account.username}</h3>
                {status.account.name && <p className="text-muted-foreground">{status.account.name}</p>}
                
                <div className="flex items-center gap-6 mt-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                      <Users className="w-4 h-4" /> Seguidores
                    </p>
                    <p className="text-xl font-bold mt-0.5">{status.account.followers_count.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                      <ImageIcon className="w-4 h-4" /> Publicaciones
                    </p>
                    <p className="text-xl font-bold mt-0.5">{status.account.media_count.toLocaleString()}</p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {status?.connected && status.account && <PublishedReels />}
    </div>
  )
}

function PublishedReels() {
  const { data: posts, isLoading } = useGetInstagramPosts({ limit: 12 })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Film className="w-5 h-5 text-primary" />
          Reels Publicados
        </CardTitle>
        <CardDescription>Tus publicaciones más recientes en Instagram.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[9/16] rounded-xl" />
            ))}
          </div>
        ) : !posts || posts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No se encontraron publicaciones en tu cuenta.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {posts.map((post) => (
              <a
                key={post.id}
                href={post.permalink ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative aspect-[9/16] rounded-xl overflow-hidden border bg-muted"
              >
                {post.thumbnail_url ? (
                  <img
                    src={post.thumbnail_url}
                    alt={post.caption ?? "Reel"}
                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                    <Film className="w-8 h-8" />
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 text-white">
                  <div className="flex items-center gap-3 text-xs font-medium">
                    <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5" /> {post.like_count}</span>
                    <span className="flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" /> {post.comments_count}</span>
                    <ExternalLink className="w-3.5 h-3.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  {post.caption && (
                    <p className="text-[11px] mt-1 line-clamp-2 opacity-80">{post.caption}</p>
                  )}
                </div>
              </a>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Users(props: any) {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
}
