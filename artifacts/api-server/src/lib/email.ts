import { Resend } from "resend"

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = process.env.RESEND_FROM_EMAIL ?? "info@reelsona.com"

export interface SendEmailOptions {
  to: string | string[]
  subject: string
  html: string
  text?: string
}

export async function sendEmail(opts: SendEmailOptions) {
  const { data, error } = await resend.emails.send({
    from: `Reelsona <${FROM}>`,
    to: Array.isArray(opts.to) ? opts.to : [opts.to],
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  })

  if (error) {
    throw new Error(`Resend error: ${error.message}`)
  }

  return data
}

// ── Plantillas ────────────────────────────────────────────────────────────────

export function welcomeEmail(name: string) {
  return {
    subject: "¡Bienvenido a Reelsona!",
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
        <h1 style="font-size:24px;margin-bottom:8px">Hola${name ? `, ${name}` : ""}! 👋</h1>
        <p style="color:#555">Ya sos parte de <strong>Reelsona</strong> — tu máquina de contenido con IA para Instagram.</p>
        <p style="color:#555">Conectá tu cuenta de Instagram y en minutos estarás generando reels automatizados con avatar.</p>
        <a href="https://reelsona.com" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">
          Empezar ahora →
        </a>
        <p style="margin-top:32px;font-size:12px;color:#999">Reelsona · info@reelsona.com</p>
      </div>`,
    text: `Hola${name ? ` ${name}` : ""}! Bienvenido a Reelsona. Conectá tu cuenta de Instagram en https://reelsona.com`,
  }
}

export function passwordChangedEmail(name: string) {
  return {
    subject: "Tu contraseña fue cambiada — Reelsona",
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
        <h1 style="font-size:20px">Contraseña actualizada</h1>
        <p style="color:#555">Hola${name ? ` ${name}` : ""}, te confirmamos que tu contraseña de Reelsona fue cambiada exitosamente.</p>
        <p style="color:#555">Si no fuiste vos, contactanos de inmediato respondiendo este email.</p>
        <p style="margin-top:32px;font-size:12px;color:#999">Reelsona · info@reelsona.com</p>
      </div>`,
    text: `Tu contraseña de Reelsona fue cambiada. Si no fuiste vos, contactanos.`,
  }
}
