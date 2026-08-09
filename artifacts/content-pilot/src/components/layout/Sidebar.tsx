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
  LogOut,
  ShieldCheck,
  UserCog,
} from "lucide-react"
import { useAuthStatus, useLogout } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/connect", label: "Instagram", icon: Instagram },
  { href: "/audit", label: "Auditoría", icon: BarChart3 },
  { href: "/content", label: "Plan de Contenido", icon: ListVideo },
  { href: "/avatars", label: "Avatares", icon: Users },
  { href: "/videos", label: "Videos", icon: Video },
  { href: "/captions", label: "Caption Studio", icon: Sparkles },
  { href: "/automation", label: "Automatización", icon: Zap },
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
  const logout = useLogout()
  const queryClient = useQueryClient()

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        queryClient.clear()
      },
    })
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
            className="md:hidden p-1.5 rounded-md text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
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
      
      {/* User session footer */}
      <div className="p-4 border-t border-sidebar-border space-y-2">
        {/* Logged-in user */}
        {authData?.user && (
          <div className="flex items-center justify-between gap-2 bg-sidebar-accent/30 px-3 py-2.5 rounded-lg">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-3.5 h-3.5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-sidebar-foreground truncate">
                  {authData.user.username}
                </p>
                <p className="text-[10px] text-sidebar-foreground/50 capitalize">
                  {authData.user.role}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={logout.isPending}
              title="Cerrar sesión"
              className="p-1.5 rounded-md text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* System status */}
        <div className="flex items-center gap-3 bg-sidebar-accent/30 p-3 rounded-lg">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <div className="text-xs font-medium text-sidebar-foreground/80">
            Sistema en línea
          </div>
        </div>

        {/* Legal links */}
        <div className="flex items-center justify-center gap-3 pt-1">
          <Link href="/privacy" onClick={onClose} className="text-[10px] text-sidebar-foreground/40 hover:text-sidebar-foreground/70 transition-colors">
            Privacidad
          </Link>
          <span className="text-sidebar-foreground/20 text-[10px]">·</span>
          <Link href="/terms" onClick={onClose} className="text-[10px] text-sidebar-foreground/40 hover:text-sidebar-foreground/70 transition-colors">
            Términos
          </Link>
        </div>
      </div>
    </aside>
  )
}
