# Progress

## Project Goal

Reelsona (nombre interno "ContentPilot") es una app web que automatiza la generación y publicación de Reels de Instagram: conecta la cuenta de Instagram del usuario, audita el rendimiento de su contenido, genera guiones con IA, crea videos con avatares de HeyGen/WaveSpeed y publica Reels en piloto automático según un horario configurado.

## Current Task

Preparar todo lo necesario para pasar la **revisión de la app ante Meta (App Review)** y así poder salir del modo "Development" de la app de Meta for Developers — hoy solo cuentas de Instagram agregadas manualmente como testers pueden conectarse; se necesita Advanced Access para que cualquier usuario real conecte su cuenta.

## Status

Documentación / preparación para App Review — **no se modificó código de la aplicación** en esta sesión.

## Completed

- Análisis completo del repo (arquitectura, stack, integraciones) documentado en `HANDOFF.md`.
- Identificados los 3 scopes de Instagram que la app ya solicita en producción (`instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights`) leyendo el código real (`artifacts/api-server/src/lib/instagram-api.ts`).
- Creados los 5 archivos de continuidad (`PROGRESS.md`, `FILES_TOUCHED.md`, `DECISIONS.md`, `NEXT_STEPS.md`, `HANDOFF.md`).
- Instructivo completo de Meta App Review publicado como Artifact (ver enlace en `HANDOFF.md` / mensaje al usuario), con: checklist de requisitos previos, textos en inglés para copiar/pegar por permiso, guía de los videos de demostración a grabar, y el paso a paso completo con el enlace de inicio.

## In Progress

Ninguno del lado del código. El usuario debe ejecutar manualmente los pasos del instructivo en el navegador (login en Meta for Developers, verificación de negocio, subir documentos, grabar y subir screencasts).

## Remaining

- El usuario debe crear/confirmar la app en `https://developers.facebook.com/apps/` con el `INSTAGRAM_APP_ID` ya usado en Replit Secrets.
- Completar Business Verification en Meta Business Manager.
- Publicar/confirmar la política de privacidad pública y el mecanismo de borrado de datos de Reelsona.
- Grabar los 3 videos de demostración (uno por permiso) siguiendo la guía del instructivo.
- Enviar la solicitud de Advanced Access para los 3 permisos y esperar respuesta de Meta (2–4 semanas típico).

## Known Issues

- No se pudo hacer `WebFetch` directo a `developers.facebook.com` (bloqueado por el proxy de egress del entorno) — la investigación de reglas de Meta se hizo con fuentes secundarias vía `WebSearch`, cruzando varias fuentes para confirmar cada dato.
- ~~No hay confirmación en el repo de que exista ya una URL pública de política de privacidad~~ **Resuelto (2026-09-18)**: sí existe, verificada leyendo `artifacts/content-pilot/src/pages/PrivacyPolicy.tsx` y su ruta en `App.tsx` — pública en `https://reelsona.com/privacy`, confirmada también en el footer de `reelsona.com/landing`.

## Last Update

2026-09-22 — Se auditó todo el desarrollo hecho directamente desde Replit en `origin/stabilization-current-workspace` (262 commits desde que se armó el kit) para sincronizar el conocimiento del proyecto. Conclusión: scopes, redirect URIs y política de privacidad siguen exactamente iguales — el core del kit no cambió. Sí se agregó al kit (Artifact + PDF): una hoja de referencia rápida (scopes, env vars, URLs) pensada para que un asistente humano o un agente la use de un vistazo, y una sección de troubleshooting con hallazgos reales del hardening de OAuth (error código 100 de Meta, distinción de fallas de red vs. rechazos de permisos, verbos HTTP correctos por llamada, comportamiento de reintento de Reels fallidos).
