#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

vite="${SITES_PROJECT_ROOT}/node_modules/.bin/vite"
if [[ ! -x "${vite}" ]]; then
  echo "Vite is unavailable. Run npm run install:ci and wait for it to finish before building." >&2
  exit 69
fi

echo "Running bounded Vite build..."
vite_args=(build)
if [[ -n "${SITES_VITE_CONFIG:-}" ]]; then
  vite_args+=(--config "${SITES_VITE_CONFIG}")
fi
if command -v timeout >/dev/null; then
  timeout \
    --signal=TERM \
    --kill-after="${SITES_BUILD_KILL_AFTER:-10s}" \
    "${SITES_BUILD_TIMEOUT:-3m}" \
    "${vite}" "${vite_args[@]}"
else
  echo "GNU timeout is unavailable; running the same deterministic build without a watchdog."
  "${vite}" "${vite_args[@]}"
fi

"${script_dir}/validate-artifact.sh"
