import { useGetDashboard, useTriggerAutomation, getGetDashboardQueryKey } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Zap, Play, PlayCircle, BarChart, Calendar, Video, Clock } from "lucide-react"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { Link } from "wouter"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/hooks/use-toast"

export default function Dashboard() {
  const { data: dashboard, isLoading } = useGetDashboard()
  const triggerAutomation = useTriggerAutomation()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const handleTrigger = () => {
    triggerAutomation.mutate(undefined, {
      onSuccess: (result) => {
        toast({
          title: "Automatización activada",
          description: result.message,
        })
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() })
      },
      onError: (err) => {
        toast({
          title: "Error",
          description: "No se pudo activar la automatización",
          variant: "destructive"
        })
      }
    })
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-4xl font-display font-bold">Dashboard</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-display font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1 text-lg">Resumen de tu máquina de contenido</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" asChild>
            <Link href="/content">Generar Script</Link>
          </Button>
          <Button onClick={handleTrigger} disabled={triggerAutomation.isPending} className="gap-2 shadow-lg shadow-primary/20">
            <PlayCircle className="w-4 h-4" />
            {triggerAutomation.isPending ? "Ejecutando..." : "Ejecutar Ahora"}
          </Button>
        </div>
      </div>

      {!dashboard?.account_connected && (
        <Card className="border-dashed bg-secondary/5 border-secondary/20">
          <CardContent className="p-8 text-center flex flex-col items-center">
            <div className="w-12 h-12 rounded-full bg-secondary/20 flex items-center justify-center mb-4">
              <Zap className="w-6 h-6 text-secondary" />
            </div>
            <h3 className="text-xl font-bold font-display mb-2">Conecta tu cuenta de Instagram</h3>
            <p className="text-muted-foreground max-w-md mb-6">
              Para que ContentPilot pueda analizar tu contenido y publicar automáticamente, necesitas conectar tu cuenta de Instagram.
            </p>
            <Button asChild>
              <Link href="/connect">Conectar Instagram</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {dashboard && (
        <>
          {/* Status Banner */}
          <Card className="overflow-hidden border-none shadow-md bg-gradient-to-r from-sidebar to-sidebar-accent text-sidebar-foreground">
            <div className="p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-5">
                <div className="relative">
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center ${dashboard.automation_enabled ? 'bg-primary/20 text-primary' : 'bg-sidebar-foreground/10 text-sidebar-foreground/50'}`}>
                    <Zap className="w-8 h-8" />
                  </div>
                  {dashboard.automation_enabled && (
                    <div className="absolute top-0 right-0 w-4 h-4 rounded-full bg-green-500 border-2 border-sidebar" />
                  )}
                </div>
                <div>
                  <h2 className="text-2xl font-bold font-display text-white">
                    {dashboard.automation_enabled ? "Automatización Activa" : "Automatización Pausada"}
                  </h2>
                  <p className="text-sidebar-foreground/70">
                    {dashboard.automation_enabled 
                      ? "Tu sistema está produciendo y publicando contenido."
                      : "Activa la automatización para que el contenido se genere solo."}
                  </p>
                </div>
              </div>
              <div className="bg-black/20 rounded-lg p-4 backdrop-blur-sm min-w-[200px]">
                <p className="text-sm font-medium text-sidebar-foreground/60 mb-1">Próxima publicación</p>
                <div className="text-white font-bold flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  {dashboard.next_scheduled_at ? format(new Date(dashboard.next_scheduled_at), "PPp", { locale: es }) : "No programada"}
                </div>
              </div>
            </div>
          </Card>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <Video className="w-5 h-5" />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Videos Generados</p>
                  <h3 className="text-3xl font-display font-bold mt-1">{dashboard.videos_generated_total}</h3>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center text-green-600">
                    <Play className="w-5 h-5" />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Publicados</p>
                  <h3 className="text-3xl font-display font-bold mt-1">{dashboard.videos_published_total}</h3>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-lg bg-secondary/10 flex items-center justify-center text-secondary">
                    <Calendar className="w-5 h-5" />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">En Cola (Listos)</p>
                  <h3 className="text-3xl font-display font-bold mt-1">{dashboard.content_items_ready}</h3>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-600">
                    <BarChart className="w-5 h-5" />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Generando Ahora</p>
                  <h3 className="text-3xl font-display font-bold mt-1">{dashboard.videos_generating_now}</h3>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
