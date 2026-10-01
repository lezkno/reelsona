#!/usr/bin/env bash
# Actualiza Replit con lo último de GitHub y reinicia la API en un solo paso.
#
#   bash actualizar.sh               → trae, instala, compila y arranca la API (puerto 8080)
#   bash actualizar.sh --sin-arrancar → igual, pero no arranca la API (luego pulsa Run)
#
# Rama: stabilization-current-workspace (la que ejecuta Replit), o la que
# indiques con RAMA=otra-rama bash actualizar.sh
#
# No toca la base de datos: las migraciones se aplican solas al arrancar la API.

set -euo pipefail

RAMA="${RAMA:-stabilization-current-workspace}"
PUERTO=8080
ARRANCAR=1
[[ "${1:-}" == "--sin-arrancar" ]] && ARRANCAR=0

cd "$(dirname "$0")"

paso() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
error() { printf '\n\033[1;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# ── 1. Comprobar que no hay cambios sin guardar ────────────────────────────────
paso "Comprobando cambios locales"
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  git status --short --untracked-files=no
  error "Hay archivos modificados sin guardar (arriba). Para no perderlos no actualizo.
  Si no los necesitas:  git checkout -- .   y vuelve a ejecutar bash actualizar.sh"
fi

# ── 2. Traer lo último de GitHub ───────────────────────────────────────────────
paso "Trayendo '$RAMA' de GitHub"
ANTES="$(git rev-parse --short HEAD)"
git fetch origin "$RAMA" || error "No se pudo conectar con GitHub (git fetch falló)."
if [[ "$(git branch --show-current)" != "$RAMA" ]]; then
  git checkout "$RAMA" || error "No se pudo cambiar a la rama $RAMA."
fi
if ! git merge --ff-only "origin/$RAMA" 2>/dev/null; then
  # Replit has its own commits too (e.g. "Published your App"): combine both.
  echo "Tu Replit tiene commits propios; los combino con los de GitHub…"
  if ! git -c user.name="${GIT_AUTHOR_NAME:-Replit}" -c user.email="${GIT_AUTHOR_EMAIL:-replit@localhost}" \
      merge --no-edit "origin/$RAMA"; then
    git merge --abort 2>/dev/null || true
    error "Hay un conflicto entre tu Replit y GitHub que no se puede resolver solo.
  No se ha cambiado nada. Pide ayuda a Claude con este mensaje."
  fi
fi
DESPUES="$(git rev-parse --short HEAD)"
if [[ "$ANTES" == "$DESPUES" ]]; then
  echo "Ya estabas al día ($DESPUES)."
else
  echo "Actualizado: $ANTES → $DESPUES"
  git log --oneline "$ANTES..$DESPUES" | head -15
fi

# ── 3. Dependencias y compilación ──────────────────────────────────────────────
paso "Instalando dependencias"
pnpm install --frozen-lockfile

paso "Compilando la API"
pnpm --filter @workspace/api-server run build || error "La compilación falló (mira el error de arriba)."

# ── 4. Parar la API anterior ───────────────────────────────────────────────────
paso "Parando la API anterior (si estaba en marcha)"
pkill -f "api-server/dist/index.mjs" 2>/dev/null || true
pkill -f "node --enable-source-maps ./dist/index.mjs" 2>/dev/null || true
sleep 1

echo
echo "✓ Código actualizado y compilado ($(git log --oneline -1))"

if [[ "$ARRANCAR" == "0" ]]; then
  echo "Pulsa Run en Replit para arrancar la API con el código nuevo."
  exit 0
fi

# ── 5. Arrancar la API ─────────────────────────────────────────────────────────
paso "Arrancando la API en el puerto $PUERTO (deja esta pestaña abierta; Ctrl+C para pararla)"
cd artifacts/api-server
export NODE_ENV=development PORT="$PUERTO"
exec node --enable-source-maps ./dist/index.mjs
