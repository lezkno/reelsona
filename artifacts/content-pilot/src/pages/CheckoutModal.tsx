/**
 * CheckoutModal — custom-designed payment form with Stripe Elements.
 *
 * Stripe's PaymentElement handles the card iframe (PCI-compliant) while
 * every other piece of UI belongs to Reelsona: name/email fields, price
 * display, submit button, loading/error states.
 *
 * Flow: load publishable key on mount → on open create PaymentIntent
 * (clientSecret) → mount Elements → user fills form → confirmPayment
 * → Stripe redirects to /checkout/success.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { Loader2, Lock, ShieldCheck, X } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Stripe appearance — dark Reelsona theme ────────────────────────────────────
const STRIPE_APPEARANCE = {
  theme: "night" as const,
  variables: {
    colorPrimary:        "#4F6EF7",
    colorBackground:     "#161616",
    colorText:           "#f0f0f0",
    colorTextSecondary:  "#888888",
    colorDanger:         "#f87171",
    fontFamily:          '"Outfit", ui-sans-serif, system-ui, sans-serif',
    borderRadius:        "10px",
    spacingUnit:         "4px",
    focusBoxShadow:      "0 0 0 3px rgba(79,110,247,0.18)",
    focusOutline:        "none",
  },
  rules: {
    ".Input": {
      backgroundColor: "#161616",
      border:          "1px solid #2a2a2a",
      boxShadow:       "none",
      padding:         "10px 12px",
      color:           "#f0f0f0",
    },
    ".Input:focus": { border: "1px solid #4F6EF7" },
    ".Input--invalid": { border: "1px solid #f87171", boxShadow: "none" },
    ".Label": {
      color:      "#999",
      fontSize:   "12px",
      fontWeight: "500",
    },
    ".Error": { color: "#f87171", fontSize: "12px" },
    ".Tab": {
      backgroundColor: "#161616",
      border:          "1px solid #2a2a2a",
      color:           "#666",
      boxShadow:       "none",
    },
    ".Tab:hover":      { backgroundColor: "#1d1d1d", color: "#ccc" },
    ".Tab--selected":  { backgroundColor: "#1d1d1d", border: "1px solid #4F6EF7", color: "#f0f0f0" },
    ".TabIcon--selected": { fill: "#4F6EF7" },
    ".Block":          { backgroundColor: "#161616", border: "1px solid #222" },
    ".CheckboxInput":  { backgroundColor: "#161616", border: "1px solid #2a2a2a" },
    ".CheckboxInput--checked": { backgroundColor: "#4F6EF7", border: "1px solid #4F6EF7" },
  },
};

// ── Shared input style ─────────────────────────────────────────────────────────
const inputBase: React.CSSProperties = {
  background:    "#161616",
  border:        "1px solid #2a2a2a",
  borderRadius:  10,
  padding:       "10px 12px",
  color:         "#f0f0f0",
  fontSize:      "0.875rem",
  outline:       "none",
  width:         "100%",
  boxSizing:     "border-box",
  fontFamily:    "inherit",
  transition:    "border-color 0.15s",
};

// ── Inner form (must live inside <Elements>) ────────────────────────────────────
function PaymentForm({
  email, setEmail,
  fullName, setFullName,
}: {
  email: string;    setEmail:    (v: string) => void;
  fullName: string; setFullName: (v: string) => void;
}) {
  const stripe   = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [cardReady, setCardReady]   = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const canSubmit = !!stripe && !!elements && cardReady && email.includes("@") && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    if (!email.includes("@")) { setError("Ingresa un email válido"); return; }

    setSubmitting(true);
    setError(null);

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}${BASE}/checkout/success`,
        payment_method_data: {
          billing_details: {
            email:  email.trim().toLowerCase(),
            name:   fullName.trim() || undefined,
          },
        },
      },
    });

    // confirmPayment only returns here if there's an error
    if (confirmError) {
      setError(confirmError.message ?? "Error al procesar el pago");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      {/* Full name */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ color: "#999", fontSize: "0.78rem", fontWeight: 500 }}>
          Nombre completo
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
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
          Tu acceso se activa en este email tras el pago.
        </p>
      </div>

      {/* Stripe PaymentElement — card iframe with Reelsona appearance */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ color: "#999", fontSize: "0.78rem", fontWeight: 500 }}>
          Datos de pago
        </label>
        <PaymentElement
          onReady={() => setCardReady(true)}
          options={{
            layout: "tabs",
            fields: {
              billingDetails: {
                email:   "never",   // collected above
                name:    "never",   // collected above
                phone:   "never",
                address: "never",
              },
            },
            terms: { card: "never" },
          }}
        />
      </div>

      {/* Inline error */}
      {error && (
        <p
          style={{
            color:        "#f87171",
            fontSize:     "0.8rem",
            background:   "rgba(248,113,113,0.07)",
            border:       "1px solid rgba(248,113,113,0.18)",
            borderRadius: 8,
            padding:      "10px 12px",
            margin:       0,
          }}
        >
          {error}
        </p>
      )}

      {/* Submit button */}
      <button
        type="submit"
        disabled={!canSubmit}
        style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "center",
          gap:            8,
          background:     canSubmit
            ? "linear-gradient(135deg, #4F6EF7, #7B5CF6)"
            : "#1a1a1a",
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
        {submitting ? (
          <><Loader2 size={16} className="animate-spin" /> Procesando…</>
        ) : (
          <><Lock size={15} /> Pagar $47 USD</>
        )}
      </button>

      {/* Trust note */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
        <ShieldCheck size={12} style={{ color: "#444" }} />
        <p style={{ color: "#3a3a3a", fontSize: "0.68rem", margin: 0 }}>
          Pago cifrado y seguro con Stripe
        </p>
      </div>
    </form>
  );
}

// ── Modal shell ────────────────────────────────────────────────────────────────
interface Props {
  isOpen:  boolean;
  onClose: () => void;
}

export function CheckoutModal({ isOpen, onClose }: Props) {
  const [stripePromise, setStripePromise] = useState<ReturnType<typeof loadStripe> | null>(null);
  const [clientSecret,  setClientSecret]  = useState<string | null>(null);
  const [loadError,     setLoadError]     = useState<string | null>(null);
  const [email,         setEmail]         = useState("");
  const [fullName,      setFullName]      = useState("");
  const pkFetched = useRef(false);

  // Pre-load publishable key on mount (before user clicks anything)
  useEffect(() => {
    if (pkFetched.current) return;
    pkFetched.current = true;
    fetch(`${BASE}/api/config/public`)
      .then((r) => r.json())
      .then(({ stripePublishableKey }: { stripePublishableKey: string | null }) => {
        if (!stripePublishableKey) {
          setLoadError("Checkout no disponible. Contacta al equipo.");
          return;
        }
        setStripePromise(loadStripe(stripePublishableKey));
      })
      .catch(() => setLoadError("Error al conectar con el servidor de pagos."));
  }, []);

  // Create a fresh PaymentIntent each time the modal opens
  useEffect(() => {
    if (!isOpen || clientSecret) return;
    fetch(`${BASE}/api/checkout/create-payment-intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })
      .then((r) => r.json())
      .then(({ clientSecret: cs, error }: { clientSecret?: string; error?: string }) => {
        if (!cs) throw new Error(error ?? "No client secret");
        setClientSecret(cs);
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [isOpen, clientSecret]);

  const handleClose = () => {
    setClientSecret(null);  // force fresh PaymentIntent on next open
    setLoadError(null);
    setEmail("");
    setFullName("");
    onClose();
  };

  // All hooks must be called before early return
  if (!isOpen) return null;

  const isReady = !!stripePromise && !!clientSecret && !loadError;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto"
      style={{
        backgroundColor: "rgba(0,0,0,0.9)",
        backdropFilter:  "blur(12px)",
        padding:         "2rem 1rem",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        style={{
          position:        "relative",
          width:           "100%",
          maxWidth:        460,
          backgroundColor: "#0d0d0d",
          borderRadius:    20,
          border:          "1px solid #1e1e1e",
          overflow:        "hidden",
          boxShadow:       "0 0 80px rgba(79,110,247,0.12), 0 32px 80px rgba(0,0,0,0.85)",
        }}
      >

        {/* ── Header ── */}
        <div
          style={{
            display:        "flex",
            alignItems:     "center",
            justifyContent: "space-between",
            padding:        "16px 20px",
            borderBottom:   "1px solid #181818",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img
              src={`${BASE}/logo.png`}
              alt="Reelsona"
              style={{ width: 24, height: 24, objectFit: "contain" }}
            />
            <span style={{ fontWeight: 700, fontSize: "0.88rem", color: "#f0f0f0" }}>
              Reelsona
            </span>
          </div>
          <button
            onClick={handleClose}
            aria-label="Cerrar"
            style={{
              background:   "none",
              border:       "none",
              color:        "#555",
              cursor:       "pointer",
              padding:      4,
              display:      "flex",
              borderRadius: 8,
              lineHeight:   1,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Price strip ── */}
        <div
          style={{
            padding:        "12px 20px",
            background:     "linear-gradient(90deg, rgba(79,110,247,0.07), rgba(155,92,246,0.07))",
            borderBottom:   "1px solid #181818",
            display:        "flex",
            alignItems:     "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <p style={{ color: "#ddd", fontWeight: 600, fontSize: "0.85rem", margin: 0 }}>
              Acceso de lanzamiento · Pago único
            </p>
            <p style={{ color: "#555", fontSize: "0.7rem", marginTop: 3, marginBottom: 0 }}>
              Plataforma completa + ruta guiada
            </p>
          </div>
          <span
            style={{
              fontWeight:           700,
              fontSize:             "1.4rem",
              background:           "linear-gradient(135deg, #4F6EF7, #9B5CF6)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor:  "transparent",
              backgroundClip:       "text",
            }}
          >
            $47 USD
          </span>
        </div>

        {/* ── Form body ── */}
        <div style={{ padding: 20 }}>
          {loadError ? (
            <p
              style={{
                color:     "#f87171",
                fontSize:  "0.85rem",
                textAlign: "center",
                padding:   "40px 0",
              }}
            >
              {loadError}
            </p>
          ) : !isReady ? (
            <div
              style={{
                display:        "flex",
                alignItems:     "center",
                justifyContent: "center",
                padding:        "60px 0",
              }}
            >
              <Loader2
                size={28}
                className="animate-spin"
                style={{ color: "#4F6EF7" }}
              />
            </div>
          ) : (
            <Elements
              stripe={stripePromise}
              options={{
                clientSecret,
                appearance: STRIPE_APPEARANCE,
                locale:     "es",
              }}
            >
              <PaymentForm
                email={email}       setEmail={setEmail}
                fullName={fullName} setFullName={setFullName}
              />
            </Elements>
          )}
        </div>
      </div>
    </div>
  );
}
