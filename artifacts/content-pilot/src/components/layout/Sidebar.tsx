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
} from "lucide-react"
import { useAuthStatus } from "@workspace/api-client-react"

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/course", label: "Academia", icon: BookOpen },
  { href: "/connect", label: "Instagram", icon: Instagram },
  { href: "/audit", label: "Auditoría", icon: BarChart3 },
  { href: "/content", label: "Plan de Contenido", icon: ListVideo },
  { href: "/avatars", label: "Avatares", icon: Users },
  { href: "/videos", label: "Videos", icon: Video },
  { href: "/captions", label: "Studio de Efectos", icon: Sparkles },
  { href: "/automation", label: "Automatización", icon: Zap },
  { href: "/billing", label: "Facturación", icon: CreditCard },
  { href: "/settings", label: "Configuración", icon: Settings },
]

const ADMIN_NAV_ITEMS = [
  { href: "/users", label: "Usuarios", icon: UserCog },
]

interface SidebarProps {
  onClose?: () => void
}

export function Sidebar({ onClose }: SidebarProps) {
  const [location] = useLocation()
  const { data: authData } = useAuthStatus()
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
      
      <nav className="flex-1 overflow-y-auto py-6 px-3 flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive = location === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md font-medium text-sm transition-all duration-200 group relative",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-primary rounded-r-full" />
              )}
              <item.icon className={cn(
                "w-5 h-5",
                isActive ? "text-primary" : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80"
              )} />
              {item.label}
            </Link>
          )
        })}

        {/* Admin-only section */}
        {authData?.user?.role === "admin" && (
          <>
            <div className="mx-3 my-2 border-t border-sidebar-border/50" />
            <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/30">
              Administración
            </p>
            {ADMIN_NAV_ITEMS.map((item) => {
              const isActive = location === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-md font-medium text-sm transition-all duration-200 group relative",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  )}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-primary rounded-r-full" />
                  )}
                  <item.icon className={cn(
                    "w-5 h-5",
                    isActive ? "text-primary" : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80"
                  )} />
                  {item.label}
                </Link>
              )
            })}
          </>
        )}
      </nav>
      
    </aside>
  )
}
