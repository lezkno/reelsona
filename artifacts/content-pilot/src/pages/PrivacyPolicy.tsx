import { Link } from "wouter"
import { ArrowLeft } from "lucide-react"

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-10">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8">
            <ArrowLeft className="w-4 h-4" />
            Volver al inicio
          </Link>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm shadow-[0_0_12px_rgba(100,50,255,0.4)]">
              CP
            </div>
            <span className="font-bold text-lg tracking-tight">ContentPilot</span>
          </div>
          <h1 className="text-4xl font-bold tracking-tight mb-3">Política de Privacidad</h1>
          <p className="text-muted-foreground">Última actualización: 9 de agosto de 2026</p>
        </div>

        {/* Body */}
        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8 text-sm leading-7">

          <section>
            <h2 className="text-xl font-semibold mb-3">1. Información general</h2>
            <p>
              ContentPilot ("nosotros", "nuestro" o "el Servicio") es una plataforma de automatización de contenido
              para Instagram operada a través de <strong>reelsona.com</strong>. Esta Política de Privacidad describe
              qué datos recopilamos, cómo los usamos y cuáles son tus derechos sobre ellos.
            </p>
            <p>
              Al usar ContentPilot aceptás esta política. Si no estás de acuerdo con alguna parte, te pedimos que
              no uses el Servicio.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">2. Datos que recopilamos</h2>
            <h3 className="font-semibold mb-2 text-base">2.1 Datos de cuenta</h3>
            <p>
              Cuando creas una cuenta en ContentPilot recopilamos tu nombre de usuario y contraseña (almacenada
              con hash seguro). No recopilamos direcciones de correo electrónico a menos que las ingreses
              voluntariamente en la configuración de perfil.
            </p>
            <h3 className="font-semibold mb-2 text-base">2.2 Datos de Instagram / Meta</h3>
            <p>
              Al conectar tu cuenta de Instagram a través de la API oficial de Meta, obtenemos y almacenamos:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Tu nombre de usuario e ID de Instagram</li>
              <li>Foto de perfil y cantidad de seguidores</li>
              <li>Token de acceso de larga duración (necesario para publicar en tu nombre)</li>
              <li>Estadísticas de publicaciones (me gusta, comentarios, alcance, reproducciones) cuando auditás tu cuenta</li>
            </ul>
            <h3 className="font-semibold mb-2 text-base mt-4">2.3 Contenido generado</h3>
            <p>
              Almacenamos los guiones, videos, subtítulos y temas que se generan o suben dentro de la plataforma,
              vinculados a tu cuenta.
            </p>
            <h3 className="font-semibold mb-2 text-base mt-4">2.4 Datos de uso</h3>
            <p>
              Registramos logs de acceso a la API (método, ruta, código de respuesta, timestamp) para fines de
              seguridad y diagnóstico. No almacenamos el contenido de las solicitudes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">3. Cómo usamos tus datos</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong>Publicación automática:</strong> usamos tu token de acceso de Instagram para publicar
                Reels en tu nombre según la programación que configurés.
              </li>
              <li>
                <strong>Generación de contenido:</strong> los temas e instrucciones que configuras se envían a
                modelos de inteligencia artificial (OpenAI) para generar guiones y videos. No usamos tus datos
                para entrenar modelos externos.
              </li>
              <li>
                <strong>Análisis de rendimiento:</strong> las estadísticas de tus publicaciones se usan exclusivamente
                para mostrarte información dentro de la plataforma.
              </li>
              <li>
                <strong>Seguridad y mejoras:</strong> los logs de uso nos permiten detectar errores, abusos y
                mejorar el Servicio.
              </li>
            </ul>
            <p className="mt-3">
              No vendemos ni compartimos tus datos personales con terceros con fines comerciales.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">4. Terceros con acceso a datos</h2>
            <p>Para operar el Servicio usamos los siguientes proveedores:</p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>
                <strong>Meta Platforms, Inc.</strong> — proveedor de la API de Instagram. Tus datos de Instagram
                se obtienen y envían según los Términos de la API de Meta.
              </li>
              <li>
                <strong>OpenAI, L.L.C.</strong> — generación de texto e imágenes con IA. Los guiones y prompts
                se envían a OpenAI; aplicamos políticas de uso responsable de la API.
              </li>
              <li>
                <strong>Proveedor de IA</strong> — generación de videos con avatar digital. Los guiones se envían
                para la producción de videos.
              </li>
              <li>
                <strong>Replit, Inc.</strong> — infraestructura de hosting y base de datos.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">5. Almacenamiento y seguridad</h2>
            <p>
              Tus datos se almacenan en bases de datos PostgreSQL alojadas en infraestructura segura. Las
              contraseñas se hashean con scrypt antes de guardarse. Los tokens de acceso de Instagram se
              almacenan en la base de datos y se transmiten únicamente por conexiones HTTPS.
            </p>
            <p className="mt-2">
              No podemos garantizar seguridad absoluta; en caso de una brecha que afecte tus datos, te
              notificaremos en un plazo razonable.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">6. Retención de datos</h2>
            <p>
              Conservamos tus datos mientras tu cuenta esté activa. Si solicitas la eliminación de tu cuenta,
              borramos tus datos personales e Instagram token dentro de los 30 días hábiles siguientes, salvo
              que debamos retenerlos por obligaciones legales.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">7. Tus derechos</h2>
            <p>Tienes derecho a:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Acceder a los datos personales que tenemos sobre ti.</li>
              <li>Solicitar la corrección de datos incorrectos.</li>
              <li>Solicitar la eliminación de tu cuenta y datos asociados.</li>
              <li>Revocar en cualquier momento el acceso de ContentPilot a tu cuenta de Instagram desde la
                configuración de Instagram → Aplicaciones y sitios web.</li>
            </ul>
            <p className="mt-3">
              Para ejercer cualquiera de estos derechos, contáctanos en el correo indicado en la sección 9.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">8. Cookies y sesiones</h2>
            <p>
              ContentPilot usa cookies de sesión HTTP estrictamente necesarias para mantener tu sesión
              autenticada. No usamos cookies de seguimiento ni publicidad de terceros.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">9. Contacto</h2>
            <p>
              Si tienes preguntas sobre esta política o quieres ejercer tus derechos, escríbenos a:{" "}
              <a href="mailto:privacidad@reelsona.com" className="text-primary underline underline-offset-2">
                privacidad@reelsona.com
              </a>
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">10. Cambios a esta política</h2>
            <p>
              Podemos actualizar esta Política de Privacidad. Cuando lo hagamos, actualizaremos la fecha de
              "Última actualización" al inicio de esta página. Te recomendamos revisarla periódicamente.
            </p>
          </section>
        </div>

        {/* Footer */}
        <div className="mt-16 pt-8 border-t text-xs text-muted-foreground flex flex-wrap gap-4">
          <span>© 2026 ContentPilot / reelsona.com</span>
          <Link href="/terms" className="hover:text-foreground transition-colors underline underline-offset-2">
            Términos y Condiciones
          </Link>
        </div>
      </div>
    </div>
  )
}
