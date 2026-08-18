/**
 * PlanCheckoutModal — Reelsona embedded Stripe Payment Element.
 *
 * Uses Stripe Payment Element (not Embedded Checkout) so the payment form
 * renders with Reelsona's own dark theme — no Stripe-hosted iframe.
 *
 * Flow:
 *   1. Collect name + email (or use pre-filled email for authenticated users).
 *   2. Call /api/checkout/create-payment-intent → get clientSecret.
 *   3. Mount Stripe Elements + PaymentElement with clientSecret.
 *   4. User fills card → stripe.confirmPayment() → redirect to /checkout/success.
 *
 * Architecture invariant:
 *   PaymentElementPane is a self-contained child that mounts once per attempt.
 *   Props are stable primitive strings so fetchClientSecret / options are never
 *   mutated while Elements is mounted. Parent controls lifetime via `identity`.
 */

import { useEffect, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { ArrowLeft, Crown, Loader2, ShieldCheck, Sparkles, X, Zap } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Stripe Appearance — Reelsona dark theme ──────────────────────────────────

const STRIPE_APPEARANCE = {
  theme: "night",
  variables: {
    colorPrimary:         "#4F6EF7",
    colorBackground:      "#1a1a1a",
    colorText:            "#ffffff",
    colorTextSecondary:   "rgba(255,255,255,0.5)",
    colorDanger:          "#f87171",
    fontFamily:           "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSizeBase:         "14px",
    borderRadius:         "8px",
    spacingUnit:          "4px",
  },
  rules: {
    ".Input": {
      border:          "1px solid rgba(255,255,255,0.1)",
      backgroundColor: "rgba(255,255,255,0.05)",
      color:           "#ffffff",
      boxShadow:       "none",
      outline:         "none",
    },
    ".Input:hover": { border: "1px solid rgba(255,255,255,0.2)" },
    ".Input:focus": {
      border:    "1px solid #4F6EF7",
      boxShadow: "0 0 0 1px #4F6EF7",
    },
    ".Input--invalid": { border: "1px solid #f87171" },
    ".Label": {
      color:         "rgba(255,255,255,0.6)",
      fontSize:      "12px",
      fontWeight:    "500",
      letterSpacing: "0.02em",
    },
    ".Error": { color: "#f87171", fontSize: "12px" },
    ".Tab": {
      border:          "1px solid rgba(255,255,255,0.1)",
      backgroundColor: "rgba(255,255,255,0.03)",
      color:           "rgba(255,255,255,0.6)",
    },
    ".Tab:hover": {
      border:          "1px solid rgba(255,255,255,0.2)",
      backgroundColor: "rgba(255,255,255,0.07)",
      color:           "#ffffff",
    },
    ".Tab--selected": {
      border:          "1px solid #4F6EF7",
      backgroundColor: "rgba(79,110,247,0.12)",
      color:           "#ffffff",
    },
    ".Tab--selected:hover": {
      backgroundColor: "rgba(79,110,247,0.18)",
    },
    ".TabIcon--selected": { fill: "#4F6EF7" },
    ".CheckboxInput": { border: "1px solid rgba(255,255,255,0.2)" },
    ".CheckboxInput--checked": {
      backgroundColor: "#4F6EF7",
      border:          "1px solid #4F6EF7",
    },
    ".PickerItem": {
      border:          "1px solid rgba(255,255,255,0.1)",
      backgroundColor: "rgba(255,255,255,0.03)",
    },
    ".PickerItem--selected": {
      border:          "1px solid #4F6EF7",
      backgroundColor: "rgba(79,110,247,0.12)",
    },
    ".TermsText": { color: "rgba(255,255,255,0.35)", fontSize: "11px" },
    ".RedirectText": { color: "rgba(255,255,255,0.5)", fontSize: "12px" },
  },
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PlanCheckoutConfig {
  planSlug:     string;
  planName:     string;
  amountCents:  number;
  currency:     string;
  credits:      number;
  interval:     string | null;
  requireEmail?: boolean;
  email?:       string;
}

interface Props {
  config:   PlanCheckoutConfig | null;
  onClose:  () => void;
}

type CheckoutIdentity = { email: string; fullName: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("es-MX", {
    style:               "currency",
    currency:            currency.toUpperCase(),
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

function PlanIcon({ slug }: { slug: string }) {
  if (slug === "founder") return <Crown    size={20} className="text-amber-500"  />;
  if (slug === "pro")     return <Sparkles size={20} className="text-violet-500" />;
  return                         <Zap      size={20} className="text-blue-500"   />;
}

// ── PaymentForm — inner component that uses Stripe hooks ──────────────────────

function PaymentForm() {
  const stripe   = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [payError,   setPayError]   = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements || processing) return;
    setProcessing(true);
    setPayError(null);

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        // Absolute URL required by Stripe; uses current origin so it works in
        // dev preview and production without hardcoding a domain.
        return_url: `${window.location.origin}${BASE}/checkout/success`,
      },
    });

    if (error) {
      // error.type === "card_error" | "validation_error" | ...
      setPayError(error.message ?? "El pago no fue procesado. Inténtalo de nuevo.");
      setProcessing(false);
    }
    // On success Stripe redirects to return_url — no extra handling needed here.
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        options={{
          layout:  "tabs",
          wallets: { applePay: "auto", googlePay: "auto" },
        }}
      />

      {payError && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-400">
          {payError}
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || !elements || processing}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3.5 font-semibold text-white shadow-lg shadow-blue-600/20 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
      >
        {processing
          ? <><Loader2 size={16} className="animate-spin" /> Procesando pago...</>
          : <><ShieldCheck size={16} /> Pagar ahora</>
        }
      </button>

      <p className="text-center text-[11px] text-muted-foreground">
        Pago 100 % seguro · cifrado SSL · Stripe no almacena tu tarjeta en Reelsona
      </p>
    </form>
  );
}

// ── PaymentElementPane — outer component that fetches clientSecret ─────────────
//
// Props are primitive strings so they are stable across parent re-renders.
// The fetch runs exactly once on mount ([] deps). Elements mounts once the
// clientSecret arrives and is never re-created while the pane is alive.

function PaymentElementPane({
  planSlug,
  email,
  fullName,
  stripePromise,
  onBack,
}: {
  planSlug:      string;
  email:         string;
  fullName:      string;
  stripePromise: Promise<Stripe | null>;
  onBack:        () => void;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [fetchError,   setFetchError]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/checkout/create-payment-intent`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ planSlug, email, fullName }),
    })
      .then(async (r) => {
        const data = (await r.json()) as {
          clientSecret?: string;
          error?: string;
          message?: string;
          code?: string;
          devHint?: string;
        };
        if (cancelled) return;
        if (data.clientSecret) {
          setClientSecret(data.clientSecret);
        } else {
          // Show the dev hint when Stripe is blocked in non-prod environments.
          setFetchError(data.devHint ?? data.message ?? data.error ?? "No se pudo iniciar el pago. Inténtalo de nuevo.");
        }
      })
      .catch(() => {
        if (!cancelled) setFetchError("Error de conexión. Verifica tu internet e inténtalo de nuevo.");
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — props are stable primitives, run once on mount

  if (fetchError) {
    return (
      <div className="space-y-4 py-6 text-center">
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {fetchError}
        </div>
        <button
          onClick={onBack}
          className="text-sm text-muted-foreground underline hover:text-foreground"
        >
          Volver e intentar de nuevo
        </button>
      </div>
    );
  }

  if (!clientSecret) {
    return (
      <div className="flex min-h-[200px] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Preparando formulario de pago...
      </div>
    );
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: STRIPE_APPEARANCE as Parameters<typeof Elements>[0]["options"] extends { appearance?: infer A } ? A : never,
        locale: "es-419",
      }}
    >
      <PaymentForm />
    </Elements>
  );
}

// ── PlanCheckoutModal — parent shell ─────────────────────────────────────────

export function PlanCheckoutModal({ config, onClose }: Props) {
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [stripeError,   setStripeError]   = useState<string | null>(null);
  const [email,         setEmail]         = useState(config?.email ?? "");
  const [fullName,      setFullName]      = useState("");
  // identity !== null  ↔  PaymentElementPane is mounted.
  const [identity, setIdentity] = useState<CheckoutIdentity | null>(null);

  // Reset form when plan slug changes (new modal open).
  useEffect(() => {
    if (!config) return;
    setEmail(config.email ?? "");
    setFullName("");
    setIdentity(null);
    setStripeError(null);
  }, [config?.planSlug]);

  // Load Stripe.js once per modal open.
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

  const canContinue  = email.trim().includes("@");
  const showCheckout = identity !== null;

  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!config || !canContinue) return;
    setIdentity({ email: email.trim().toLowerCase(), fullName: fullName.trim() });
  };

  const handleBack = () => setIdentity(null); // unmounts PaymentElementPane → Stripe cleans up

  if (!config) return null;

  const intervalLabel = config.interval === "month" ? "/mes" : config.interval === "year" ? "/año" : "";
  const isTopup       = config.planSlug.startsWith("topup");

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/90 backdrop-blur-xl p-4 sm:p-8"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-[#0d0d0d] shadow-2xl">

        {/* ── Header ── */}
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

        {/* ── Plan summary ── */}
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

        {/* ── Body ── */}
        {!showCheckout ? (
          /* Step 1 — collect name + email */
          <form onSubmit={handleContinue} className="space-y-4 p-5">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Nombre completo</label>
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
              {!stripePromise && !stripeError
                ? <Loader2 size={16} className="animate-spin" />
                : null}
              Continuar al pago
            </button>

            <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck size={13} /> Pago seguro procesado por Stripe dentro de Reelsona
            </div>
          </form>
        ) : (
          /* Step 2 — Stripe Payment Element */
          <div className="p-4 sm:p-5">
            <button
              type="button"
              onClick={handleBack}
              className="mb-4 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft size={13} /> Volver
            </button>

            {stripePromise ? (
              <PaymentElementPane
                planSlug={config.planSlug}
                email={identity.email}
                fullName={identity.fullName}
                stripePromise={stripePromise}
                onBack={handleBack}
              />
            ) : (
              <div className="flex min-h-[200px] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
