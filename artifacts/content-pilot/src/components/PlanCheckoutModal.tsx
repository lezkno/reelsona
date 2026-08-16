/**
 * PlanCheckoutModal — Stripe-hosted checkout for subscription plans and topup packs.
 *
 * Flow: user clicks a plan/topup CTA → modal opens → POST /api/checkout/create-session
 * → browser redirects to Stripe-hosted checkout → returns to /checkout/success.
 *
 * Works both unauthenticated (Landing page — requires email) and authenticated
 * (Billing page — email is optional; server derives it from session when omitted).
 */

import { useCallback, useState } from "react";
import { Loader2, X, ArrowRight, ShieldCheck, Sparkles, Zap, Crown } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("es-MX", {
    style:    "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PlanCheckoutConfig {
  planSlug:   string;
  planName:   string;
  amountCents: number;
  currency:   string;
  credits:    number;
  /** 'month' | 'year' | null (for topups) */
  interval:   string | null;
  /** Whether to ask for email (unauthenticated flow) */
  requireEmail?: boolean;
  /** Pre-filled email (authenticated flow) */
  email?: string;
}

interface Props {
  config:  PlanCheckoutConfig | null;  // null = closed
  onClose: () => void;
}

// ── Icon by plan ──────────────────────────────────────────────────────────────

function PlanIcon({ slug }: { slug: string }) {
  if (slug === "founder")    return <Crown  size={20} color="#F59E0B" />;
  if (slug === "pro")        return <Sparkles size={20} color="#9B5CF6" />;
  if (slug.startsWith("topup")) return <Zap size={20} color="#4F6EF7" />;
  return <Zap size={20} color="#4F6EF7" />;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const inputBase: React.CSSProperties = {
  background:   "#161616",
  border:       "1px solid #2a2a2a",
  borderRadius: 10,
  padding:      "10px 12px",
  color:        "#f0f0f0",
  fontSize:     "0.875rem",
  outline:      "none",
  width:        "100%",
  boxSizing:    "border-box",
  fontFamily:   "inherit",
  transition:   "border-color 0.15s",
};

// ── Modal ─────────────────────────────────────────────────────────────────────

export function PlanCheckoutModal({ config, onClose }: Props) {
  const [email,     setEmail]     = useState(config?.email ?? "");
  const [fullName,  setFullName]  = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;
    if (config.requireEmail && !email.includes("@")) {
      setError("Ingresa un email válido");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const body: Record<string, unknown> = { planSlug: config.planSlug };
      if (email)    body.email    = email.trim().toLowerCase();
      if (fullName) body.fullName = fullName.trim();

      const res  = await fetch(`${BASE}/api/checkout/create-session`, {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify(body),
      });
      const data = await res.json() as { url?: string; error?: string };

      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "No se pudo crear la sesión de pago");
      }

      window.location.href = data.url;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error inesperado");
      setSubmitting(false);
    }
  }, [config, email, fullName]);

  if (!config) return null;

  const priceLabel = formatPrice(config.amountCents, config.currency);
  const intervalLabel =
    config.interval === "month" ? "/mes" :
    config.interval === "year"  ? "/año" : "";

  const isTopup = config.planSlug.startsWith("topup");

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto"
      style={{ backgroundColor: "rgba(0,0,0,0.9)", backdropFilter: "blur(12px)", padding: "2rem 1rem" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        position:        "relative",
        width:           "100%",
        maxWidth:        440,
        backgroundColor: "#0d0d0d",
        borderRadius:    20,
        border:          "1px solid #1e1e1e",
        overflow:        "hidden",
        boxShadow:       "0 0 80px rgba(79,110,247,0.12), 0 32px 80px rgba(0,0,0,0.85)",
      }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #181818" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img src={`${BASE}/logo.png`} alt="Reelsona" style={{ width: 22, height: 22, objectFit: "contain" }} />
            <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#f0f0f0" }}>Reelsona</span>
          </div>
          <button onClick={onClose} aria-label="Cerrar" style={{ background: "none", border: "none", color: "#555", cursor: "pointer", padding: 4, display: "flex", borderRadius: 8 }}>
            <X size={16} />
          </button>
        </div>

        {/* Plan strip */}
        <div style={{
          padding:        "16px 20px",
          background:     config.planSlug === "founder"
            ? "linear-gradient(90deg,rgba(245,158,11,0.08),rgba(245,158,11,0.04))"
            : "linear-gradient(90deg,rgba(79,110,247,0.07),rgba(155,92,246,0.07))",
          borderBottom:   "1px solid #181818",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <PlanIcon slug={config.planSlug} />
            <span style={{ fontWeight: 700, fontSize: "1rem", color: "#f0f0f0" }}>{config.planName}</span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span style={{
              fontWeight: 800, fontSize: "2rem",
              background: config.planSlug === "founder"
                ? "linear-gradient(135deg,#F59E0B,#FCD34D)"
                : "linear-gradient(135deg,#4F6EF7,#9B5CF6)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
            }}>{priceLabel}</span>
            {intervalLabel && <span style={{ color: "#666", fontSize: "0.85rem" }}>{intervalLabel}</span>}
          </div>
          <p style={{ color: "#555", fontSize: "0.75rem", marginTop: 4, marginBottom: 0 }}>
            {isTopup ? `${config.credits.toLocaleString()} créditos · Nunca vencen` : `${config.credits.toLocaleString()} créditos / mes`}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Name — always optional */}
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={{ color: "#999", fontSize: "0.78rem", fontWeight: 500 }}>Nombre completo <span style={{ color: "#444" }}>(opcional)</span></label>
            <input type="text" placeholder="Tu nombre" value={fullName} onChange={(e) => setFullName(e.target.value)} style={inputBase}
              onFocus={(e) => (e.target.style.borderColor = "#4F6EF7")}
              onBlur={(e)  => (e.target.style.borderColor = "#2a2a2a")} />
          </div>

          {/* Email — shown when requireEmail */}
          {config.requireEmail && (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ color: "#999", fontSize: "0.78rem", fontWeight: 500 }}>
                Email <span style={{ color: "#f87171" }}>*</span>
              </label>
              <input type="email" placeholder="tu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required style={inputBase}
                onFocus={(e) => (e.target.style.borderColor = "#4F6EF7")}
                onBlur={(e)  => (e.target.style.borderColor = "#2a2a2a")} />
              <p style={{ color: "#444", fontSize: "0.7rem" }}>
                {isTopup ? "Los créditos se acreditarán en esta cuenta." : "Tu acceso se activa en este email tras el pago."}
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <p style={{ color: "#f87171", fontSize: "0.8rem", background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.18)", borderRadius: 8, padding: "10px 12px", margin: 0 }}>
              {error}
            </p>
          )}

          {/* Submit */}
          <button type="submit" disabled={submitting || (config.requireEmail && !email.includes("@"))} style={{
            display:        "flex", alignItems: "center", justifyContent: "center", gap: 8,
            background:     (!submitting && (!config.requireEmail || email.includes("@")))
              ? config.planSlug === "founder"
                ? "linear-gradient(135deg,#F59E0B,#D97706)"
                : "linear-gradient(135deg,#4F6EF7,#7B5CF6)"
              : "#1a1a1a",
            color:          (!submitting && (!config.requireEmail || email.includes("@"))) ? "#fff" : "#444",
            border:         "none", borderRadius: 12, padding: "14px", fontWeight: 700, fontSize: "0.95rem",
            cursor:         (!submitting && (!config.requireEmail || email.includes("@"))) ? "pointer" : "not-allowed",
            transition:     "opacity 0.15s", letterSpacing: "0.01em",
          }}>
            {submitting
              ? <><Loader2 size={16} className="animate-spin" /> Redirigiendo…</>
              : <>{isTopup ? "Comprar créditos" : "Suscribirse"} <ArrowRight size={15} /></>
            }
          </button>

          {/* Trust note */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
            <ShieldCheck size={12} style={{ color: "#333" }} />
            <p style={{ color: "#333", fontSize: "0.68rem", margin: 0 }}>Pago seguro con Stripe · Cancela cuando quieras</p>
          </div>
        </form>
      </div>
    </div>
  );
}
