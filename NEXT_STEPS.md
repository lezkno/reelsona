# Next Steps

## Immediate Next Step

Abrir el instructivo (Artifact) y seguir el checklist paso a paso, empezando por confirmar/crear la app en `https://developers.facebook.com/apps/` usando el `INSTAGRAM_APP_ID` que ya está configurado en Replit Secrets.

## Later Steps

- Completar Business Verification en Meta Business Manager (subir documentos legales del negocio).
- Confirmar o publicar la URL pública de política de privacidad de Reelsona/ContentPilot y el mecanismo de borrado de datos.
- Registrar en el Meta App Dashboard los `Valid OAuth Redirect URIs` exactamente iguales a los que acepta `isAllowedRedirectUri` en `artifacts/api-server/src/routes/instagram.ts` (dominios `*.replit.dev`, `*.replit.app`, `reelsona.com`, `*.reelsona.com`).
- Grabar los 3 videos de demostración (uno por permiso: basic, content_publish, insights) siguiendo la guía del instructivo.
- Llenar el formulario "Request Advanced Access" con los textos en inglés ya redactados en el instructivo (uno distinto por permiso, no copiar/pegar el mismo texto).
- Enviar la solicitud y esperar la revisión de Meta (2–4 semanas típico).
- Si se rechaza algún permiso, revisar el motivo exacto en el Dashboard y corregir solo lo señalado (no reenviar sin cambios).
- (Futuro, opcional) Si Reelsona agrega funciones de mensajería directa o respuesta automática a comentarios, evaluar solicitar `instagram_business_manage_messages` / `instagram_business_manage_comments` en una revisión posterior.

## Blockers

- Se necesita una cuenta de Instagram Business o Creator real (no personal) para las pruebas y para grabar los videos.
- Se necesita acceso a Meta Business Manager con permisos de administrador para completar la Business Verification (esto lo debe hacer una persona, no un agente).
- No se confirmó dentro del repo si ya existe una URL pública de política de privacidad — es una pregunta abierta para el usuario.

## Questions

- ¿Ya existe una política de privacidad pública para Reelsona (URL)? Si no, hay que crearla y publicarla antes de poder enviar la revisión.
- ¿La app de Meta for Developers ya fue creada (usando el `INSTAGRAM_APP_ID` que está en Replit Secrets), o hay que crearla desde cero?
- ¿Quién tiene acceso al Meta Business Manager de la empresa/marca para hacer la Business Verification?

## Suggested Tests

- No aplica testing de código en esta tarea (es documentación/proceso externo).
- Verificación sugerida antes de grabar los videos: hacer un login de prueba real con una cuenta Business/Creator en el ambiente de Replit publicado (`reelsona.com` o `*.replit.app`) y confirmar que el flujo completo (conectar → auditar → publicar un Reel) funciona sin errores, ya que el reviewer de Meta necesita ver ese flujo funcionando en los screencasts.
