import { Resend } from "resend"

let _resend: Resend | null = null
const FROM = process.env.RESEND_FROM_EMAIL ?? "info@reelsona.com"

function getResend(): Resend {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not configured. Add it to the production environment before sending email."
    )
  }
  if (!_resend) _resend = new Resend(apiKey)
  return _resend
}

export interface SendEmailOptions {
  to: string | string[]
  subject: string
  html: string
  text?: string
}

/**
 * Returns the canonical app URL for building links inside emails.
 * Logs a warning on first use if APP_URL is not configured.
 */
let _appUrlWarningLogged = false
export function getAppUrl(): string {
  const url = process.env.APP_URL?.trim().replace(/\/$/, "")
  if (!url) {
    if (!_appUrlWarningLogged) {
      console.warn(
        "[email] WARNING: APP_URL environment variable is not set. " +
        "Email links will fall back to https://reelsona.com — set APP_URL to the real deployment URL."
      )
      _appUrlWarningLogged = true
    }
    return "https://reelsona.com"
  }
  return url
}

export async function sendEmail(opts: SendEmailOptions) {
  const resend = getResend()
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

export function welcomeEmail(name: string, appUrl?: string) {
  const baseUrl = appUrl ?? getAppUrl()
  return {
    subject: "¡Bienvenido a Reelsona!",
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
        <h1 style="font-size:24px;margin-bottom:8px">Hola${name ? `, ${name}` : ""}! 👋</h1>
        <p style="color:#555">Ya eres parte de <strong>Reelsona</strong> — tu máquina de contenido con IA para Instagram.</p>
        <p style="color:#555">Conecta tu cuenta de Instagram y en minutos estarás generando reels automatizados con avatar.</p>
        <a href="${baseUrl}" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">
          Empezar ahora →
        </a>
        <p style="margin-top:32px;font-size:12px;color:#999">Reelsona · info@reelsona.com</p>
      </div>`,
    text: `Hola${name ? ` ${name}` : ""}! Bienvenido a Reelsona. Entra en ${baseUrl}`,
  }
}

export function activationEmail(name: string, activateUrl: string, toolAccessDays: number) {
  const plural = toolAccessDays === 1 ? "día" : "días"
  return {
    subject: "Tu acceso a Reelsona está listo 🎉",
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
        <h1 style="font-size:22px;margin-bottom:8px">¡Hola${name ? `, ${name}` : ""}! 👋</h1>
        <p style="color:#555">Tu acceso a <strong>Reelsona</strong> está listo. Tienes <strong>${toolAccessDays} ${plural}</strong> de acceso completo a la herramienta y acceso permanente al curso de implementación.</p>
        <p style="color:#555">Haz clic en el botón para elegir tu contraseña y comenzar:</p>
        <a href="${activateUrl}"
           style="display:inline-block;margin-top:20px;padding:14px 32px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">
          Activar mi cuenta →
        </a>
        <p style="margin-top:20px;color:#888;font-size:13px">Este enlace es válido por 7 días. Si tienes problemas, responde a este correo.</p>
        <p style="margin-top:32px;font-size:12px;color:#999">Reelsona · info@reelsona.com</p>
      </div>`,
    text: `Hola${name ? ` ${name}` : ""}! Tu acceso a Reelsona está listo (${toolAccessDays} ${plural}). Activa tu cuenta aquí: ${activateUrl}`,
  }
}

export function verificationEmail(name: string, verifyUrl: string) {
  return {
    subject: "Confirma tu correo — Reelsona",
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
        <h1 style="font-size:22px;margin-bottom:8px">Hola${name ? `, ${name}` : ""}! 👋</h1>
        <p style="color:#555">Gracias por registrarte en <strong>Reelsona</strong>. Solo falta un paso: confirma tu correo electrónico para activar tu cuenta.</p>
        <a href="${verifyUrl}"
           style="display:inline-block;margin-top:20px;padding:12px 28px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">
          Confirmar mi correo →
        </a>
        <p style="margin-top:20px;color:#888;font-size:13px">Este enlace expira en 24 horas. Si no creaste esta cuenta, puedes ignorar este correo.</p>
        <p style="margin-top:32px;font-size:12px;color:#999">Reelsona · info@reelsona.com</p>
      </div>`,
    text: `Hola${name ? ` ${name}` : ""}! Confirma tu correo en Reelsona: ${verifyUrl}`,
  }
}

export function passwordResetEmail(name: string, resetUrl: string) {
  return {
    subject: "Recupera tu contraseña — Reelsona",
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
        <h1 style="font-size:22px;margin-bottom:8px">Recuperar contraseña</h1>
        <p style="color:#555">Hola${name ? ` ${name}` : ""}, recibimos una solicitud para restablecer la contraseña de tu cuenta en <strong>Reelsona</strong>.</p>
        <p style="color:#555">Haz clic en el botón para elegir una nueva contraseña:</p>
        <a href="${resetUrl}"
           style="display:inline-block;margin-top:20px;padding:14px 32px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">
          Restablecer contraseña →
        </a>
        <p style="margin-top:20px;color:#888;font-size:13px">Este enlace es válido por 1 hora. Si no solicitaste este cambio, puedes ignorar este correo — tu contraseña no cambiará.</p>
        <p style="margin-top:32px;font-size:12px;color:#999">Reelsona · info@reelsona.com</p>
      </div>`,
    text: `Hola${name ? ` ${name}` : ""}! Restablece tu contraseña de Reelsona aquí (válido 1 hora): ${resetUrl}`,
  }
}

export function passwordChangedEmail(name: string) {
  return {
    subject: "Tu contraseña fue cambiada — Reelsona",
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
        <h1 style="font-size:20px">Contraseña actualizada</h1>
        <p style="color:#555">Hola${name ? ` ${name}` : ""}, te confirmamos que tu contraseña de Reelsona fue cambiada exitosamente.</p>
        <p style="color:#555">Si no fuiste tú, contáctanos de inmediato respondiendo este correo.</p>
        <p style="margin-top:32px;font-size:12px;color:#999">Reelsona · info@reelsona.com</p>
      </div>`,
    text: `Tu contraseña de Reelsona fue cambiada. Si no fuiste tú, contáctanos.`,
  }
}

export function videoFailedEmail(
  name: string,
  topic: string,
  scheduledAt: Date | null,
  appUrl?: string
) {
  const baseUrl = appUrl ?? getAppUrl()
  const scheduledStr = scheduledAt
    ? scheduledAt.toLocaleDateString("es-MX", {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null
  return {
    subject: "Tu Reel no pudo generarse — Reelsona",
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
        <h1 style="font-size:20px;margin-bottom:8px">Hubo un problema con tu Reel 😔</h1>
        <p style="color:#555">Hola${name ? ` ${name}` : ""}, el Reel <strong>"${topic}"</strong>${scheduledStr ? ` programado para el <strong>${scheduledStr}</strong>` : ""} no pudo generarse automáticamente.</p>
        <p style="color:#555">Puedes ver el detalle y reagendarlo desde tu Plan de Contenido:</p>
        <a href="${baseUrl}/content-plan"
           style="display:inline-block;margin-top:16px;padding:12px 24px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">
          Ver Plan de Contenido →
        </a>
        <p style="margin-top:20px;color:#888;font-size:13px">Si el problema persiste, contáctanos respondiendo este correo.</p>
        <p style="margin-top:32px;font-size:12px;color:#999">Reelsona · info@reelsona.com</p>
      </div>`,
    text: `Hola${name ? ` ${name}` : ""}! El Reel "${topic}"${scheduledStr ? ` programado para ${scheduledStr}` : ""} no pudo generarse. Reagéndalo en ${baseUrl}/content-plan`,
  }
}
