/**
 * PlanCheckoutModal — collects email (unauthenticated flow) then redirects to
 * Stripe's hosted checkout page.
 *
 * Works unauthenticated (Landing — requireEmail:true) and authenticated (Billing).
 * For authenticated users the email step is skipped and the session is created
 * immediately with the account email fetched server-side.
 */

import { useCallback, useRef, useState } from "react";
import {
  ArrowRight,
  Crown,
  ExternalLink,
  Loader2,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PlanCheckoutConfig {
  planSlug:    string;
  planName:    string;
  amountCents: number;
  currency:    string;
  credits:     number;
  /** 'month' | 'year' | null (for topups) */
  interval:    string | null;
  /** Show email field — true for unauthenticated landing flows */
  requireEmail?: boolean;
  /** Pre-filled email (authenticated flow) */
  email?: string;
}

interface Props {
  config:  PlanCheckoutConfig | null;
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("es-MX", {
    style:                 "currency",
    currency:              currency.toUpperCase(),
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

function PlanIcon({ slug }: { slug: string }) {
  if (slug === "founder")        return <Crown    size={20} color="#F59E0B" />;
  if (slug === "pro")            return <Sparkles size={20} color="#9B5CF6" />;
  if (slug.startsWith("topup"))  return <Zap      size={20} color="#4F6EF7" />;
  return <Zap size={20} color="#4F6EF7" />;
}

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

function accentFor(slug: string): string {
  if (slug === "founder") return "linear-gradient(135deg,#F59E0B,#D97706)";
  if (slug === "pro")     return "linear-gradient(135deg,#9B5CF6,#7C3AED)";
  return "linear-gradient(135deg,#4F6EF7,#7B5CF6)";
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function PlanCheckoutModal({ config, onClose }: Props) {
  const [email,    setEmail]    = useState(config?.email ?? "");
  const [fullName, setFullName] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const sessionCreated = useRef(false);

  const createSession = useCallback(
    async (resolvedEmail: string, resolvedName?: string) => {
      if (!config) return;
      sessionCreated.current = true;
      setLoading(true);
      setError(null);

      try {
        const body: Record<string, unknown> = { planSlug: config.planSlug };
        if (resolvedEmail) body.email    = resolvedEmail.trim().toLowerCase();
        if (resolvedName)  body.fullName = resolvedName.trim();

        const res  = await fetch(`${BASE}/api/checkout/create-session`, {
          method:      "POST",
          headers:     { "Content-Type": "application/json" },
          credentials: "include",
          body:        JSON.stringify(body),
        });
        const data = await res.json() as {
          url?:           string;
          clientSecret?:  string;
          error?:         string;
          founderSoldOut?: boolean;
        };

        if (!res.ok) {
          throw new Error(data.error ?? "No se pudo crear la sesión de pago");
        }

        if (data.url) {
          // Redirect to Stripe's hosted checkout page
          window.location.href = data.url;
          return;
        }

        // Fallback: should not happen with current backend
        throw new Error(data.error ?? "Respuesta inesperada del servidor de pagos");
      } catch (err: unknown) {
        sessionCreated.current = false;
        setError(err instanceof Error ? err.message : "Error inesperado");
        setLoading(false);
      }
    },
    [config],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (sessionCreated.current) return;

      if (config?.requireEmail) {
        if (!email.includes("@")) {
          setError("Ingresa un email válido");
          return;
        }
        await createSession(email, fullName);
      } else {
        // Authenticated user — email resolved server-side from the session
        await createSession(config?.email ?? "");
      }
    },
    [config, email, fullName, createSession],
  );

  if (!config) return null;

  const priceLabel    = formatPrice(config.amountCents, config.currency);
  const intervalLabel =
    config.interval === "month" ? "/mes" :
    config.interval === "year"  ? "/año" : "";
  const isTopup      = config.planSlug.startsWith("topup");
  const canSubmit    = !loading && (!config.requireEmail || email.includes("@"));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto"
      style={{
        backgroundColor: "rgba(0,0,0,0.92)",
        backdropFilter:  "blur(14px)",
        padding:         "2rem 1rem",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          position:        "relative",
          width:           "100%",
          maxWidth:        440,
          backgroundColor: "#0d0d0d",
          borderRadius:    20,
          border:          "1px solid #1e1e1e",
          overflow:        "hidden",
          boxShadow:       "0 0 80px rgba(79,110,247,0.12), 0 32px 80px rgba(0,0,0,0.85)",
        }}
      >

        {/* ── Header ── */}
        <div style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          padding:        "16px 20px",
          borderBottom:   "1px solid #181818",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img
              src={`${BASE}/logo.png`}
              alt="Reelsona"
              style={{ width: 22, height: 22, objectFit: "contain" }}
            />
            <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#f0f0f0" }}>
              Reelsona
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            style={{
              background:   "none",
              border:       "none",
              color:        "#555",
              cursor:       "pointer",
              padding:      4,
              display:      "flex",
              borderRadius: 8,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Plan strip ── */}
        <div style={{
          padding:      "16px 20px",
          background:   config.planSlug === "founder"
            ? "linear-gradient(90deg,rgba(245,158,11,0.08),rgba(245,158,11,0.04))"
            : "linear-gradient(90deg,rgba(79,110,247,0.07),rgba(155,92,246,0.07))",
          borderBottom: "1px solid #181818",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <PlanIcon slug={config.planSlug} />
            <span style={{ fontWeight: 700, fontSize: "1rem", color: "#f0f0f0" }}>
              {config.planName}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span style={{
              fontWeight:           800,
              fontSize:             "2rem",
              background:           accentFor(config.planSlug),
              WebkitBackgroundClip: "text",
              WebkitTextFillColor:  "transparent",
              backgroundClip:       "text",
            }}>
              {priceLabel}
            </span>
            {intervalLabel && (
              <span style={{ color: "#666", fontSize: "0.85rem" }}>
                {intervalLabel}
              </span>
            )}
          </div>
          <p style={{ color: "#555", fontSize: "0.75rem", marginTop: 4, marginBottom: 0 }}>
            {isTopup
              ? `${config.credits.toLocaleString()} créditos · Nunca vencen`
              : `${config.credits.toLocaleString()} créditos / mes`}
          </p>
        </div>

        {/* ── Form ── */}
        <form
          onSubmit={handleSubmit}
          style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}
        >
          {/* Name + Email — only shown for unauthenticated (landing) flow */}
          {config.requireEmail && (
            <>
              {/* Name */}
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <label style={{ color: "#999", fontSize: "0.78rem", fontWeight: 500 }}>
                  Nombre completo{" "}
                  <span style={{ color: "#444" }}>(opcional)</span>
                </label>
                <input
                  type="text"
                  placeholder="Tu nombre"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  style={inputBase}
                  onFocus={(e) => (e.target.style.borderColor = "#4F6EF7")}
                  onBlur={(e)  => (e.target.style.borderColor = "#2a2a2a")}
                />
              </div>

              {/* Email */}
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <label style={{ color: "#999", fontSize: "0.78rem", fontWeight: 500 }}>
                  Email <span style={{ color: "#f87171" }}>*</span>
                </label>
                <input
                  type="email"
                  placeholder="tu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  style={inputBase}
                  onFocus={(e) => (e.target.style.borderColor = "#4F6EF7")}
                  onBlur={(e)  => (e.target.style.borderColor = "#2a2a2a")}
                />
                <p style={{ color: "#444", fontSize: "0.7rem" }}>
                  {isTopup
                    ? "Los créditos se acreditarán en esta cuenta."
                    : "Tu acceso se activa en este email tras el pago."}
                </p>
              </div>
            </>
          )}

          {/* Error */}
          {error && (
            <p style={{
              color:        "#f87171",
              fontSize:     "0.8rem",
              background:   "rgba(248,113,113,0.07)",
              border:       "1px solid rgba(248,113,113,0.18)",
              borderRadius: 8,
              padding:      "10px 12px",
              margin:       0,
            }}>
              {error}
            </p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              display:        "flex",
              alignItems:     "center",
              justifyContent: "center",
              gap:            8,
              background:     canSubmit ? accentFor(config.planSlug) : "#1a1a1a",
              color:          canSubmit ? "#fff" : "#444",
              border:         "none",
              borderRadius:   12,
              padding:        "14px",
              fontWeight:     700,
              fontSize:       "0.95rem",
              cursor:         canSubmit ? "pointer" : "not-allowed",
              transition:     "opacity 0.15s",
              letterSpacing:  "0.01em",
            }}
          >
            {loading
              ? <><Loader2 size={16} className="animate-spin" /> Procesando…</>
              : <><ExternalLink size={15} /> Ir al pago seguro <ArrowRight size={15} /></>
            }
          </button>

          {/* Trust note */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
            <ShieldCheck size={12} style={{ color: "#333" }} />
            <p style={{ color: "#333", fontSize: "0.68rem", margin: 0 }}>
              Pago seguro con Stripe · Cancela cuando quieras
            </p>
          </div>
        </form>

      </div>
    </div>
  );
}
