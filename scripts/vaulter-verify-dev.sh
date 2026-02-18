#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENVIRONMENT="${VAULTER_VERIFY_ENV:-dev}"
SERVICE="${VAULTER_VERIFY_SERVICE:-}"
REQUIRE_CONFIG="${VAULTER_VERIFY_REQUIRE_CONFIG:-0}"
VERIFY_OFFLINE="${VAULTER_VERIFY_OFFLINE:-1}"
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
echo "Offline doctor: ${VERIFY_OFFLINE}"
echo "Report: $OUTFILE"
echo "Require config: ${REQUIRE_CONFIG}"

if [ ! -f "${ROOT_DIR}/.vaulter/config.yaml" ]; then
  if [ "$REQUIRE_CONFIG" = "1" ] || [ "$REQUIRE_CONFIG" = "true" ] || [ "$REQUIRE_CONFIG" = "yes" ]; then
    echo "[vaulter-verify] Falha: .vaulter/config.yaml não encontrado." >&2
    echo "[vaulter-verify] Defina VAULTER_VERIFY_REQUIRE_CONFIG=false para ignorar em CI deste repositório." >&2
    exit 1
  fi

  {
    echo "[vaulter-verify] .vaulter/config.yaml não encontrado; pulando checks de vaulter para este repositório."
    echo "[vaulter-verify] Nenhuma falha em validações específicas de Vaulter."
  } | tee "$OUTFILE"
  echo "[vaulter-verify] Concluído com sucesso (sem configuração de projeto Vaulter). Report: $OUTFILE"
  exit 0
fi

{
  if [ "$VERIFY_OFFLINE" = "1" ] || [ "$VERIFY_OFFLINE" = "true" ] || [ "$VERIFY_OFFLINE" = "yes" ]; then
    run_vaulter doctor -e "$ENVIRONMENT" -v --offline
  else
    run_vaulter doctor -e "$ENVIRONMENT" -v
  fi
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
