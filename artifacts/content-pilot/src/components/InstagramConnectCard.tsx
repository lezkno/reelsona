/**
 * Shared "Instagram not connected" call-to-action card.
 * Displays the same design on every page that requires an Instagram connection.
 * Handles the OAuth handshake internally — the redirect always goes through /connect.
 *
 * Popup strategy:
 *   1. Open about:blank immediately on click (sync) so browsers don't block it.
 *   2. Fetch the auth URL asynchronously.
 *   3. Navigate the popup to the returned URL.
 *   4. If the popup was blocked, fall back to same-tab redirect.
 *   5. On error, close the popup and show a toast.
 */
import { Instagram } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"

const IG_STATE_KEY = "ig_oauth_state"

function getConnectRedirectUri() {
  return window.location.origin + "/connect"
}

export function InstagramConnectCard() {
  const { toast } = useToast()

  const handleConnect = async () => {
    const state = crypto.randomUUID()
    localStorage.setItem(IG_STATE_KEY, state)
    const redirectUri = getConnectRedirectUri()

    // Open a blank popup immediately — must happen synchronously inside the click
    // handler or browsers will block it as an unrelated popup.
    const popup = window.open(
      "about:blank",
      "_blank",
      "width=640,height=720,left=200,top=80",
    )

    try {
      const res = await fetch(
        `/api/instagram/auth-url?redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`
      )
      if (!res.ok) {
        popup?.close()
        toast({
          title: "Error de conexión",
          description: "No se pudo iniciar la conexión con Meta. Inténtalo de nuevo.",
          variant: "destructive",
        })
        return
      }
      const { url } = (await res.json()) as { url: string }

      if (popup && !popup.closed) {
        popup.location.href = url
      } else {
        // Popup was blocked — fall back to same-tab navigation
        window.location.href = url
      }
    } catch {
      popup?.close()
      toast({
        title: "Error de conexión",
        description: "No se pudo iniciar la conexión con Meta. Inténtalo de nuevo.",
        variant: "destructive",
      })
    }
  }

  return (
    <Card className="border border-purple-200 dark:border-purple-800/40 bg-purple-50/40 dark:bg-purple-950/10 shadow-none">
      <CardContent className="flex flex-col items-center text-center gap-5 py-12 px-8">
        {/* Icon */}
        <div className="w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
          <Instagram className="w-7 h-7 text-purple-500 dark:text-purple-400" />
        </div>

        {/* Text */}
        <div className="space-y-2">
          <h3 className="font-bold text-xl tracking-tight">Conecta tu cuenta</h3>
          <p className="text-sm text-muted-foreground max-w-[280px] mx-auto">
            Autoriza a Reelsona a publicar Reels en tu nombre y leer las estadísticas de tus posts.
          </p>
        </div>

        {/* CTA */}
        <Button
          size="lg"
          className="gap-2 bg-gradient-to-r from-[#833ab4] via-[#fd1d1d] to-[#fcb045] hover:opacity-90 transition-opacity border-0 text-white"
          onClick={handleConnect}
        >
          <Instagram className="w-5 h-5" />
          Conectar con Meta
        </Button>

        {/* Disclaimer */}
        <p className="text-xs text-muted-foreground max-w-xs">
          Requiere cuenta de Instagram <strong>Business</strong> o <strong>Creator</strong>.{" "}
          Las cuentas personales no son compatibles.
        </p>
      </CardContent>
    </Card>
  )
}
