/**
 * Billing page — /billing
 *
 * Shows the current subscription, credit breakdown, available upgrade/downgrade
 * controls, and topup packs. Subscribed users use the inline change-plan flow
 * or the Stripe Billing Portal; new users go through the hosted checkout.
 */

import { useState, useRef } from "react"
import { Input } from "@/components/ui/input"
import {
  useBilling,
  useChangePlan,
  useCancelPlanChange,
  useOpenPortal,
  useInvoices,
  useCancelSubscription,
  useCreditsHistory,
  type ChangePlanResult,
  type InvoiceItem,
  type CreditLedgerEntryRow,
} from "@workspace/api-client-react"
import { useAuthStatus } from "@workspace/api-client-react"
import { PlanCheckoutModal, type PlanCheckoutConfig } from "@/components/PlanCheckoutModal"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Coins, Crown, Sparkles, Zap, ArrowRight, CheckCircle2, Calendar,
  TrendingUp, TrendingDown, ShoppingBag, Infinity, RefreshCw, AlertCircle,
  Clock, ExternalLink, Loader2, Info, Receipt, CreditCard, XCircle,
  ChevronLeft, ChevronRight, History,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(new Date(iso))
}

function fmtPrice(cents: number, currency: string, interval: string | null): string {
  const price = new Intl.NumberFormat("es-MX", {
    style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: 0,
  }).format(cents / 100)
  const suffix = interval === "month" ? "/mes" : interval === "year" ? "/año" : ""
  return price + suffix
}

// ── Plan meta ─────────────────────────────────────────────────────────────────

const PLAN_META: Record<string, { label: string; color: string; accent: string; icon: React.ReactNode; features: string[] }> = {
  basic: {
    label:   "Basic",
    color:   "text-blue-400 bg-blue-500/10 border-blue-500/20",
    accent:  "from-blue-500 to-cyan-500",
    icon:    <Zap className="w-5 h-5" />,
    features: [
      "400 créditos/mes",
      "1 Avatar AI propio",
      "3 looks iniciales incluidos",
      "Avatares públicos",
      "Primera voz clonada incluida",
      "Caption Studio",
      "B-roll AI",
      "Plan de contenido con IA",
      "Creación manual de Reels",
      "Publicación manual",
      "Compra de créditos adicionales",
    ],
  },
  pro: {
    label:   "Pro",
    color:   "text-violet-400 bg-violet-500/10 border-violet-500/20",
    accent:  "from-violet-500 to-purple-600",
    icon:    <Sparkles className="w-5 h-5" />,
    features: [
      "1,500 créditos/mes",
      "Todo lo de Basic",
      "Hasta 3 Avatares AI propios",
      "3 looks iniciales por avatar",
      "AutoPilot",
      "Programación y publicación automática",
      "Funciones avanzadas de automatización",
    ],
  },
  founder: {
    label:   "Founder",
    color:   "text-amber-400 bg-amber-500/10 border-amber-500/20",
    accent:  "from-amber-400 to-orange-500",
    icon:    <Crown className="w-5 h-5" />,
    features: [
      "Todo lo incluido en Pro",
      "Mentoría estratégica 1 a 1 de bienvenida",
      "Acceso al grupo privado de Founders",
      "Soporte prioritario por WhatsApp",
      "Acceso anticipado a nuevas funciones",
      "Precio Founder protegido mientras mantenga su membresía",
      "Máximo 10 plazas",
    ],
  },
}

const TOPUP_META: Record<string, { label: string; popular?: boolean }> = {
  "topup-300":  { label: "Pack 300 cr" },
  "topup-600":  { label: "Pack 600 cr", popular: true },
  "topup-1200": { label: "Pack 1,200 cr" },
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    active:    { label: "Activa",       cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
    trialing:  { label: "Trial",        cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
    past_due:  { label: "Pago vencido", cls: "bg-red-500/10 text-red-400 border-red-500/20" },
    canceled:  { label: "Cancelada",    cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20" },
  }
  const info = map[status] ?? { label: status, cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20" }
  return (
    <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border", info.cls)}>
      {info.label}
    </span>
  )
}

// ── Credit bar ────────────────────────────────────────────────────────────────

function CreditBar({
  label, value, total, color,
}: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">{value.toLocaleString()} cr</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ── Pending downgrade notice with cancel action ───────────────────────────────

function PendingDowngradeNotice({ sub }: { sub: NonNullable<ReturnType<typeof useBilling>["data"]>["subscription"] }) {
  const cancelMutation = useCancelPlanChange()
  const [cancelError, setCancelError] = useState<string | null>(null)

  if (!sub) return null

  const handleCancel = async () => {
    setCancelError(null)
    try {
      await cancelMutation.mutateAsync()
    } catch (err: any) {
      setCancelError(err?.error ?? err?.message ?? "No se pudo cancelar el cambio. Intentá de nuevo.")
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-400">
        <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p>
            Cambio a <strong>Basic</strong> programado para el {fmtDate(sub.currentPeriodEnd)}.
            Seguís con acceso Pro hasta esa fecha.
          </p>
          {cancelError && (
            <p className="mt-1 text-red-400">{cancelError}</p>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0 h-6 px-2 text-xs text-amber-300 hover:text-amber-200 hover:bg-amber-500/10"
          onClick={handleCancel}
          disabled={cancelMutation.isPending}
        >
          {cancelMutation.isPending ? "Cancelando…" : "Cancelar cambio"}
        </Button>
      </div>
    </div>
  )
}

// ── Inline feedback banner ────────────────────────────────────────────────────

function FeedbackBanner({
  result,
  error,
  onDismiss,
}: {
  result:    ChangePlanResult | null;
  error:     string | null;
  onDismiss: () => void;
}) {
  if (!result && !error) return null

  if (error) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
        <div className="flex-1">{error}</div>
        <button onClick={onDismiss} className="text-red-400/60 hover:text-red-400 text-xs">✕</button>
      </div>
    )
  }

  if (result?.type === "upgrade") {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-400">
        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
        <div className="flex-1">
          <span className="font-semibold">¡Upgrade a Pro exitoso!</span> Tus créditos ya fueron actualizados a 1,500.
        </div>
        <button onClick={onDismiss} className="text-emerald-400/60 hover:text-emerald-400 text-xs">✕</button>
      </div>
    )
  }

  if (result?.type === "downgrade") {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-400">
        <Clock className="w-4 h-4 shrink-0 mt-0.5" />
        <div className="flex-1">
          <span className="font-semibold">Cambio a Basic programado</span> — se aplicará el {fmtDate(result.effectiveDate ?? null)}.
          Seguís con acceso Pro hasta esa fecha.
        </div>
        <button onClick={onDismiss} className="text-amber-400/60 hover:text-amber-400 text-xs">✕</button>
      </div>
    )
  }

  return null
}

// ── Current plan card ─────────────────────────────────────────────────────────

function CurrentPlanCard({
  data,
  onChangePlan,
  isChangingPlan,
}: {
  data:          ReturnType<typeof useBilling>["data"];
  onChangePlan:  (target: "basic" | "pro") => void;
  isChangingPlan: boolean;
}) {
  const sub = data?.subscription
  const portalMutation   = useOpenPortal()
  const cancelMutation   = useCancelSubscription()
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const { toast } = useToast()

  const openPortal = (flow?: "payment_method_update") => {
    portalMutation.mutate(flow ? { flow } : undefined, {
      onError: (err: any) => {
        const code = err?.data?.code as string | undefined;
        const description =
          code === "no_customer"
            ? "Este plan no tiene un cliente de pago registrado en Stripe. Contacta a soporte si necesitas ayuda con tu facturación."
            : (err?.data?.message ?? err?.data?.error ?? "Intenta de nuevo en unos minutos.");
        toast({
          title: "No se pudo abrir el portal",
          description,
          variant: "destructive",
        })
      },
    })
  }

  const isActive = !!sub && ["active", "trialing"].includes(sub.status ?? "")

  if (!sub) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-6 text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">Sin suscripción activa</p>
          <p className="text-xs text-muted-foreground">Elige un plan abajo para activar tu cuenta.</p>
        </CardContent>
      </Card>
    )
  }

  const meta    = PLAN_META[sub.planSlug] ?? PLAN_META.basic
  const isBasic = sub.planSlug === "basic"
  const isPro   = sub.planSlug === "pro"

  return (
    <Card className="overflow-hidden">
      <div className={cn("h-1 w-full bg-gradient-to-r", meta.accent)} />
      <CardContent className="p-6 space-y-4">

        {/* Plan header row */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", meta.color)}>
              {meta.icon}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-display font-bold text-lg">{meta.label}</h3>
                <StatusBadge status={sub.status} />
                {sub.cancelAtPeriodEnd && !sub.pendingPlanSlug && (
                  <span className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-full px-2 py-0.5">
                    No renueva
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {sub.planSlug === "founder"
                  ? `Mes ${sub.founderMonthsGranted ?? 0} de 12 · ${sub.founderMonthsRemaining ?? 0} restantes${sub.nextFounderGrantAt ? ` · próxima renovación ${fmtDate(sub.nextFounderGrantAt)}` : ""}`
                  : sub.currentPeriodEnd
                    ? (sub.pendingPlanSlug
                        ? `Acceso Pro hasta el ${fmtDate(sub.currentPeriodEnd)}`
                        : `Renueva el ${fmtDate(sub.currentPeriodEnd)}`)
                    : ""}
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {/* Upgrade Basic → Pro */}
            {isBasic && (
              <Button
                size="sm"
                onClick={() => onChangePlan("pro")}
                disabled={isChangingPlan}
                className="gap-1.5"
              >
                {isChangingPlan
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <TrendingUp className="w-3.5 h-3.5" />}
                Subir a Pro
              </Button>
            )}

            {/* Downgrade Pro → Basic (only if no pending change already) */}
            {isPro && !sub.pendingPlanSlug && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onChangePlan("basic")}
                disabled={isChangingPlan}
                className="gap-1.5 text-muted-foreground"
              >
                {isChangingPlan
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <TrendingDown className="w-3.5 h-3.5" />}
                Bajar a Basic
              </Button>
            )}

            {/* Stripe Customer Portal — subscription management */}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => openPortal()}
              disabled={portalMutation.isPending}
              className="gap-1.5 text-muted-foreground"
            >
              {portalMutation.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <ExternalLink className="w-3.5 h-3.5" />}
              Administrar suscripción
            </Button>

            {/* Change payment method — deep-links to the portal's payment-method form */}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => openPortal("payment_method_update")}
              disabled={portalMutation.isPending}
              className="gap-1.5 text-muted-foreground"
            >
              <CreditCard className="w-3.5 h-3.5" />
              Cambiar método de pago
            </Button>

            {/* Cancel subscription — only when active and not already canceling */}
            {isActive && !sub!.cancelAtPeriodEnd && !sub!.pendingPlanSlug && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowCancelDialog(true)}
                disabled={cancelMutation.isPending}
                className="gap-1.5 text-muted-foreground hover:text-destructive"
              >
                <XCircle className="w-3.5 h-3.5" />
                Cancelar suscripción
              </Button>
            )}
          </div>
        </div>

        {/* Cancel confirmation dialog */}
        <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>¿Cancelar tu suscripción?</DialogTitle>
              <DialogDescription className="pt-1">
                Mantendrás acceso a Reelsona hasta el final de tu período de facturación
                actual. Tus proyectos, videos, avatares y créditos adicionales permanecerán
                guardados.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                onClick={() => setShowCancelDialog(false)}
                disabled={cancelMutation.isPending}
                className="sm:mr-auto"
              >
                Mantener mi plan
              </Button>
              <Button
                variant="destructive"
                disabled={cancelMutation.isPending}
                onClick={() => {
                  cancelMutation.mutate(undefined, {
                    onSuccess: () => setShowCancelDialog(false),
                  })
                }}
              >
                {cancelMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
                Cancelar al finalizar el período
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Pending downgrade notice + cancel action */}
        {sub.pendingPlanSlug && <PendingDowngradeNotice sub={sub} />}

        {/* Cancellation notice */}
        {sub.cancelAtPeriodEnd && !sub.pendingPlanSlug && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5 text-xs text-red-400">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              Tu suscripción se cancelará el <strong>{fmtDate(sub.currentPeriodEnd)}</strong>.
              Podés reactivarla desde "Administrar".
            </span>
          </div>
        )}

        {/* Period row — shown for all plans, annual label for Founder */}
        {sub.currentPeriodEnd && !sub.pendingPlanSlug && (
          <div className="pt-1 flex items-center gap-2 text-xs text-muted-foreground border-t border-border">
            <Calendar className="w-3.5 h-3.5" />
            <span>
              {sub.planSlug === "founder" ? "Período anual" : "Período"}:{" "}
              {fmtDate(sub.currentPeriodStart)} – {fmtDate(sub.currentPeriodEnd)}
            </span>
          </div>
        )}

        {/* Founder monthly grant progress */}
        {sub.planSlug === "founder" && typeof sub.founderMonthsGranted === "number" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Coins className="w-3.5 h-3.5 shrink-0" />
            <span>
              Créditos mensuales: {sub.founderMonthsGranted}/12 otorgados
              {typeof sub.founderMonthsRemaining === "number" && sub.founderMonthsRemaining > 0 && (
                <>
                  {" · "}{sub.founderMonthsRemaining} restantes
                  {sub.nextFounderGrantAt && (
                    <> · próximo {fmtDate(sub.nextFounderGrantAt)}</>
                  )}
                </>
              )}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Credits card ──────────────────────────────────────────────────────────────
// Always renders — even if the user has no wallet or 0 credits.

function CreditsCard({
  data,
  isAdmin,
  hasActiveSub,
}: {
  data:         ReturnType<typeof useBilling>["data"];
  isAdmin:      boolean;
  hasActiveSub: boolean;
}) {
  // Use zero fallback so the card always renders, even before wallet is created
  const credits = data?.credits ?? {
    available: 0, subscription: 0, purchased: 0, reserved: 0, totalConsumed: 0,
  }
  const [historyOpen, setHistoryOpen] = useState(false)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Coins className="w-4 h-4 text-primary" />
          Créditos
        </CardTitle>
        <CardDescription className="text-xs">
          Los créditos de suscripción se renuevan cada ciclo; los adicionales comprados nunca vencen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAdmin ? (
          <div className="flex items-center gap-3">
            <Infinity className="w-9 h-9 text-emerald-500" />
            <p className="text-sm text-muted-foreground">Admin — créditos ilimitados</p>
          </div>
        ) : (
          <>
            {/* Main metric */}
            <div className="flex items-end gap-2">
              <span className="text-5xl font-display font-bold tabular-nums">
                {credits.available.toLocaleString()}
              </span>
              <span className="text-sm text-muted-foreground mb-1.5">créditos disponibles</span>
            </div>

            {/* Breakdown table */}
            <div className="divide-y divide-border rounded-lg border bg-muted/20 overflow-hidden text-sm">
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-muted-foreground">Créditos del plan</span>
                <span className={cn(
                  "font-semibold tabular-nums",
                  !hasActiveSub && credits.subscription > 0 && "text-muted-foreground/50",
                )}>
                  {credits.subscription.toLocaleString()}
                  {!hasActiveSub && credits.subscription > 0 && (
                    <span className="ml-1.5 text-[10px] font-normal tracking-wide uppercase opacity-70">requieren plan</span>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-muted-foreground">Créditos adicionales</span>
                <span className="font-semibold tabular-nums">{credits.purchased.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-muted-foreground">Reservados</span>
                <span className="font-semibold tabular-nums text-muted-foreground">{credits.reserved.toLocaleString()}</span>
              </div>
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-muted/40 transition-colors cursor-pointer"
                data-testid="button-credits-consumed"
              >
                <span className="text-muted-foreground flex items-center gap-1.5">
                  Consumidos
                  <History className="w-3.5 h-3.5 opacity-60" />
                </span>
                <span className="font-semibold tabular-nums flex items-center gap-1">
                  {credits.totalConsumed.toLocaleString()}
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                </span>
              </button>
            </div>

            <CreditsHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />

            {/* No-plan + purchased credits: saved-credits notice */}
            {!hasActiveSub && credits.purchased > 0 && (
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400">
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
                <span>
                  Tus créditos adicionales están guardados.{" "}
                  Activa un plan para volver a utilizarlos.
                </span>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ── Credits history dialog ────────────────────────────────────────────────────

const LEDGER_TYPE_LABEL: Record<string, string> = {
  provision:  "Acreditación",
  reserve:    "Reserva",
  consume:    "Consumo",
  release:    "Devolución",
  adjustment: "Ajuste",
}

function ledgerDescription(e: CreditLedgerEntryRow): string {
  if (e.description) return e.description
  const base = LEDGER_TYPE_LABEL[e.type] ?? e.type
  if (e.feature === "broll") return `${base} — B-roll AI`
  if (e.videoId != null) return `${base} — video #${e.videoId}`
  return base
}

function CreditsHistoryDialog({
  open,
  onOpenChange,
}: {
  open:         boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [page, setPage] = useState(1)
  const [from, setFrom] = useState("")
  const [to, setTo]     = useState("")

  // Convert bare YYYY-MM-DD inputs to the user's LOCAL day boundaries as ISO
  // instants, so the server filter matches the calendar dates the user sees.
  const fromInstant = from ? new Date(`${from}T00:00:00`).toISOString() : null
  const toInstant   = to   ? new Date(`${to}T23:59:59.999`).toISOString() : null

  const { data, isLoading, isError } = useCreditsHistory(
    { page, from: fromInstant, to: toInstant },
    open,
  )

  const total      = data?.total ?? 0
  const pageSize   = data?.pageSize ?? 20
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const setDateFilter = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value)
    setPage(1)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-4 h-4 text-primary" />
            Historial de créditos
          </DialogTitle>
          <DialogDescription>
            Cada movimiento de tu saldo: acreditaciones, reservas, consumos y devoluciones.
          </DialogDescription>
        </DialogHeader>

        {/* Date range filter */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="history-from">Desde</label>
            <Input
              id="history-from"
              type="date"
              value={from}
              onChange={setDateFilter(setFrom)}
              className="h-8 w-[150px]"
              data-testid="input-history-from"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="history-to">Hasta</label>
            <Input
              id="history-to"
              type="date"
              value={to}
              onChange={setDateFilter(setTo)}
              className="h-8 w-[150px]"
              data-testid="input-history-to"
            />
          </div>
          {(from || to) && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => { setFrom(""); setTo(""); setPage(1) }}
              data-testid="button-history-clear-filter"
            >
              Limpiar filtro
            </Button>
          )}
        </div>

        {/* Entries */}
        <div className="flex-1 overflow-y-auto min-h-[200px]">
          {isLoading ? (
            <div className="space-y-2 py-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <AlertCircle className="w-6 h-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No pudimos cargar el historial. Intenta de nuevo.</p>
            </div>
          ) : !data?.entries.length ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Receipt className="w-6 h-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {from || to ? "Sin movimientos en el rango seleccionado." : "Aún no tienes movimientos de créditos."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border rounded-lg border overflow-hidden">
              {data.entries.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm" data-testid={`row-history-${e.id}`}>
                  <div className="min-w-0">
                    <p className="truncate">{ledgerDescription(e)}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(e.createdAt))}
                    </p>
                  </div>
                  <span className={cn(
                    "font-semibold tabular-nums shrink-0",
                    e.amount > 0 ? "text-emerald-500" : e.amount < 0 ? "text-foreground" : "text-muted-foreground",
                  )}>
                    {e.amount > 0 ? "+" : ""}{e.amount.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-muted-foreground" data-testid="text-history-pagination">
            {total > 0
              ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} de ${total.toLocaleString()}`
              : "0 movimientos"}
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              data-testid="button-history-prev"
            >
              <ChevronLeft className="w-4 h-4" /> Anterior
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums">{page} / {totalPages}</span>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={page >= totalPages || isLoading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              data-testid="button-history-next"
            >
              Siguiente <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Plan cards grid ───────────────────────────────────────────────────────────

function PlansSection({
  data,
  isCurrentSlug,
  hasActiveSub,
  userEmail,
  onSelect,
  onChangePlan,
  isChangingPlan,
  refetch,
}: {
  data:           ReturnType<typeof useBilling>["data"];
  isCurrentSlug:  string | null;
  hasActiveSub:   boolean;
  userEmail:      string | undefined;
  onSelect:       (cfg: PlanCheckoutConfig) => void;
  onChangePlan:   (target: "basic" | "pro") => void;
  isChangingPlan: boolean;
  refetch:        () => void;
}) {
  if (!data?.plans?.length) {
    return (
      <div>
        <h2 className="font-display font-bold text-lg mb-4">Planes de suscripción</h2>
        <Card>
          <CardContent className="p-8 flex flex-col items-center gap-3 text-center">
            <AlertCircle className="w-8 h-8 text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-sm font-medium">No pudimos cargar los planes</p>
              <p className="text-xs text-muted-foreground">Intenta nuevamente en unos segundos.</p>
            </div>
            <Button size="sm" variant="outline" onClick={refetch} className="gap-1.5 mt-1">
              <RefreshCw className="w-3.5 h-3.5" /> Reintentar
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <h2 className="font-display font-bold text-lg mb-4">Planes de suscripción</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.plans.map((plan) => {
          const meta      = PLAN_META[plan.slug] ?? PLAN_META.basic
          const isCurrent = plan.slug === isCurrentSlug
          const isFounder = plan.slug === "founder"
          const seatsLeft = isFounder ? (data.founderSeatsLeft ?? 0) : null
          // For active basic/pro subscribers, plan change replaces checkout
          const useChangePlanFlow = hasActiveSub && !isFounder && !isCurrent

          return (
            <Card
              key={plan.slug}
              className={cn(
                "relative overflow-hidden transition-all",
                isCurrent && "ring-2 ring-primary",
                isFounder && "ring-1 ring-amber-500/30",
              )}
            >
              <div className={cn("h-1 w-full bg-gradient-to-r", meta.accent)} />
              <CardContent className="p-5 flex flex-col gap-4">
                {/* Plan header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn("p-1.5 rounded-lg", meta.color)}>{meta.icon}</span>
                    <span className="font-display font-bold">{meta.label}</span>
                  </div>
                  {isCurrent && (
                    <span className="text-xs font-semibold text-primary bg-primary/10 border border-primary/20 rounded-full px-2 py-0.5">
                      Tu plan
                    </span>
                  )}
                  {isFounder && !isCurrent && seatsLeft !== null && seatsLeft <= 3 && (
                    <span className="text-xs font-semibold text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-full px-2 py-0.5">
                      {seatsLeft === 0 ? "Agotado" : `${seatsLeft} lugares`}
                    </span>
                  )}
                </div>

                {/* Price */}
                <div>
                  <span className="text-2xl font-display font-bold">
                    {fmtPrice(plan.amountCents, plan.currency, plan.interval)}
                  </span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {plan.credits.toLocaleString()} créditos
                    {isFounder ? " · 12 meses" : "/mes incluidos"}
                  </p>
                </div>

                {/* Features */}
                <ul className="space-y-1.5 flex-1">
                  {meta.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <Button
                  size="sm"
                  disabled={isCurrent || (isFounder && seatsLeft === 0) || (useChangePlanFlow && isChangingPlan)}
                  onClick={() => {
                    if (useChangePlanFlow) {
                      onChangePlan(plan.slug as "basic" | "pro")
                    } else {
                      onSelect({
                        planSlug:    plan.slug,
                        planName:    meta.label,
                        amountCents: plan.amountCents,
                        currency:    plan.currency,
                        credits:     plan.credits,
                        interval:    plan.interval,
                        email:       userEmail,
                      })
                    }
                  }}
                  className={cn(
                    "w-full gap-1.5",
                    isFounder && !isCurrent && "bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-400 hover:to-orange-400 border-0",
                  )}
                  variant={isCurrent ? "outline" : "default"}
                >
                  {useChangePlanFlow && isChangingPlan
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : null}
                  {isCurrent
                    ? "Plan actual"
                    : (isFounder && seatsLeft === 0)
                      ? "Sin lugares disponibles"
                      : useChangePlanFlow
                        ? (plan.slug === "pro"
                            ? <>Subir a Pro <TrendingUp className="w-3.5 h-3.5" /></>
                            : <>Bajar a Basic <TrendingDown className="w-3.5 h-3.5" /></>)
                        : isFounder
                          ? <>Quiero ser Founder <ArrowRight className="w-3.5 h-3.5" /></>
                          : <>Suscribirse <ArrowRight className="w-3.5 h-3.5" /></>}
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// ── Topup section ─────────────────────────────────────────────────────────────

function TopupsSection({ data, userEmail, onSelect }: {
  data:      ReturnType<typeof useBilling>["data"];
  userEmail: string | undefined;
  onSelect:  (cfg: PlanCheckoutConfig) => void;
}) {
  if (!data?.topups?.length) return null

  const sub = data.subscription
  const hasActiveSub = !!(sub && ["active", "trialing"].includes(sub.status ?? ""))

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <ShoppingBag className="w-4 h-4 text-muted-foreground" />
        <h2 className="font-display font-bold text-lg">Packs de créditos</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Créditos extra que nunca vencen. Ideales para meses de mayor producción.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        {data.topups.map((topup) => {
          const meta = TOPUP_META[topup.slug] ?? { label: topup.slug }
          return (
            <Card key={topup.slug} className={cn("relative overflow-hidden", meta.popular && "ring-1 ring-primary")}>
              {meta.popular && (
                <div className="absolute top-3 right-3">
                  <span className="text-[10px] font-bold text-primary bg-primary/10 border border-primary/20 rounded-full px-2 py-0.5 uppercase tracking-wider">
                    Popular
                  </span>
                </div>
              )}
              <CardContent className="p-5 space-y-4">
                <div>
                  <p className="font-display font-bold">{meta.label}</p>
                  <p className="text-2xl font-bold mt-1">
                    {fmtPrice(topup.amountCents, topup.currency, null)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {(topup.amountCents / topup.credits).toFixed(2)} USD/cr
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-1.5"
                  disabled={!hasActiveSub}
                  onClick={hasActiveSub ? () => onSelect({
                    planSlug:    topup.slug,
                    planName:    meta.label,
                    amountCents: topup.amountCents,
                    currency:    topup.currency,
                    credits:     topup.credits,
                    interval:    null,
                    email:       userEmail,
                  }) : undefined}
                >
                  <Coins className="w-3.5 h-3.5" />
                  Comprar
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground mt-3">
        Los créditos comprados se acumulan y nunca vencen. Se gastan después de los créditos de suscripción.
      </p>
    </div>
  )
}

// ── Invoice history section ───────────────────────────────────────────────────

function fmtUnixDate(ts: number): string {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(new Date(ts * 1000))
}

function invoiceStatusMeta(status: string): { label: string; className: string } {
  const map: Record<string, { label: string; className: string }> = {
    paid:          { label: "Pagado",     className: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" },
    open:          { label: "Pendiente",  className: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
    void:          { label: "Anulada",    className: "text-muted-foreground bg-muted border-border" },
    uncollectible: { label: "Incobrable", className: "text-red-400 bg-red-400/10 border-red-400/20" },
  }
  return map[status] ?? { label: status, className: "text-muted-foreground bg-muted border-border" }
}

function InvoiceRow({ inv }: { inv: InvoiceItem }) {
  const { label, className } = invoiceStatusMeta(inv.status)
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3.5 flex-wrap">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate max-w-xs">{inv.description}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{fmtUnixDate(inv.date)}</p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-sm font-semibold tabular-nums">
          {fmtPrice(inv.amountCents, inv.currency, null)}
        </span>
        <span className={cn("text-[11px] border rounded-full px-2 py-0.5 font-medium", className)}>
          {label}
        </span>
        {inv.receiptUrl && (
          <a
            href={inv.receiptUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            Ver factura
          </a>
        )}
      </div>
    </div>
  )
}

function InvoiceSection() {
  const { data, isLoading } = useInvoices()
  const invoices = data?.invoices ?? []

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Receipt className="w-4 h-4 text-muted-foreground" />
        <h2 className="font-display font-bold text-lg">Historial de pagos</h2>
      </div>

      {isLoading ? (
        <Skeleton className="h-32 w-full rounded-xl" />
      ) : invoices.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-6 text-center">
            <p className="text-sm text-muted-foreground">Aún no tienes pagos registrados.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="divide-y divide-border">
            {invoices.map((inv) => <InvoiceRow key={inv.id} inv={inv} />)}
          </div>
        </Card>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Billing() {
  const { data, isLoading, refetch } = useBilling()
  const { data: authData }  = useAuthStatus()
  const changePlanMutation  = useChangePlan()
  const plansRef            = useRef<HTMLDivElement>(null)
  const [checkoutCfg, setCheckoutCfg] = useState<PlanCheckoutConfig | null>(null)
  const [planFeedback, setPlanFeedback] = useState<{
    result: ChangePlanResult | null;
    error:  string | null;
  }>({ result: null, error: null })

  const userEmail   = authData?.user?.email ?? undefined
  const isAdmin     = authData?.user?.role === "admin"
  const currentSlug = data?.subscription?.planSlug ?? null
  const hasActiveSub = !!data?.subscription && ["active", "trialing"].includes(data.subscription.status)

  const handleChangePlan = async (target: "basic" | "pro") => {
    setPlanFeedback({ result: null, error: null })
    try {
      const result = await changePlanMutation.mutateAsync(target)
      setPlanFeedback({ result, error: null })
    } catch (err: any) {
      const msg = err?.data?.message
        ?? (err?.data?.error as string | undefined)
        ?? err?.message
        ?? "No se pudo cambiar el plan. Intentá de nuevo."
      setPlanFeedback({ result: null, error: msg })
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-8">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl tracking-tight">Facturación</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gestiona tu plan, créditos y pagos.
          </p>
        </div>
        <Button
          size="sm" variant="ghost"
          onClick={() => window.location.reload()}
          className="gap-1.5 text-muted-foreground"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Actualizar
        </Button>
      </div>

      {/* Plan change feedback banner */}
      {(planFeedback.result || planFeedback.error) && (
        <FeedbackBanner
          result={planFeedback.result}
          error={planFeedback.error}
          onDismiss={() => setPlanFeedback({ result: null, error: null })}
        />
      )}

      {/* Admin: unlimited note */}
      {isAdmin && (
        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardContent className="p-4 flex items-center gap-3">
            <Infinity className="w-5 h-5 text-emerald-400 shrink-0" />
            <p className="text-sm text-emerald-400 font-medium">
              Cuenta de administrador — acceso y créditos ilimitados.
            </p>
          </CardContent>
        </Card>
      )}


      {/* Top row: subscription + credits */}
      {!isAdmin && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <h2 className="font-display font-bold text-lg">Suscripción</h2>
            <CurrentPlanCard
              data={data}
              onChangePlan={handleChangePlan}
              isChangingPlan={changePlanMutation.isPending}
            />
          </div>
          <div className="space-y-4">
            <h2 className="font-display font-bold text-lg">Créditos</h2>
            <CreditsCard data={data} isAdmin={isAdmin} hasActiveSub={hasActiveSub} />
          </div>
        </div>
      )}

      {/* Plans — ref used by the no-plan banner CTA to scroll here */}
      {!isAdmin && (
        <div ref={plansRef} className="scroll-mt-6">
        <PlansSection
          data={data}
          isCurrentSlug={currentSlug}
          hasActiveSub={hasActiveSub}
          userEmail={userEmail}
          onSelect={setCheckoutCfg}
          onChangePlan={handleChangePlan}
          isChangingPlan={changePlanMutation.isPending}
          refetch={refetch}
        />
        </div>
      )}

      {/* Topups */}
      {!isAdmin && (
        <TopupsSection data={data} userEmail={userEmail} onSelect={setCheckoutCfg} />
      )}

      {/* Payment history — shown to all users (empty state when no Stripe customer) */}
      {!isAdmin && <InvoiceSection />}

      {/* Checkout modal — used for all purchases: plans (no active sub), Founder, and topup packs */}
      <PlanCheckoutModal config={checkoutCfg} onClose={() => { setCheckoutCfg(null); refetch() }} />
    </div>
  )
}
