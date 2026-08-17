import { Link } from "wouter"
import { ArrowLeft } from "lucide-react"

export default function TermsAndConditions() {
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
            <span className="font-bold text-lg tracking-tight">Reelsona</span>
          </div>
          <h1 className="text-4xl font-bold tracking-tight mb-3">Términos y Condiciones</h1>
          <p className="text-muted-foreground">Última actualización: 9 de agosto de 2026</p>
        </div>

        {/* Body */}
        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8 text-sm leading-7">

          <section>
            <h2 className="text-xl font-semibold mb-3">1. Aceptación de los Términos</h2>
            <p>
              Al acceder o usar Reelsona, disponible en <strong>reelsona.com</strong> ("el Servicio"), aceptas
              quedar vinculado por estos Términos y Condiciones ("Términos"). Si no aceptas estos Términos en su
              totalidad, no puedes usar el Servicio.
            </p>
            <p className="mt-2">
              Nos reservamos el derecho de modificar estos Términos en cualquier momento. Los cambios materiales
              serán notificados con al menos 15 días de anticipación. El uso continuado del Servicio después de
              esa notificación implica la aceptación de los Términos modificados.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">2. Descripción del Servicio</h2>
            <p>
              Reelsona es una plataforma de automatización de contenido que permite a los usuarios:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Generar guiones para videos con inteligencia artificial.</li>
              <li>Crear videos con avatares digitales mediante IA.</li>
              <li>Programar y publicar Reels de Instagram de manera automática.</li>
              <li>Analizar el rendimiento de su cuenta de Instagram.</li>
            </ul>
            <p className="mt-3">
              El Servicio requiere que conectes tu cuenta de Instagram a través de la API oficial de Meta y que
              otorguemos los permisos necesarios para publicar en tu nombre.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">3. Elegibilidad y Cuenta</h2>
            <p>
              Para usar Reelsona debes tener al menos 18 años o la mayoría de edad en tu jurisdicción. Las
              cuentas son personales e intransferibles. Eres responsable de mantener la confidencialidad de tus
              credenciales y de toda la actividad que ocurra bajo tu cuenta.
            </p>
            <p className="mt-2">
              Debes notificarnos inmediatamente si sospechas acceso no autorizado a tu cuenta.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">4. Uso del Servicio y Conducta del Usuario</h2>
            <p>Al usar Reelsona te comprometes a:</p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>Cumplir con los <a href="https://help.instagram.com/581066165581870" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">Términos de Uso de Instagram</a> y las <a href="https://developers.facebook.com/policy/" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">Políticas de la Plataforma de Meta</a>.</li>
              <li>Publicar únicamente contenido del cual tienes los derechos necesarios.</li>
              <li>No usar el Servicio para difundir información falsa, contenido engañoso, spam, o material que viole derechos de terceros.</li>
              <li>No intentar eludir las limitaciones técnicas del Servicio ni acceder a recursos que no te corresponden.</li>
              <li>No usar el Servicio para actividades ilegales o que violen derechos de terceros.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">5. Contenido del Usuario</h2>
            <p>
              Eres el único responsable del contenido que publicas a través de Reelsona. Nos otorgas una
              licencia limitada, no exclusiva y revocable para almacenar y procesar dicho contenido únicamente
              con el fin de prestar el Servicio.
            </p>
            <p className="mt-2">
              Reelsona no revisa de manera proactiva el contenido generado o publicado por los usuarios.
              Sin embargo, nos reservamos el derecho de suspender cuentas que violen estos Términos o las
              políticas de Meta.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">6. API de Instagram / Meta</h2>
            <p>
              El Servicio depende de la API de Meta para publicar en Instagram. Reelsona no garantiza la
              disponibilidad continua de esta integración. Meta puede modificar, restringir o discontinuar su
              API en cualquier momento, lo cual podría afectar total o parcialmente el funcionamiento del
              Servicio sin responsabilidad para nosotros.
            </p>
            <p className="mt-2">
              Al conectar tu cuenta de Instagram aceptás los términos de Meta para el acceso de aplicaciones
              de terceros a tu cuenta. Puedes revocar el acceso en cualquier momento desde la configuración de
              Instagram.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">7. Inteligencia Artificial y Contenido Generado</h2>
            <p>
              El contenido generado por las herramientas de IA integradas en Reelsona (guiones, títulos,
              sugerencias) se proporciona "tal cual". No garantizamos que dicho contenido sea preciso, adecuado
              para su uso en redes sociales, ni que no infrinja derechos de terceros.
            </p>
            <p className="mt-2">
              Eres responsable de revisar y aprobar todo el contenido antes de su publicación, especialmente en
              el modo de automatización. El uso del modo automático implica que aceptas que el contenido sea
              publicado sin revisión manual previa.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">8. Disponibilidad del Servicio</h2>
            <p>
              Nos esforzamos por mantener Reelsona disponible de manera continua, pero no garantizamos
              disponibilidad del 100%. El Servicio puede interrumpirse por mantenimiento, actualizaciones,
              fallas técnicas o circunstancias fuera de nuestro control.
            </p>
            <p className="mt-2">
              Las publicaciones programadas dependen de la disponibilidad simultánea de Reelsona y de la
              API de Meta. No somos responsables por publicaciones omitidas debido a interrupciones en cualquiera
              de los dos servicios.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">9. Limitación de Responsabilidad</h2>
            <p>
              En la máxima medida permitida por la ley aplicable, Reelsona y sus operadores no serán
              responsables por:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Pérdida de ganancias, seguidores, alcance o cualquier daño indirecto derivado del uso del Servicio.</li>
              <li>Publicaciones incorrectas, duplicadas u omitidas causadas por fallas en la API de Meta o por la configuración del usuario.</li>
              <li>Suspensión de cuentas de Instagram por parte de Meta debida al contenido publicado a través del Servicio.</li>
              <li>Acceso no autorizado a tu cuenta causado por vulneración de tus propias credenciales.</li>
            </ul>
            <p className="mt-3">
              Nuestra responsabilidad máxima ante ti no excederá el monto que hayas pagado por el Servicio en
              los últimos 3 meses.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">10. Propiedad Intelectual</h2>
            <p>
              Reelsona, su diseño, código fuente, marca y funcionalidades son propiedad de sus operadores
              y están protegidos por derechos de autor y otras leyes de propiedad intelectual. No puedes copiar,
              modificar, distribuir ni crear obras derivadas del Servicio sin autorización expresa.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">11. Terminación</h2>
            <p>
              Podemos suspender o terminar tu acceso al Servicio en cualquier momento si incumplís estos
              Términos, las políticas de Meta, o si lo consideramos necesario para proteger la integridad del
              Servicio.
            </p>
            <p className="mt-2">
              Puedes solicitar la eliminación de tu cuenta en cualquier momento contactándonos. Al eliminar tu
              cuenta, tus datos serán borrados conforme a nuestra Política de Privacidad.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">12. Ley Aplicable</h2>
            <p>
              Estos Términos se rigen por las leyes aplicables al domicilio de los operadores del Servicio.
              Cualquier disputa que no pueda resolverse de manera amistosa será sometida a la jurisdicción
              de los tribunales competentes correspondientes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">13. Contacto</h2>
            <p>
              Si tienes preguntas sobre estos Términos, escríbenos a:{" "}
              <a href="mailto:legal@reelsona.com" className="text-primary underline underline-offset-2">
                legal@reelsona.com
              </a>
            </p>
          </section>
        </div>

        {/* Footer */}
        <div className="mt-16 pt-8 border-t text-xs text-muted-foreground flex flex-wrap gap-4">
          <span>© 2026 Reelsona / reelsona.com</span>
          <Link href="/privacy" className="hover:text-foreground transition-colors underline underline-offset-2">
            Política de Privacidad
          </Link>
        </div>
      </div>
    </div>
  )
}
