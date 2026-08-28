import * as React from "react"
import { Link, useLocation } from "wouter"
import { cn } from "@/lib/utils"
import { 
  LayoutDashboard, 
  Instagram, 
  BarChart3, 
  ListVideo, 
  Users, 
  Video, 
  Settings, 
  Zap,
  Sparkles,
  X,
  UserCog,
  BookOpen,
  CreditCard,
  Lock,
  ArrowUpRight,
  Crown,
  ShieldCheck,
} from "lucide-react"
import { useAuthStatus } from "@workspace/api-client-react"
import { useAccessState } from "@/hooks/useAccessState"
import { canUseFeature, type Feature } from "@/lib/access"

type NavItem = {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  feature?: Feature
  lockedLabel?: string
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/course", label: "Academia", icon: BookOpen },
  { href: "/connect", label: "Instagram", icon: Instagram, feature: "publish" },
  { href: "/audit", label: "Auditoría", icon: BarChart3, feature: "strategic_analysis" },
  { href: "/content", label: "Plan de Contenido", icon: ListVideo, feature: "content_plan" },
  { href: "/avatars", label: "Avatares", icon: Users, feature: "use_public_avatar" },
  { href: "/videos", label: "Videos", icon: Video, feature: "generate_reel" },
  { href: "/captions", label: "Studio de Efectos", icon: Sparkles, feature: "caption_studio" },
  { href: "/automation", label: "Automatización", icon: Zap, feature: "autopilot", lockedLabel: "Pro" },
  { href: "/billing", label: "Facturación", icon: CreditCard },
  { href: "/settings", label: "Configuración", icon: Settings },
]

const ADMIN_NAV_ITEMS: NavItem[] = [
  { href: "/users", label: "Usuarios", icon: UserCog },
]

interface SidebarProps {
  onClose?: () => void
}

export function Sidebar({ onClose }: SidebarProps) {
  const [location] = useLocation()
  const { data: authData } = useAuthStatus()
  const accessState = useAccessState()
  const isAdmin = authData?.user?.role === "admin"

  const renderNavItem = (item: NavItem) => {
    const hasAccess = isAdmin || !item.feature || canUseFeature(accessState, item.feature)
    const isLocked = !hasAccess
    const href = isLocked ? "/billing" : item.href
    const isActive = location === item.href && !isLocked

    return (
      <Link
        key={item.href}
        href={href}
        onClick={onClose}
        aria-label={isLocked ? `${item.label} — disponible en ${item.lockedLabel ?? "un plan activo"}` : item.label}
        title={isLocked ? `${item.label} — disponible en ${item.lockedLabel ?? "un plan activo"}` : undefined}
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-md font-medium text-sm transition-all duration-200 group relative",
          isActive
            ? "bg-gradient-to-r from-[#7560ff] via-[#5544e8] to-[#3828bc] text-white shadow-lg shadow-indigo-950/20"
            : isLocked
              ? "text-sidebar-foreground/40 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground/70"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
        )}
      >
        {isActive && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-primary rounded-r-full" />
        )}
        <item.icon className={cn(
          "w-5 h-5",
          isActive ? "text-white" : isLocked ? "text-sidebar-foreground/30" : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80"
        )} />
        <span className="flex-1 truncate">{item.label}</span>
        {isLocked && (
          <span className="inline-flex items-center gap-1 rounded-full border border-violet-400/20 bg-violet-400/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-300">
            <Lock className="h-2.5 w-2.5" />
            {item.lockedLabel ?? "Plan"}
          </span>
        )}
      </Link>
    )
  }

  const planPromo = accessState === "active_basic"
    ? {
        eyebrow: "Plan Basic",
        title: "Sube a Pro",
        description: "Desbloquea AutoPilot y la publicación automática.",
        cta: "Mejorar a Pro",
        href: "/billing",
        className: "border-violet-400/40 bg-gradient-to-br from-violet-500/15 to-primary/10",
        iconClassName: "bg-violet-400/15 text-violet-200",
      }
    : accessState === "active_pro"
      ? {
          eyebrow: "Plan Pro",
          title: "Conoce Founder",
          description: "Accede a beneficios exclusivos y soporte prioritario.",
          cta: "Ver plan Founder",
          href: "/billing",
          className: "border-amber-400/40 bg-gradient-to-br from-amber-400/15 to-orange-500/10",
          iconClassName: "bg-amber-400/15 text-amber-200",
        }
      : accessState === "active_founder"
        ? {
            eyebrow: "Plan Founder",
            title: "Acceso completo",
            description: "Tienes todas las herramientas de Reelsona activas.",
            cta: "Ver mi plan",
            href: "/billing",
            className: "border-amber-400/40 bg-gradient-to-br from-amber-400/15 to-orange-500/10",
            iconClassName: "bg-amber-400/15 text-amber-200",
          }
        : {
            eyebrow: "Reelsona",
            title: "Activa tu plan",
            description: "Elige un plan para desbloquear tus herramientas.",
            cta: "Ver planes",
            href: "/billing",
            className: "border-violet-400/30 bg-gradient-to-br from-violet-500/10 to-primary/10",
            iconClassName: "bg-violet-400/15 text-violet-200",
          }

  return (
    <aside className="w-64 shrink-0 bg-sidebar text-sidebar-foreground flex flex-col h-full border-r border-sidebar-border relative z-20">
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border">
        <div className="flex items-center gap-2 flex-1">
          <img src="/logo.png" alt="Reelsona" className="w-8 h-8 object-contain" />
          <span className="font-display font-bold text-xl tracking-tight">Reelsona</span>
        </div>
        {/* Close button — mobile only */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="md:hidden min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Plan summary — visible without opening Facturación */}
      <div className="px-3 pt-4 pb-1">
        <div className="rounded-lg border border-sidebar-border/70 bg-sidebar-accent/30 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/45">
              Tu acceso
            </span>
            <span className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-bold",
              isAdmin
                ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                : accessState === "active_basic"
                  ? "border-blue-400/25 bg-blue-400/10 text-blue-300"
                  : accessState === "active_pro"
                    ? "border-violet-400/25 bg-violet-400/10 text-violet-300"
                    : accessState === "active_founder"
                      ? "border-amber-400/25 bg-amber-400/10 text-amber-300"
                      : "border-sidebar-border bg-sidebar/40 text-sidebar-foreground/50",
            )}>
              {isAdmin
                ? "Admin"
                : accessState === "active_basic"
                  ? "Basic"
                  : accessState === "active_pro"
                    ? "Pro"
                    : accessState === "active_founder"
                      ? "Founder"
                      : "Sin plan"}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-sidebar-foreground/50">
            <ShieldCheck className="h-3 w-3 shrink-0" />
            {isAdmin
              ? "Acceso total"
              : accessState === "active_basic"
                ? "Automatización requiere Pro"
                : accessState === "active_pro" || accessState === "active_founder"
                  ? "Todas las herramientas activas"
                  : "Activa un plan para continuar"}
          </div>
        </div>
      </div>
      
      <nav className="flex-1 overflow-y-auto py-6 px-3 flex flex-col gap-1">
        {NAV_ITEMS.map(renderNavItem)}

        {/* Admin-only section */}
        {isAdmin && (
          <>
            <div className="mx-3 my-2 border-t border-sidebar-border/50" />
            <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/30">
              Administración
            </p>
            {ADMIN_NAV_ITEMS.map(renderNavItem)}
          </>
        )}
      </nav>

      {!isAdmin && (
        <div className="px-3 pb-4">
          <div className={cn("rounded-xl border p-4 shadow-lg shadow-black/10", planPromo.className)}>
            <div className="flex items-start gap-2.5">
              <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", planPromo.iconClassName)}>
                <Crown className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-sidebar-foreground/60">
                  {planPromo.eyebrow}
                </p>
                <p className="mt-0.5 font-display text-base font-bold text-sidebar-foreground">
                  {planPromo.title}
                </p>
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-sidebar-foreground/65">
              {planPromo.description}
            </p>
            <Link
              href={planPromo.href}
              onClick={onClose}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-primary to-violet-500 px-3 py-2 text-xs font-bold text-white shadow-md shadow-primary/20 transition-transform hover:-translate-y-0.5"
              data-testid="sidebar-plan-cta"
            >
              {planPromo.cta}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      )}
    </aside>
  )
}
