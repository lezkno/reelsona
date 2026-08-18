/**
 * PlanCheckoutModal — Reelsona RC1 embedded Stripe Checkout.
 *
 * Landing (unauthenticated): collect name/email first, then mount Stripe Checkout.
 * Billing/topups (authenticated): email comes from the account and Checkout mounts
 * after the user confirms the purchase. Payment stays inside Reelsona.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

export function PlanCheckoutModal({ config, onClose }: Props) {
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [stripeError, setStripeError] = useState<string | null>(null);
  const [email, setEmail] = useState(config?.email ?? "");
  const [fullName, setFullName] = useState("");
  const [identity, setIdentity] = useState<CheckoutIdentity | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);

  /**
   * Snapshot of the checkout params captured at the moment the user clicks
   * "Continuar al pago". We read from this ref inside fetchClientSecret so the
   * callback has *no* reactive dependencies and therefore never changes
   * reference while an EmbeddedCheckoutProvider is mounted.
   *
   * Changing the options prop on a live EmbeddedCheckoutProvider causes Stripe
   * to attempt a second mount before the first one is destroyed, which throws
   * "You cannot have multiple Embedded Checkout objects."
   */
  const checkoutSnapRef = useRef<{ planSlug: string; email: string; fullName: string } | null>(null);
  /** Bump on each deliberate new session so the provider gets a fresh key. */
  const checkoutKeyRef = useRef(0);

  useEffect(() => {
    if (!config) return;
    setEmail(config.email ?? "");
    setFullName("");
    setIdentity(null);
    setShowCheckout(false);
    setStripeError(null);
    checkoutSnapRef.current = null;
  }, [config?.planSlug]);

  useEffect(() => {
    if (!config || stripePromise) return;
    fetch(`${BASE}/api/config/public`, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error("No se pudo cargar la configuración de Stripe");
        return r.json() as Promise<{ stripePublishableKey?: string | null }>;
      })
      .then(({ stripePublishableKey }) => {
        if (!stripePublishableKey) throw new Error("Stripe no está configurado para este entorno");
        setStripePromise(loadStripe(stripePublishableKey));
      })
      .catch((err: Error) => setStripeError(err.message));
  }, [config, stripePromise]);

  // Email is always shown and always validated — authenticated users get it pre-filled.
  const canContinue = email.trim().includes("@");

  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!config || !canContinue) return;
    const resolvedEmail = email.trim().toLowerCase();
    // Snapshot all values into the ref before incrementing the key/showing checkout.
    checkoutSnapRef.current = {
      planSlug: config.planSlug,
      email: resolvedEmail,
      fullName: fullName.trim(),
    };
    checkoutKeyRef.current += 1;
    setIdentity({ email: resolvedEmail, fullName: fullName.trim() });
    setShowCheckout(true);
    setStripeError(null);
  };

  /**
   * Reads exclusively from the stable ref — intentionally no reactive deps —
   * so this function reference never changes while the provider is mounted.
   */
  const fetchClientSecret = useCallback(async () => {
    const snap = checkoutSnapRef.current;
    if (!snap) throw new Error("Checkout incompleto");

    const res = await fetch(`${BASE}/api/checkout/create-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        planSlug: snap.planSlug,
        email: snap.email || undefined,
        fullName: snap.fullName || undefined,
        embedded: true,
      }),
    });

    const data = await res.json() as {
      clientSecret?: string;
      error?: string;
      message?: string;
      code?: string;
    };

    if (!res.ok || !data.clientSecret) {
      throw new Error(data.message ?? data.error ?? "No se pudo iniciar el pago");
    }

    return data.clientSecret;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — reads from ref, never needs to change

  const embeddedOptions = useMemo(
    () => showCheckout ? { fetchClientSecret } : null,
    [showCheckout, fetchClientSecret],
  );

  if (!config) return null;

  const intervalLabel = config.interval === "month" ? "/mes" : config.interval === "year" ? "/año" : "";
  const isTopup = config.planSlug.startsWith("topup");

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/90 backdrop-blur-xl p-4 sm:p-8"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-[#0d0d0d] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2">
            <img src={`${BASE}/logo.png`} alt="Reelsona" className="h-6 w-6 object-contain" />
            <span className="font-semibold text-white">Reelsona</span>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/5 hover:text-foreground">
            <X size={17} />
          </button>
        </div>

        <div className="border-b border-white/10 bg-gradient-to-r from-blue-500/5 to-violet-500/5 px-5 py-4">
          <div className="mb-1 flex items-center gap-2">
            <PlanIcon slug={config.planSlug} />
            <span className="font-semibold">{config.planName}</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold text-amber-400">{formatPrice(config.amountCents, config.currency)}</span>
            {intervalLabel && <span className="text-sm text-amber-400/70">{intervalLabel}</span>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {isTopup
              ? `${config.credits.toLocaleString()} créditos adicionales · nunca vencen`
              : `${config.credits.toLocaleString()} créditos incluidos`}
          </p>
        </div>

        {!showCheckout ? (
          <form onSubmit={handleContinue} className="space-y-4 p-5">
            {/* Name + email are always shown.
                For authenticated users email is pre-filled (editable in case they want a different billing address).
                For unauthenticated users (landing) both fields start empty and email is required. */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Nombre completo</label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Tu nombre"
                autoComplete="name"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
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
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
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
              {!stripePromise && !stripeError ? <Loader2 size={16} className="animate-spin" /> : null}
              Continuar al pago
            </button>

            <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck size={13} /> Pago seguro procesado por Stripe dentro de Reelsona
            </div>
          </form>
        ) : (
          <div className="p-4 sm:p-5">
            <button
              type="button"
              onClick={() => { setShowCheckout(false); setIdentity(null); }}
              className="mb-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft size={13} /> Volver
            </button>

            {stripePromise && embeddedOptions ? (
              <div className="min-h-[420px] overflow-hidden rounded-xl bg-white">
                <EmbeddedCheckoutProvider
                  key={checkoutKeyRef.current}
                  stripe={stripePromise}
                  options={embeddedOptions}
                >
                  <EmbeddedCheckout />
                </EmbeddedCheckoutProvider>
              </div>
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
