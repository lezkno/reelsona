/**
 * PlanCheckoutModal — Reelsona embedded Stripe Checkout.
 *
 * Landing (unauthenticated): collect name/email first, then mount Stripe Checkout.
 * Billing/topups (authenticated): email comes from the account; Checkout mounts
 * after the user confirms the purchase. Payment stays inside Reelsona.
 *
 * Architecture invariant (Stripe requirement):
 *   One EmbeddedCheckoutProvider must be mounted with a STABLE `options` object
 *   for its entire lifetime. Changing `options` on a mounted provider causes the
 *   "multiple Embedded Checkout objects" error.
 *
 *   We enforce this by delegating the provider to a child component
 *   (EmbeddedCheckoutPane) that receives immutable primitive props and builds a
 *   single stable `{ fetchClientSecret }` options object internally. The parent
 *   controls the lifetime by mounting/unmounting the pane via `identity` state.
 *   Clicking "Volver" sets identity=null → pane unmounts → Stripe cleans up →
 *   next Continue creates a fresh pane.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { ArrowLeft, Crown, Loader2, ShieldCheck, Sparkles, X, Zap } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface PlanCheckoutConfig {
  planSlug: string;
  planName: string;
  amountCents: number;
  currency: string;
  credits: number;
  interval: string | null;
  requireEmail?: boolean;
  email?: string;
}

interface Props {
  config: PlanCheckoutConfig | null;
  onClose: () => void;
}

type CheckoutIdentity = { email: string; fullName: string };

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

function PlanIcon({ slug }: { slug: string }) {
  if (slug === "founder") return <Crown size={20} className="text-amber-500" />;
  if (slug === "pro") return <Sparkles size={20} className="text-violet-500" />;
  return <Zap size={20} className="text-blue-500" />;
}

// ---------------------------------------------------------------------------
// EmbeddedCheckoutPane — one instance per checkout attempt.
//
// Props are primitive strings so they are stable (no object identity churn).
// fetchClientSecret and options are created once and never mutated while the
// provider is alive.
// ---------------------------------------------------------------------------
function EmbeddedCheckoutPane({
  planSlug,
  email,
  fullName,
  stripePromise,
}: {
  planSlug: string;
  email: string;
  fullName: string;
  stripePromise: Promise<Stripe | null>;
}) {
  const fetchClientSecret = useCallback(async () => {
    const res = await fetch(`${BASE}/api/checkout/create-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        planSlug,
        email: email || undefined,
        fullName: fullName || undefined,
        embedded: true,
      }),
    });

    const data = (await res.json()) as {
      clientSecret?: string;
      error?: string;
      message?: string;
    };

    if (!res.ok || !data.clientSecret) {
      throw new Error(data.message ?? data.error ?? "No se pudo iniciar el pago");
    }

    return data.clientSecret;
  // planSlug / email / fullName are primitive strings — stable across renders.
  }, [planSlug, email, fullName]);

  // useMemo ensures the options object reference never changes while mounted.
  const options = useMemo(() => ({ fetchClientSecret }), [fetchClientSecret]);

  return (
    <div className="min-h-[420px] overflow-hidden rounded-xl bg-white">
      <EmbeddedCheckoutProvider stripe={stripePromise} options={options}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PlanCheckoutModal — parent shell.
// ---------------------------------------------------------------------------
export function PlanCheckoutModal({ config, onClose }: Props) {
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [stripeError, setStripeError] = useState<string | null>(null);
  const [email, setEmail] = useState(config?.email ?? "");
  const [fullName, setFullName] = useState("");
  // identity !== null ↔ EmbeddedCheckoutPane is mounted.
  const [identity, setIdentity] = useState<CheckoutIdentity | null>(null);

  // Reset form whenever the plan slug changes (new modal open).
  useEffect(() => {
    if (!config) return;
    setEmail(config.email ?? "");
    setFullName("");
    setIdentity(null);
    setStripeError(null);
  }, [config?.planSlug]);

  // Load Stripe.js once per modal open; cache the promise.
  useEffect(() => {
    if (!config || stripePromise) return;
    fetch(`${BASE}/api/config/public`, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error("No se pudo cargar la configuración de Stripe");
        return r.json() as Promise<{ stripePublishableKey?: string | null }>;
      })
      .then(({ stripePublishableKey }) => {
        if (!stripePublishableKey)
          throw new Error("Stripe no está configurado para este entorno");
        setStripePromise(loadStripe(stripePublishableKey));
      })
      .catch((err: Error) => setStripeError(err.message));
  }, [config, stripePromise]);

  const canContinue = email.trim().includes("@");
  const showCheckout = identity !== null;

  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!config || !canContinue) return;
    setIdentity({
      email: email.trim().toLowerCase(),
      fullName: fullName.trim(),
    });
  };

  const handleBack = () => {
    // Setting identity to null unmounts EmbeddedCheckoutPane → Stripe cleans up.
    setIdentity(null);
  };

  if (!config) return null;

  const intervalLabel =
    config.interval === "month" ? "/mes" : config.interval === "year" ? "/año" : "";
  const isTopup = config.planSlug.startsWith("topup");

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/90 backdrop-blur-xl p-4 sm:p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-[#0d0d0d] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2">
            <img src={`${BASE}/logo.png`} alt="Reelsona" className="h-6 w-6 object-contain" />
            <span className="font-semibold text-white">Reelsona</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/5 hover:text-foreground"
          >
            <X size={17} />
          </button>
        </div>

        {/* Plan summary */}
        <div className="border-b border-white/10 bg-gradient-to-r from-blue-500/5 to-violet-500/5 px-5 py-4">
          <div className="mb-1 flex items-center gap-2">
            <PlanIcon slug={config.planSlug} />
            <span className="font-semibold">{config.planName}</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold text-amber-400">
              {formatPrice(config.amountCents, config.currency)}
            </span>
            {intervalLabel && (
              <span className="text-sm text-amber-400/70">{intervalLabel}</span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {isTopup
              ? `${config.credits.toLocaleString()} créditos adicionales · nunca vencen`
              : `${config.credits.toLocaleString()} créditos incluidos`}
          </p>
        </div>

        {/* Body */}
        {!showCheckout ? (
          /* ── Step 1: collect name + email ── */
          <form onSubmit={handleContinue} className="space-y-4 p-5">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Nombre completo
              </label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Tu nombre"
                autoComplete="name"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-blue-500"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                required
                autoComplete="email"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-blue-500"
              />
            </div>

            {stripeError && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-400">
                {stripeError}
              </div>
            )}

            <button
              type="submit"
              disabled={!canContinue || !!stripeError || !stripePromise}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {!stripePromise && !stripeError ? (
                <Loader2 size={16} className="animate-spin" />
              ) : null}
              Continuar al pago
            </button>

            <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck size={13} /> Pago seguro procesado por Stripe dentro de Reelsona
            </div>
          </form>
        ) : (
          /* ── Step 2: Stripe Embedded Checkout ── */
          <div className="p-4 sm:p-5">
            <button
              type="button"
              onClick={handleBack}
              className="mb-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft size={13} /> Volver
            </button>

            {stripePromise ? (
              <EmbeddedCheckoutPane
                planSlug={config.planSlug}
                email={identity.email}
                fullName={identity.fullName}
                stripePromise={stripePromise}
              />
            ) : (
              <div className="flex min-h-[320px] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
