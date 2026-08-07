import { useGetInstagramAudit } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { BarChart3, TrendingUp, Clock, Lightbulb, Play, Heart, MessageCircle } from "lucide-react"

export default function Audit() {
  const { data: audit, isLoading, error } = useGetInstagramAudit()

  if (isLoading) {
    return (
      <div className="space-y-8 animate-in fade-in">
        <div>
          <h1 className="text-4xl font-display font-bold">Auditoría</h1>
          <p className="text-muted-foreground mt-1 text-lg">Analizando rendimiento de contenido...</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
        
        <Skeleton className="h-[400px] rounded-xl" />
      </div>
    )
  }

  if (error || !audit) {
    return (
      <div className="space-y-6">
        <h1 className="text-4xl font-display font-bold">Auditoría</h1>
        <Card className="border-dashed bg-muted/30">
          <CardContent className="p-12 text-center flex flex-col items-center">
            <BarChart3 className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-xl font-bold mb-2">No hay datos disponibles</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              Asegúrate de que tu cuenta de Instagram esté conectada y tenga publicaciones para poder analizar el rendimiento.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-4xl font-display font-bold tracking-tight">Auditoría de Contenido</h1>
        <p className="text-muted-foreground mt-1 text-lg">Insights generados por IA basados en tus top posts</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-primary/20 rounded-md text-primary">
                <TrendingUp className="w-5 h-5" />
              </div>
              <p className="font-medium text-muted-foreground">Tasa de Engagement</p>
            </div>
            <h3 className="text-4xl font-display font-bold text-primary">
              {(audit.avg_engagement_rate * 100).toFixed(1)}%
            </h3>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-secondary/20 rounded-md text-secondary">
                <Play className="w-5 h-5" />
              </div>
              <p className="font-medium text-muted-foreground">Alcance Promedio</p>
            </div>
            <h3 className="text-4xl font-display font-bold">
              {audit.avg_reach.toLocaleString()}
            </h3>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-accent rounded-md text-accent-foreground">
                <Clock className="w-5 h-5" />
              </div>
              <p className="font-medium text-muted-foreground">Mejores Horas</p>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {audit.best_posting_times.map((time) => (
                <Badge variant="secondary" key={time}>{time}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-yellow-500" />
                Análisis de IA
              </CardTitle>
              <CardDescription>Conclusiones sobre lo que funciona en tu nicho</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <div dangerouslySetInnerHTML={{ __html: audit.content_insights.replace(/\n/g, '<br/>') }} />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Temas Recomendados</CardTitle>
              <CardDescription>Para tus próximos Reels</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {audit.recommended_topics.map((topic, i) => (
                  <li key={i} className="flex gap-3 text-sm p-3 bg-muted/50 rounded-lg">
                    <span className="text-primary font-bold">{i + 1}.</span>
                    <span>{topic}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      <div>
        <h2 className="text-2xl font-display font-bold mb-4">Mejores Publicaciones</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {audit.top_posts.map((post) => (
            <Card key={post.id} className="overflow-hidden group">
              <div className="aspect-[4/5] bg-muted relative overflow-hidden">
                {post.thumbnail_url ? (
                  <img src={post.thumbnail_url} alt="Thumbnail" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-secondary/10 text-secondary">
                    <Play className="w-12 h-12 opacity-50" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent p-4 flex flex-col justify-end text-white">
                  <div className="flex items-center gap-4 text-sm font-medium">
                    <span className="flex items-center gap-1"><Heart className="w-4 h-4" /> {post.like_count.toLocaleString()}</span>
                    <span className="flex items-center gap-1"><MessageCircle className="w-4 h-4" /> {post.comments_count.toLocaleString()}</span>
                  </div>
                  {post.plays && (
                    <span className="flex items-center gap-1 text-sm font-medium mt-1"><Play className="w-4 h-4" /> {post.plays.toLocaleString()} plays</span>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

    </div>
  )
}
