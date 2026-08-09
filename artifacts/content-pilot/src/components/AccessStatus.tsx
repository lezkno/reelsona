/**
 * AccessStatus — shows the current user's course and tool access.
 * Used in the Settings page. Admins always see "Acceso completo".
 */

import { useQuery } from "@tanstack/react-query"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { CheckCircle2, XCircle, Clock, BookOpen, Wrench, ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "")

export interface EntitlementData {
  isAdmin:            boolean
  courseAccess:       boolean
  toolAccessStatus:   "active" | "trialing" | "expired" | "disabled"
  toolAccessActive:   boolean
  toolAccessEndsAt:   string | null  // ISO string
  daysRemaining:      number | null
  source:             string | null
}

export function useGetEntitlement() {
  return useQuery<EntitlementData>({
    queryKey: ["auth", "entitlement"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/auth/entitlement`, { credentials: "include" })
      if (!res.ok) throw new Error("Error al cargar licencia")
      return res.json()
    },
    staleTime: 1000 * 60 * 5,
  })
}

const STATUS_LABEL: Record<EntitlementData["toolAccessStatus"], string> = {
  active:   "Activo",
  trialing: "En prueba",
  expired:  "Vencido",
  disabled: "Sin acceso",
}

const STATUS_VARIANT: Record<
  EntitlementData["toolAccessStatus"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  active:   "default",
  trialing: "secondary",
  expired:  "destructive",
  disabled: "outline",
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-ES", {
    day:   "numeric",
    month: "long",
    year:  "numeric",
  })
}

export default function AccessStatus() {
  const { data, isLoading } = useGetEntitlement()

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Licencia y acceso</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-1/2" />
        </CardContent>
      </Card>
    )
  }

  if (!data) return null

  // ── Admin shortcut ───────────────────────────────────────────────────────────
  if (data.isAdmin) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            Licencia y acceso
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            Administrador — acceso completo e ilimitado
          </div>
        </CardContent>
      </Card>
    )
  }

  // ── Regular user ─────────────────────────────────────────────────────────────
  const endDate = data.toolAccessEndsAt ? formatDate(data.toolAccessEndsAt) : null

  return (
    <Card className={cn(
      data.toolAccessStatus === "expired" && "border-destructive/40",
      data.toolAccessStatus === "active"  && "border-emerald-500/30",
    )}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Licencia y acceso</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Course access */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <BookOpen className="w-4 h-4 text-muted-foreground" />
            Acceso al curso
          </div>
          {data.courseAccess
            ? <Badge variant="default" className="gap-1 bg-emerald-600 hover:bg-emerald-600">
                <CheckCircle2 className="w-3 h-3" /> Activo
              </Badge>
            : <Badge variant="outline" className="gap-1 text-muted-foreground">
                <XCircle className="w-3 h-3" /> Sin acceso
              </Badge>
          }
        </div>

        {/* Tool access */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Wrench className="w-4 h-4 text-muted-foreground" />
            Acceso a la herramienta
          </div>
          <Badge variant={STATUS_VARIANT[data.toolAccessStatus]}>
            {STATUS_LABEL[data.toolAccessStatus]}
          </Badge>
        </div>

        {/* Expiry info */}
        {endDate && (
          <div className={cn(
            "flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm",
            data.toolAccessActive
              ? "bg-muted/50"
              : "bg-destructive/10 text-destructive",
          )}>
            <Clock className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              {data.toolAccessActive ? (
                <>
                  Vence el <strong>{endDate}</strong>
                  {data.daysRemaining !== null && (
                    <span className={cn(
                      "ml-1",
                      data.daysRemaining <= 7 && "text-amber-600 dark:text-amber-400 font-semibold",
                    )}>
                      ({data.daysRemaining === 0
                        ? "vence hoy"
                        : `${data.daysRemaining} día${data.daysRemaining !== 1 ? "s" : ""} restante${data.daysRemaining !== 1 ? "s" : ""}`
                      })
                    </span>
                  )}
                </>
              ) : (
                <>
                  Acceso vencido el {endDate}.{" "}
                  {data.courseAccess && (
                    <span className="text-foreground/70">
                      Puedes seguir accediendo al curso.
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* No entitlement at all */}
        {!data.courseAccess && !data.toolAccessActive && !endDate && (
          <p className="text-sm text-muted-foreground">
            Aún no tienes una licencia activa. Contacta a tu asesor para obtener acceso.
          </p>
        )}

      </CardContent>
    </Card>
  )
}
