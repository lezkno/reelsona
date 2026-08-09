import * as React from "react"
import { useState } from "react"
import { Link } from "wouter"
import { Sidebar } from "./Sidebar"
import { WelcomeModal } from "@/components/WelcomeModal"
import { Menu, AlertTriangle, Clock } from "lucide-react"
import { useEntitlement } from "@/hooks/useEntitlement"
import { cn } from "@/lib/utils"

// ── Access alert banner ───────────────────────────────────────────────────────

function AccessBanner() {
  const { data } = useEntitlement()

  // Nothing to show for admins, loading state, or users with active access > 7 days
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

      {/* Main content */}
      <main className="flex-1 flex flex-col h-full overflow-y-auto min-w-0">
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center gap-3 px-4 h-14 border-b bg-sidebar shrink-0">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Reelsona" className="w-7 h-7 object-contain" />
            <span className="font-display font-bold text-sidebar-foreground tracking-tight">Reelsona</span>
          </div>
        </div>

        {/* Access alert banner — only visible when expiring soon or expired */}
        <AccessBanner />

        <div className="flex-1 w-full max-w-6xl mx-auto p-4 md:p-8 relative">
          {children}
        </div>
      </main>

      <WelcomeModal />
    </div>
  )
}
