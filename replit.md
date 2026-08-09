# ContentPilot

Máquina de generación de contenido automático para Instagram Reels usando avatares de HeyGen. Conecta tu cuenta de Instagram, audita el rendimiento del contenido, genera guiones con IA, crea videos con avatares HeyGen y publica Reels en piloto automático.

## Run & Operate

- `pnpm --filter @workspace/content-pilot run dev` — frontend (port auto-assigned)
- `pnpm --filter @workspace/api-server run dev` — API server (port 8080 en dev)
- `pnpm run typecheck` — typecheck completo de todos los paquetes
- `pnpm run build` — typecheck + build
- `pnpm --filter @workspace/api-spec run codegen` — regenerar hooks y Zod schemas desde OpenAPI
- `pnpm --filter @workspace/db run push` — aplicar cambios de schema a la DB (solo dev)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19 + Vite + Tailwind + shadcn/ui + Wouter + TanStack Query
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validación: Zod (v3), `drizzle-zod`
- API codegen: Orval (desde spec OpenAPI)
- IA (scripts): OpenAI via Replit AI Integrations (sin API key propia)
- Video: HeyGen API v2
- Social: Instagram Graph API (con Facebook/Instagram Login)
- Scheduler: node-cron (automatización)

## Where things live

- `lib/api-spec/openapi.yaml` — spec OpenAPI (fuente de verdad de contratos)
- `lib/db/src/schema/` — tablas Drizzle (instagram_accounts, settings, avatar_config, content_plan_items, videos, automation_config)
- `artifacts/api-server/src/lib/heygen.ts` — cliente HeyGen API
- `artifacts/api-server/src/lib/instagram-api.ts` — cliente Instagram Graph API
- `artifacts/api-server/src/lib/ai-scripts.ts` — generación de guiones con OpenAI
- `artifacts/api-server/src/lib/scheduler.ts` — motor de automatización (node-cron)
- `artifacts/content-pilot/src/` — frontend React (dashboard, connect, audit, content, avatars, videos, automation, settings)

## Architecture decisions

- **OpenAPI-first**: Toda la interfaz API se define en `openapi.yaml` y se genera via Orval. No se escriben tipos a mano.
- **Scheduler en backend**: node-cron corre dentro del proceso Express. Cada 5 minutos: poll de videos HeyGen. Cada hora: verifica si corresponde publicar según horario configurado.
- **Pipeline completo**: draft → scripted → generating → ready → published. Cada transición se registra en DB.
- **Rotación de avatares**: La lógica de rotación (sequential / random / performance) vive en `scheduler.ts::pickNextAvatar`.
- **IA via Replit proxy**: Se usa `AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY` (auto-provisioned), sin necesidad de API key propia.
- **type: integer → number en OpenAPI**: Orval genera `zod.int()` para `integer` que no existe en Zod v3. Todos los enteros usan `type: number` en el spec.

## Product

- **Dashboard**: estado de automatización, stats de videos y publicaciones, próxima publicación programada
- **Conectar Instagram**: OAuth flow con Meta, vista de cuenta conectada con métricas
- **Auditoría**: top posts por engagement, análisis IA de qué funciona, temas recomendados, mejores horarios
- **Plan de Contenido**: lista de items por estado, generación automática de temas con IA, editor de guión
- **Avatares**: selección de avatares HeyGen, voz clonada, estrategia de rotación
- **Videos**: cola de videos en proceso/listos/publicados, publicación manual o automática
- **Automatización**: toggle maestro, días y horarios de publicación, sub-toggles de auto-generar/auto-publicar
- **Configuración**: nicho, keywords, tono, idioma, duración del video

## User preferences

- Idioma: Español (UI completamente en español)
- Nicho configurable desde la app

## Integrations & External APIs

- **Apify** (`APIFY_TOKEN` secret): Used to enrich niche radar accounts with real Instagram data (followers, bio, top posts) via `apify/instagram-profile-scraper` Actor. Set `APIFY_TOKEN` in Replit Secrets. If not set, enrichment is silently skipped and the system uses manually entered data. Endpoint `GET /strategy/radar/status` returns `{ apify_available: bool }`. Sync a specific account via `POST /strategy/radar/:id/sync`.

## Gotchas

- Para publicar Reels, el video HeyGen debe estar en una URL pública. HeyGen devuelve la URL directa.
- El callback de Instagram OAuth requiere que la `redirect_uri` esté registrada exactamente en el Meta App dashboard.
- Para que los insights de posts funcionen, la cuenta debe ser Business o Creator (no personal).
- `type: integer` en OpenAPI → usar `type: number` siempre (Zod v3 no tiene `zod.int()`).
- El scheduler corre cada 5min para poll de videos y cada hora para ciclos de automatización.

## Pointers

- Ver `pnpm-workspace` skill para estructura del monorepo
- Ver `lib/api-spec/openapi.yaml` para contratos completos
