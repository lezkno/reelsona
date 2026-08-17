/**
 * NoAccessWall — pantalla unificada de "plan requerido".
 * Usada en cualquier página o sección donde el usuario no tiene
 * un plan activo o no tiene acceso a esa función según su plan.
 *
 * Título, subtítulo y botón son idénticos en toda la app para
 * mantener coherencia visual y de mensaje.
 */
import { Lock, ArrowRight } from "lucide-react"
import { useLocation } from "wouter"
import { Button } from "@/components/ui/button"

interface NoAccessWallProps {
  /** Sobreescribe el título por defecto (usar solo si el contexto lo exige). */
  title?: string
  /** Sobreescribe el subtítulo por defecto. */
  description?: string
  /** Padding vertical extra (py-*). Default: "py-24". */
  py?: string
}

export function NoAccessWall({
  title       = "Función disponible con plan activo",
  description = "Activa un plan de Reelsona para acceder a esta función. Tus proyectos y recursos siguen guardados.",
  py          = "py-24",
}: NoAccessWallProps) {
  const [, navigate] = useLocation()

  return (
    <div
      className={`flex flex-col items-center justify-center ${py} px-4 text-center gap-5 max-w-sm mx-auto`}
    >
      <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
        <Lock className="w-6 h-6 text-muted-foreground" />
      </div>

      <div className="space-y-1.5">
        <p className="font-semibold text-base">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <Button className="gap-2" onClick={() => navigate("/billing")}>
        Ver planes <ArrowRight className="w-4 h-4" />
      </Button>
    </div>
  )
}
