#!/usr/bin/env bash
# check-api-types.sh
# Regenerates API client types from openapi.yaml and fails if the result differs
# from what is currently committed — indicating the spec and generated files are
# out of sync.
#
# Usage:
#   pnpm --filter @workspace/api-spec run check
#
# In CI / pre-merge: run this and fail the build when it exits non-zero.
# For contributors: run this after editing openapi.yaml and commit the changed
# generated files produced by the codegen.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "▶ Regenerating API types from openapi.yaml…"
pnpm --filter @workspace/api-spec run codegen

echo "▶ Checking for uncommitted changes in generated files…"
DIFF=$(git -C "$ROOT" diff --name-only -- \
  lib/api-client-react/src/generated \
  lib/api-zod/src/generated)

if [ -z "$DIFF" ]; then
  echo "✅ Generated API types are in sync with openapi.yaml."
  exit 0
else
  echo ""
  echo "❌ Generated API types are OUT OF SYNC with openapi.yaml."
  echo "   The following files were regenerated and differ from HEAD:"
  echo "$DIFF" | sed 's/^/     /'
  echo ""
  echo "   Commit them to fix the drift:"
  echo "     git add lib/api-client-react/src/generated lib/api-zod/src/generated"
  echo "     git commit -m 'chore: regenerate API types from openapi.yaml'"
  echo ""
  exit 1
fi
