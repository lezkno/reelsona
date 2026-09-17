# Handoff

## Project Summary

Reelsona (alias interno "ContentPilot") es una app web (React + Express + PostgreSQL, monorepo pnpm, corre en Replit) que automatiza la generación y publicación de Reels de Instagram usando avatares de HeyGen/WaveSpeed. Flujo: conectar Instagram → auditar rendimiento (IA) → generar guiones (IA) → generar video con avatar → publicar Reel automáticamente según horario.

## Current State

La integración con Instagram ya está implementada y funcionando en modo **Development/Test** de Meta (solo testers agregados manualmente pueden conectar su cuenta). Falta pasar **App Review** de Meta para que cualquier usuario real pueda conectar su Instagram y usar la app en producción.

## What Changed

- Se creó documentación de continuidad (esta sesión no tocó código).
- Se investigó a fondo el repo y las reglas actuales de Meta App Review.
- Se publicó un instructivo completo (Artifact) para guiar al usuario por todo el proceso de revisión.

## Files Touched

- `PROGRESS.md`
- `FILES_TOUCHED.md`
- `DECISIONS.md`
- `NEXT_STEPS.md`
- `HANDOFF.md`

(Ver detalle en `FILES_TOUCHED.md`. No se tocó código de `artifacts/` ni `lib/`.)

## Key Findings (para quien retome esta sesión)

- **Integración real**: `artifacts/api-server/src/lib/instagram-api.ts` (cliente OAuth + Graph API), `artifacts/api-server/src/routes/instagram.ts` (rutas Express), `artifacts/content-pilot/src/components/InstagramConnectCard.tsx` (UI), `lib/db/src/schema/instagram-accounts.ts` (tabla DB).
- **Producto usado**: "Instagram API with Instagram Login (Business)" — el flujo nuevo de Meta que NO pasa por una Página de Facebook. Auth URL: `https://www.instagram.com/oauth/authorize`.
- **Scopes pedidos hoy en el código** (función `getAuthUrl` en `instagram-api.ts`):
  - `instagram_business_basic`
  - `instagram_business_content_publish`
  - `instagram_business_manage_insights`
- **Env vars**: `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` (Replit Secrets, no `.env` en el repo).
- **Redirects permitidos** (`isAllowedRedirectUri` en `routes/instagram.ts`): `localhost`, `*.replit.dev`, `*.replit.app`, `reelsona.com`, `*.reelsona.com` — deben coincidir EXACTO con lo registrado en el Meta App Dashboard.
- **Solo cuentas Business/Creator**: el callback rechaza cuentas personales (`routes/instagram.ts`).
- **No hay webhooks de Meta** (solo webhook de Stripe para billing) ni integración de TikTok/YouTube.
- **Publish flow**: `createReelContainer` → poll de estado → `publishContainer` (con ledger de idempotencia en tabla `instagram_publish_attempts` por el timeout de 30s del proxy de Replit).
- **Documentación previa relevante**: `.agents/memory/instagram-oauth-setup.md` y `.agents/memory/instagram-publish-pipeline.md` — léelos antes de tocar esa integración.

## Decisions Made

Ver `DECISIONS.md`. Resumen: no modificar código; basar el instructivo solo en los 3 scopes ya implementados; entregar el instructivo como Artifact en vez de archivo Markdown en el repo (decidido por el usuario).

## Remaining Work

Ver `NEXT_STEPS.md`. Es trabajo manual del usuario en el navegador (Meta for Developers + Meta Business Manager) — un agente no puede completarlo de forma autónoma porque requiere login humano, subir documentos legales y grabar video de pantalla real.

## Risks

- Bajo riesgo técnico (no se tocó código).
- Riesgo del proceso de Meta: si el screencast o el texto en inglés no coincide exactamente con el uso real del permiso, Meta rechaza la solicitud y hay que resubmitir (pierde tiempo, no es destructivo).
- Verificar antes de grabar los videos que exista una política de privacidad pública — si no existe, el envío se bloqueará en el Dashboard.

## Commands Run

- `git status` / `git branch --show-current` (solo lectura, para confirmar rama y estado limpio antes de escribir archivos).
- Ninguna instalación, build ni test ejecutados (no aplicable a esta tarea).

## Commands To Run Next

- Ninguno de código. El "próximo comando" es abrir el enlace `https://developers.facebook.com/apps/` en el navegador y seguir el instructivo.

## Instructivo (Artifact)

https://claude.ai/artifact/GNMSRuQn2DQ8aR8fmm3fvQ

## Restart Prompt

Continue this project from the current handoff.

Goal:
Preparar y ejecutar la revisión de Meta App Review para los 3 permisos de Instagram (`instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights`) que Reelsona ya usa en `artifacts/api-server/src/lib/instagram-api.ts`.

Current state:
Documentación de continuidad creada; instructivo (Artifact) publicado con checklist, textos en inglés y guía de videos. Nada del código se modificó. Falta que el usuario ejecute los pasos manuales en Meta for Developers / Meta Business Manager.

Files touched:
PROGRESS.md, FILES_TOUCHED.md, DECISIONS.md, NEXT_STEPS.md, HANDOFF.md (raíz del repo).

Next step:
Leer `NEXT_STEPS.md` y ayudar al usuario a resolver las preguntas abiertas (política de privacidad, si la app de Meta ya existe, quién tiene acceso a Business Manager), luego acompañar el llenado del formulario de Advanced Access.

Avoid:
No modificar `artifacts/api-server/src/lib/instagram-api.ts`, `routes/instagram.ts` ni el schema de `instagram-accounts` sin que el usuario lo pida explícitamente — esta tarea es de documentación/proceso, no de código.

Rules:
- Leer `PROGRESS.md`
- Leer `FILES_TOUCHED.md`
- Leer `DECISIONS.md`
- Leer `NEXT_STEPS.md`
- Continuar desde el próximo paso
- No repetir trabajo ya completado
- No modificar archivos no relacionados
- Actualizar los archivos de continuidad antes de terminar
