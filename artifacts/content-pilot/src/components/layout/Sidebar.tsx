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
} from "lucide-react"

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

export function Sidebar() {
  const [location] = useLocation()

  return (
    <aside className="w-64 shrink-0 bg-sidebar text-sidebar-foreground flex flex-col h-full border-r border-sidebar-border relative z-20">
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold shadow-[0_0_15px_rgba(100,50,255,0.4)]">
            CP
          </div>
          <span className="font-display font-bold text-xl tracking-tight">ContentPilot</span>
        </div>
      </div>
      
      <nav className="flex-1 overflow-y-auto py-6 px-3 flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive = location === item.href
          
          return (
            <Link
              key={item.href}
              href={item.href}
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
      </nav>
      
      <div className="p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3 bg-sidebar-accent/30 p-3 rounded-lg">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <div className="text-xs font-medium text-sidebar-foreground/80">
            Sistema en línea
          </div>
        </div>
      </div>
    </aside>
  )
}
