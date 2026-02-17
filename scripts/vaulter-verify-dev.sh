#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENVIRONMENT="${VAULTER_VERIFY_ENV:-dev}"
SERVICE="${VAULTER_VERIFY_SERVICE:-}"
OUTDIR="${VAULTER_VERIFY_OUTDIR:-artifacts/vaulter-health}"

mkdir -p "$OUTDIR"
TIMESTAMP="$(date -u +'%Y%m%dT%H%M%SZ')"
OUTFILE="${OUTDIR}/vaulter-verify-${ENVIRONMENT}-${TIMESTAMP}.log"

if command -v vaulter >/dev/null 2>&1; then
  VAULTER_BIN="vaulter"
elif [ -f dist/cli/index.js ]; then
  VAULTER_BIN="node dist/cli/index.js"
else
  echo "[vaulter-verify] CLI não encontrado. Rode 'pnpm build' ou deixe o binário nativo disponível no PATH." >&2
  exit 1
fi

run_vaulter() {
  printf '\n# %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  printf '\$ vaulter'
  printf ' %q' "$@"
  printf '\n'
  $VAULTER_BIN "$@"
}

echo "Vaulter verify started"
echo "Environment: $ENVIRONMENT"
echo "Service: ${SERVICE:-<all>}"
echo "Report: $OUTFILE"

{
  run_vaulter doctor -e "$ENVIRONMENT" -v
  run_vaulter sync diff -e "$ENVIRONMENT" --values
  if [ -n "$SERVICE" ]; then
    run_vaulter list -e "$ENVIRONMENT" -s "$SERVICE"
  else
    run_vaulter list -e "$ENVIRONMENT"
  fi
} | tee "$OUTFILE"

VERIFY_EXIT="${PIPESTATUS[0]}"
if [ "$VERIFY_EXIT" -ne 0 ]; then
  echo "[vaulter-verify] Falha detectada. Veja: $OUTFILE" >&2
  exit "$VERIFY_EXIT"
fi

echo "[vaulter-verify] Concluído com sucesso. Report: $OUTFILE"
