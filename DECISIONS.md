# Decisions

## Decision

Documentar y preparar el instructivo de Meta App Review sin modificar código de la aplicación.

## Reason

La tarea pedida es de investigación/documentación (entender el proyecto + armar un instructivo del proceso de revisión de Meta), no una implementación de código. El flujo OAuth de Instagram ya está construido y funcionando en modo desarrollo/test; lo que falta es un proceso externo (formulario + verificación + video) que Meta exige, no código nuevo.

## Alternatives Considered

- Modificar el código de la integración (por ejemplo agregar manejo de webhooks de Meta) — descartado porque no fue pedido y no es necesario para el App Review de estos 3 permisos.
- Escribir el instructivo como archivo `.md` dentro del repo — descartado; el usuario prefirió un Artifact (página web navegable) para tenerlo abierto como referencia mientras hace el proceso en el navegador de Meta.

## Impact

No hay impacto en el código ni en el comportamiento de la app. El único cambio en el repo son los 5 archivos de continuidad, que no afectan build/runtime.

---

## Decision

Basar el instructivo exclusivamente en los 3 scopes que el código ya solicita (`instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights`) en vez de sugerir permisos adicionales.

## Reason

Pedir permisos que la app no usa realmente es una causa común de rechazo en Meta App Review (el reviewer verifica que el uso declarado coincida con el comportamiento real de la app). Usar solo lo que el código ya implementa maximiza la probabilidad de aprobación.

## Alternatives Considered

- Sugerir agregar `instagram_business_manage_comments` o `instagram_business_manage_messages` para funciones futuras (DMs, respuesta a comentarios) — descartado por ahora porque no existe código que los use; se deja como nota en `NEXT_STEPS.md` para el futuro si el producto crece.

## Impact

El instructivo queda 100% alineado con el código real, reduciendo riesgo de rechazo por "permiso no usado" o "screencast no corresponde al permiso".

---

## Decision

Sincronizar el kit con el desarrollo hecho directamente en Replit (rama `stabilization-current-workspace`, 262 commits) mediante un agente de exploración de solo lectura, sin hacer merge/checkout de esa rama ni tocar código.

## Reason

El usuario mostró evidencia (panel de Git de Replit) de que hay desarrollo activo fuera de la rama de esta sesión, y pidió explícitamente verificar esos cambios antes de dar por bueno el kit — que además será usado por otro agente (extensión de Chrome) durante el proceso real de revisión, así que la precisión importa más que de costumbre.

## Alternatives Considered

- Hacer `git merge` u obtener el checkout de `stabilization-current-workspace` en esta sesión — descartado: no es necesario tocar código para verificar, y mezclar ramas sin que el usuario lo pida es un cambio de mayor alcance del solicitado.
- Ignorar los cambios de Replit y asumir que el kit seguía vigente — descartado porque el usuario pidió explícitamente la verificación.

## Impact

Se confirmó que los datos "core" del kit (scopes, redirect URIs, política de privacidad) siguen vigentes sin cambios. Se agregaron al kit dos secciones nuevas derivadas de hallazgos reales del código (hoja de referencia rápida + troubleshooting de OAuth) sin alterar ningún dato existente.
