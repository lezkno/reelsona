import * as React from "react"
import { useState } from "react"
import { Link, useLocation } from "wouter"
import { Sidebar } from "./Sidebar"
import { WelcomeModal } from "@/components/WelcomeModal"
import { Menu, AlertTriangle, Clock } from "lucide-react"
import { useEntitlement } from "@/hooks/useEntitlement"
import { useAuthStatus } from "@workspace/api-client-react"
import { cn } from "@/lib/utils"

// ── Top bar ───────────────────────────────────────────────────────────────────

function TopBar({ onMenuOpen }: { onMenuOpen: () => void }) {
  const { data: authData } = useAuthStatus()

  const user = authData?.user
  const displayName = user ? (user.fullName || user.username) : ""
  const initials = displayName
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  return (
    <header className="h-14 md:h-16 shrink-0 flex items-center gap-3 px-4 md:px-6 bg-sidebar text-sidebar-foreground border-b border-sidebar-border">
      {/* ── Mobile: hamburger + logo ── */}
      <button
        type="button"
        onClick={onMenuOpen}
        aria-label="Abrir menú"
        className="md:hidden min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
      >
        <Menu className="w-5 h-5" />
      </button>

      <div className="md:hidden flex items-center gap-2">
        <img src="/logo.png" alt="Reelsona" className="w-7 h-7 object-contain" />
        <span className="font-display font-bold text-sidebar-foreground tracking-tight">Reelsona</span>
      </div>

      {/* ── Spacer ── */}
      <div className="flex-1" />

      {/* ── User profile (top right) ── */}
      {user && (
        <Link
          href="/profile"
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-sidebar-accent/50 transition-colors group"
        >
          {/* Name + email — desktop only */}
          <div className="hidden md:flex flex-col items-end">
            <span className="text-xs font-semibold text-sidebar-foreground leading-tight truncate max-w-[160px]">
              {displayName}
            </span>
            {user.email && (
              <span className="text-[10px] text-sidebar-foreground/50 truncate max-w-[160px]">
                {user.email}
              </span>
            )}
          </div>

          {/* Avatar */}
          <div className="w-8 h-8 rounded-full overflow-hidden bg-primary/20 flex items-center justify-center shrink-0 text-primary text-xs font-bold ring-1 ring-sidebar-border group-hover:ring-primary/40 transition-all">
            {user.avatarUrl
              ? <img src={`/api/storage${user.avatarUrl}`} alt={displayName} className="w-full h-full object-cover" />
              : <span>{initials}</span>
            }
          </div>
        </Link>
      )}
    </header>
  )
}

// ── Access alert banner ───────────────────────────────────────────────────────

function AccessBanner() {
  const { data } = useEntitlement()

  if (!data || data.isAdmin) return null
  if (data.toolAccessActive && (data.daysRemaining === null || data.daysRemaining > 7)) return null

  const isExpired = !data.toolAccessActive

  return (
    <div className={cn(
      "shrink-0 flex items-center gap-3 px-4 py-2.5 text-sm font-medium",
      isExpired
        ? "bg-destructive/10 text-destructive border-b border-destructive/20"
        : "bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 border-b border-amber-200 dark:border-amber-800/40"
    )}>
      {isExpired
        ? <AlertTriangle className="w-4 h-4 shrink-0" />
        : <Clock className="w-4 h-4 shrink-0" />
      }
      <span className="flex-1 min-w-0">
        {isExpired ? (
          <>
            Tu acceso a la herramienta venció.{" "}
            {data.courseAccess && (
              <Link href="/course" className="underline underline-offset-2 hover:no-underline">
                Puedes seguir accediendo al curso →
              </Link>
            )}
          </>
        ) : (
          <>
            Tu acceso vence en{" "}
            <strong>
              {data.daysRemaining === 0
                ? "hoy"
                : `${data.daysRemaining} día${data.daysRemaining !== 1 ? "s" : ""}`}
            </strong>.{" "}
            <a href="mailto:info@reelsona.com" className="underline underline-offset-2 hover:no-underline">
              Contacta a tu asesor para renovar
            </a>
          </>
        )}
      </span>
    </div>
  )
}

// ── Layout ────────────────────────────────────────────────────────────────────

export function Layout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — always visible on md+, drawer on mobile */}
      <div
        className={`fixed inset-y-0 left-0 z-40 md:relative md:flex md:translate-x-0 transition-transform duration-300 ease-in-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Main content column */}
      <main className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
        {/* Top bar — all sizes */}
        <TopBar onMenuOpen={() => setSidebarOpen(true)} />

        {/* Access alert banner */}
        <AccessBanner />

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          <div className="w-full max-w-6xl mx-auto p-4 md:p-8 relative">
            {children}
          </div>
        </div>
      </main>

      <WelcomeModal />
    </div>
  )
}
