/**
 * PlanCheckoutModal — one checkout UI for Landing, Billing and credit topups.
 *
 * New subscriptions and one-time packs use Stripe Embedded Checkout inside
 * Reelsona. When an authenticated Basic/Pro subscriber selects Founder, the
 * server upgrades the existing subscription instead of creating a duplicate.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { ArrowRight, Crown, Loader2, ShieldCheck, Sparkles, X, Zap } from "lucide-react";

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

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

function PlanIcon({ slug }: { slug: string }) {
  if (slug === "founder") return <Crown size={20} color="#F59E0B" />;
  if (slug === "pro") return <Sparkles size={20} color="#9B5CF6" />;
  return <Zap size={20} color="#4F6EF7" />;
}

function accentFor(slug: string): string {
  if (slug === "founder") return "linear-gradient(135deg,#F59E0B,#D97706)";
  if (slug === "pro") return "linear-gradient(135deg,#9B5CF6,#7C3AED)";
  return "linear-gradient(135deg,#4F6EF7,#7B5CF6)";
}

const inputBase: React.CSSProperties = {
  background: "#161616",
  border: "1px solid #2a2a2a",
  borderRadius: 10,
  padding: "10px 12px",
  color: "#f0f0f0",
  fontSize: "0.875rem",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

export function PlanCheckoutModal({ config, onClose }: Props) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/config/public`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error("No se pudo cargar la configuración de pagos");
        return res.json() as Promise<{ stripePublishableKey: string | null; stripeConfigured?: boolean }>;
      })
      .then(({ stripePublishableKey }) => {
        if (cancelled) return;
        if (!stripePublishableKey) throw new Error("Stripe no está disponible en este momento");
        setStripePromise(loadStripe(stripePublishableKey));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "No se pudo conectar con Stripe");
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setEmail(config?.email ?? "");
    setFullName("");
    setClientSecret(null);
    setError(null);
    setLoading(false);
    startedRef.current = false;
  }, [config?.planSlug, config?.email]);

  const createEmbeddedSession = useCallback(async (resolvedEmail?: string, resolvedName?: string) => {
    if (!config || startedRef.current) return;
    startedRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const body: Record<string, unknown> = { planSlug: config.planSlug, embedded: true };
      if (resolvedEmail) body.email = resolvedEmail.trim().toLowerCase();
      if (resolvedName) body.fullName = resolvedName.trim();

      const res = await fetch(`${BASE}/api/checkout/create-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json() as {
        clientSecret?: string;
        subscriptionChanged?: boolean;
        plan?: string;
        error?: string;
        code?: string;
      };

      if (!res.ok) throw new Error(data.error ?? "No se pudo iniciar el pago");

      if (data.subscriptionChanged) {
        window.location.href = `${BASE}/billing?plan_changed=${encodeURIComponent(data.plan ?? config.planSlug)}`;
        return;
      }

      if (!data.clientSecret) throw new Error("Stripe no devolvió el formulario de pago");
      setClientSecret(data.clientSecret);
    } catch (err: unknown) {
      startedRef.current = false;
      setError(err instanceof Error ? err.message : "Error inesperado al iniciar Stripe");
    } finally {
      setLoading(false);
    }
  }, [config]);

  // Authenticated topups/basic/pro checkouts may prepare the embedded form
  // immediately. Founder is excluded because changing an existing subscription
  // can issue an immediate invoice and therefore requires explicit confirmation.
  useEffect(() => {
    if (!config || config.requireEmail || config.planSlug === "founder" || !stripePromise || clientSecret || loading || startedRef.current) return;
    void createEmbeddedSession(config.email);
  }, [config, stripePromise, clientSecret, loading, createEmbeddedSession]);

  if (!config) return null;

  const isTopup = config.planSlug.startsWith("topup");
  const requiresFounderConfirmation = config.planSlug === "founder" && !config.requireEmail && !clientSecret;
  const priceLabel = formatPrice(config.amountCents, config.currency);
  const intervalLabel = config.interval === "month" ? "/mes" : config.interval === "year" ? "/año" : "";

  const handleIdentitySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) {
      setError("Ingresa un email válido");
      return;
    }
    if (!stripePromise) {
      setError("Stripe todavía se está cargando. Intenta nuevamente en un momento.");
      return;
    }
    void createEmbeddedSession(email, fullName);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto"
      style={{ backgroundColor: "rgba(0,0,0,0.92)", backdropFilter: "blur(14px)", padding: "2rem 1rem" }}
      onClick={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}
    >
      <div style={{
        position: "relative", width: "100%", maxWidth: 520, backgroundColor: "#0d0d0d",
        borderRadius: 20, border: "1px solid #1e1e1e", overflow: "hidden",
        boxShadow: "0 0 80px rgba(79,110,247,0.12), 0 32px 80px rgba(0,0,0,0.85)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #181818" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img src={`${BASE}/logo.png`} alt="Reelsona" style={{ width: 22, height: 22, objectFit: "contain" }} />
            <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#f0f0f0" }}>Reelsona</span>
          </div>
          <button onClick={onClose} aria-label="Cerrar" disabled={loading}
            style={{ background: "none", border: "none", color: "#666", cursor: "pointer", padding: 4, display: "flex" }}>
            <X size={16} />
          </button>
        </div>

        <div style={{
          padding: "16px 20px",
          background: config.planSlug === "founder"
            ? "linear-gradient(90deg,rgba(245,158,11,0.08),rgba(245,158,11,0.04))"
            : "linear-gradient(90deg,rgba(79,110,247,0.07),rgba(155,92,246,0.07))",
          borderBottom: "1px solid #181818",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <PlanIcon slug={config.planSlug} />
            <span style={{ fontWeight: 700, fontSize: "1rem", color: "#f0f0f0" }}>{config.planName}</span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span style={{ fontWeight: 800, fontSize: "2rem", background: accentFor(config.planSlug), WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              {priceLabel}
            </span>
            {intervalLabel && <span style={{ color: "#666", fontSize: "0.85rem" }}>{intervalLabel}</span>}
          </div>
          <p style={{ color: "#666", fontSize: "0.75rem", marginTop: 4, marginBottom: 0 }}>
            {isTopup ? `${config.credits.toLocaleString()} créditos · Nunca vencen` : `${config.credits.toLocaleString()} créditos incluidos`}
          </p>
        </div>

        <div style={{ padding: 20 }}>
          {config.requireEmail && !clientSecret ? (
            <form onSubmit={handleIdentitySubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <label style={{ color: "#999", fontSize: "0.78rem", fontWeight: 500 }}>Nombre completo <span style={{ color: "#555" }}>(opcional)</span></label>
                <input type="text" placeholder="Tu nombre" value={fullName} onChange={(e) => setFullName(e.target.value)} style={inputBase} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <label style={{ color: "#999", fontSize: "0.78rem", fontWeight: 500 }}>Email <span style={{ color: "#f87171" }}>*</span></label>
                <input type="email" placeholder="tu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required style={inputBase} />
              </div>
              {error && <p style={{ color: "#f87171", fontSize: "0.8rem", background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.18)", borderRadius: 8, padding: "10px 12px", margin: 0 }}>{error}</p>}
              <button type="submit" disabled={loading || !email.includes("@") || !stripePromise}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: accentFor(config.planSlug), color: "#fff", border: "none", borderRadius: 12, padding: 14, fontWeight: 700, cursor: "pointer" }}>
                {loading ? <><Loader2 size={16} className="animate-spin" /> Preparando pago…</> : <>Continuar al pago <ArrowRight size={15} /></>}
              </button>
            </form>
          ) : requiresFounderConfirmation ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <p style={{ color: "#aaa", fontSize: "0.82rem", lineHeight: 1.55, margin: 0 }}>
                Confirmarás el cambio de tu suscripción actual a Founder. Stripe calculará el ajuste correspondiente y puede generar un cargo inmediato con tu método de pago guardado.
              </p>
              {error && <p style={{ color: "#f87171", fontSize: "0.8rem", margin: 0 }}>{error}</p>}
              <button
                type="button"
                disabled={loading || !stripePromise}
                onClick={() => void createEmbeddedSession(config.email)}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: accentFor(config.planSlug), color: "#fff", border: "none", borderRadius: 12, padding: 14, fontWeight: 700, cursor: "pointer" }}
              >
                {loading ? <><Loader2 size={16} className="animate-spin" /> Procesando cambio…</> : <><Crown size={16} /> Confirmar cambio a Founder</>}
              </button>
            </div>
          ) : clientSecret && stripePromise ? (
            <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret }}>
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          ) : (
            <div style={{ minHeight: 180, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
              {error ? (
                <>
                  <p style={{ color: "#f87171", fontSize: "0.85rem", textAlign: "center", margin: 0 }}>{error}</p>
                  <button onClick={() => { startedRef.current = false; setError(null); void createEmbeddedSession(config.email); }}
                    style={{ background: accentFor(config.planSlug), color: "#fff", border: 0, borderRadius: 10, padding: "10px 14px", fontWeight: 700, cursor: "pointer" }}>
                    Reintentar
                  </button>
                </>
              ) : (
                <><Loader2 size={24} className="animate-spin" color="#7B5CF6" /><span style={{ color: "#888", fontSize: "0.82rem" }}>Cargando pago seguro…</span></>
              )}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 14 }}>
            <ShieldCheck size={12} style={{ color: "#555" }} />
            <p style={{ color: "#555", fontSize: "0.68rem", margin: 0 }}>Pago seguro procesado directamente por Stripe</p>
          </div>
        </div>
      </div>
    </div>
  );
}
