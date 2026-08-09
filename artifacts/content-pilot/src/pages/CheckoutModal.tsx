/**
 * CheckoutModal
 *
 * Opens a dark overlay with Stripe Embedded Checkout mounted inside.
 *
 * Performance: Stripe.js starts loading as soon as this component mounts
 * (i.e. when Landing renders), NOT when the modal opens. By the time the
 * user clicks "Empezar a crear Reels", Stripe.js is already downloaded.
 */

import { useCallback, useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from "@stripe/react-stripe-js";
import { Loader2, X } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function CheckoutModal({ isOpen, onClose }: Props) {
  const [stripePromise, setStripePromise] = useState<ReturnType<typeof loadStripe> | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  // ── Pre-load Stripe.js on mount, not on modal open ───────────────────────
  // useEffect with [] runs after the first render (when Landing.tsx mounts),
  // giving Stripe.js ~5-10 s to download before the user ever clicks the CTA.
  useEffect(() => {
    fetch(`${BASE}/api/config/public`)
      .then((r) => r.json())
      .then(({ stripePublishableKey }: { stripePublishableKey: string | null }) => {
        if (!stripePublishableKey) {
          setConfigError("El checkout no está disponible en este momento.");
          return;
        }
        // loadStripe starts fetching stripe.js from CDN immediately
        setStripePromise(loadStripe(stripePublishableKey));
      })
      .catch(() =>
        setConfigError("No se pudo conectar con el servidor de pagos.")
      );
  }, []); // ← intentionally empty: run once when Landing mounts

  // ── Called by EmbeddedCheckoutProvider to get a fresh session secret ─────
  const fetchClientSecret = useCallback(async (): Promise<string> => {
    const res = await fetch(`${BASE}/api/checkout/create-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embedded: true }),
    });
    const data: { clientSecret?: string; error?: string } = await res.json();
    if (!data.clientSecret)
      throw new Error(data.error ?? "No client secret returned");
    return data.clientSecret;
  }, []);

  // Hooks must be called before any early return — render nothing when closed
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto"
      style={{
        backgroundColor: "rgba(0,0,0,0.88)",
        backdropFilter: "blur(10px)",
        padding: "2rem 1rem",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full rounded-2xl overflow-hidden"
        style={{
          maxWidth: 500,
          backgroundColor: "#0d0d0d",
          border: "1px solid rgba(79,110,247,0.28)",
          boxShadow:
            "0 0 100px rgba(79,110,247,0.18), 0 32px 80px rgba(0,0,0,0.75)",
        }}
      >
        {/* ── Header ── */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid #181818" }}
        >
          <div className="flex items-center gap-2">
            <img
              src={`${BASE}/logo.png`}
              alt="Reelsona"
              style={{ width: 26, height: 26, objectFit: "contain" }}
            />
            <span
              className="font-bold"
              style={{
                fontSize: "0.9rem",
                color: "#f0f0f0",
                fontFamily: "var(--font-display, 'Outfit', sans-serif)",
              }}
            >
              Reelsona
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="flex items-center justify-center rounded-lg transition-colors hover:bg-white/5"
            style={{
              width: 32,
              height: 32,
              color: "#555",
              cursor: "pointer",
              background: "none",
              border: "none",
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Price strip ── */}
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{
            background:
              "linear-gradient(90deg, rgba(79,110,247,0.07), rgba(155,92,246,0.07))",
            borderBottom: "1px solid #181818",
          }}
        >
          <div>
            <p
              className="font-semibold"
              style={{ color: "#ddd", fontSize: "0.88rem" }}
            >
              Acceso de lanzamiento · Pago único
            </p>
            <p style={{ color: "#555", fontSize: "0.72rem", marginTop: 2 }}>
              Incluye plataforma completa + ruta guiada
            </p>
          </div>
          <span
            className="font-bold"
            style={{
              fontSize: "1.5rem",
              background: "linear-gradient(135deg, #4F6EF7, #9B5CF6)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            $47 USD
          </span>
        </div>

        {/* ── Stripe Embedded Checkout ── */}
        <div style={{ minHeight: 280 }}>
          {configError ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 px-6 text-center">
              <p style={{ color: "#cc4444", fontSize: "0.875rem" }}>
                {configError}
              </p>
            </div>
          ) : !stripePromise ? (
            <div className="flex items-center justify-center py-20">
              <Loader2
                className="animate-spin"
                size={28}
                style={{ color: "#4F6EF7" }}
              />
            </div>
          ) : (
            <EmbeddedCheckoutProvider
              stripe={stripePromise}
              options={{ fetchClientSecret }}
            >
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          )}
        </div>

        {/* ── Footer note ── */}
        <p
          className="text-center px-5 pb-4 pt-2"
          style={{ color: "#333", fontSize: "0.7rem", lineHeight: 1.6 }}
        >
          Pago seguro con Stripe · Requiere HeyGen y OpenAI (costos separados)
        </p>
      </div>
    </div>
  );
}
