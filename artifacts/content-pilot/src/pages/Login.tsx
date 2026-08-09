import { useState } from "react"
import { Link } from "wouter"
import { Loader2, Lock } from "lucide-react"
import { useLogin } from "@workspace/api-client-react"

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "")

interface LoginProps {
  onSuccess: () => void
}

export default function Login({ onSuccess }: LoginProps) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const login = useLogin()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    login.mutate({ username, password }, {
      onSuccess: () => onSuccess(),
      onError: (err: any) => {
        setError(err?.data?.error ?? err?.message ?? "Usuario o contraseña incorrectos")
      },
    })
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-4"
      style={{ backgroundColor: "#080808" }}
    >
      {/* Ambient glow */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          top: "10%",
          left: "50%",
          transform: "translateX(-50%)",
          width: 600,
          height: 300,
          background: "radial-gradient(ellipse, rgba(79,110,247,0.12) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      <div className="w-full relative" style={{ maxWidth: 400 }}>
        {/* Logo + brand */}
        <div className="flex flex-col items-center mb-8 gap-3">
          <img
            src={`${BASE}/logo.png`}
            alt="Reelsona"
            style={{ width: 52, height: 52, objectFit: "contain" }}
          />
          <h1
            className="font-bold"
            style={{
              fontSize: "1.5rem",
              fontFamily: "var(--font-display, 'Outfit', sans-serif)",
              background: "linear-gradient(135deg, #ffffff 40%, #9B5CF6)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            Reelsona
          </h1>
          <p style={{ color: "#555", fontSize: "0.85rem" }}>
            Accede a tu cuenta
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-7"
          style={{
            backgroundColor: "#0f0f0f",
            border: "1px solid #1e1e1e",
            boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
          }}
        >
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            {/* Username */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="username"
                style={{ color: "#aaa", fontSize: "0.8rem", fontWeight: 500 }}
              >
                Usuario
              </label>
              <input
                id="username"
                type="text"
                placeholder="tu_usuario"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
                style={{
                  background: "#161616",
                  border: "1px solid #2a2a2a",
                  borderRadius: 10,
                  padding: "0.65rem 0.9rem",
                  color: "#f0f0f0",
                  fontSize: "0.9rem",
                  outline: "none",
                  transition: "border-color 0.15s",
                  width: "100%",
                  boxSizing: "border-box",
                }}
                onFocus={(e) => (e.target.style.borderColor = "#4F6EF7")}
                onBlur={(e) => (e.target.style.borderColor = "#2a2a2a")}
              />
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="password"
                style={{ color: "#aaa", fontSize: "0.8rem", fontWeight: 500 }}
              >
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                style={{
                  background: "#161616",
                  border: "1px solid #2a2a2a",
                  borderRadius: 10,
                  padding: "0.65rem 0.9rem",
                  color: "#f0f0f0",
                  fontSize: "0.9rem",
                  outline: "none",
                  transition: "border-color 0.15s",
                  width: "100%",
                  boxSizing: "border-box",
                }}
                onFocus={(e) => (e.target.style.borderColor = "#4F6EF7")}
                onBlur={(e) => (e.target.style.borderColor = "#2a2a2a")}
              />
            </div>

            {/* Error */}
            {error && (
              <p
                className="text-center rounded-lg py-2.5 px-3"
                style={{
                  color: "#f87171",
                  fontSize: "0.82rem",
                  background: "rgba(248,113,113,0.08)",
                  border: "1px solid rgba(248,113,113,0.18)",
                }}
              >
                {error}
              </p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={login.isPending || !username || !password}
              className="flex items-center justify-center gap-2 rounded-xl font-bold transition-opacity"
              style={{
                background: login.isPending || !username || !password
                  ? "#1e1e1e"
                  : "linear-gradient(135deg, #4F6EF7, #7B5CF6)",
                color: login.isPending || !username || !password ? "#444" : "#fff",
                padding: "0.75rem",
                fontSize: "0.95rem",
                border: "none",
                cursor: login.isPending || !username || !password ? "not-allowed" : "pointer",
                opacity: login.isPending ? 0.7 : 1,
              }}
            >
              {login.isPending ? (
                <><Loader2 size={16} className="animate-spin" /> Entrando…</>
              ) : (
                <><Lock size={15} /> Entrar</>
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center mt-6" style={{ color: "#333", fontSize: "0.78rem" }}>
          ¿Aún no tienes acceso?{" "}
          <Link
            href="/landing"
            style={{ color: "#4F6EF7", textDecoration: "none" }}
          >
            Conoce Reelsona →
          </Link>
        </p>
      </div>
    </div>
  )
}
