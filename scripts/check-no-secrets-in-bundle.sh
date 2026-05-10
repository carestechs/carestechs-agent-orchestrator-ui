#!/usr/bin/env bash
# Scans the SPA bundle for accidental leaks of secrets that should NEVER ship
# to the browser. Exits non-zero on match.
#
# After FEAT-003 the orchestrator API key IS in the bundle by design (the
# orchestrator deployment is network-gated; the key's confidentiality is not
# the security property we rely on). The operator passphrase is also in the
# bundle by design (it's a SPA-side UX gate, not a secret).
#
# So today the script forbids NOTHING by default — it's scaffolding for the
# day a new env var lands that genuinely must not bundle. To add a forbidden
# value, add a line below:
#
#   scan_forbidden 'SOME_LABEL' "${SOME_ENV_VAR:-}"
#
# Each scan prints path:lineno only — never the matched value.
set -euo pipefail

DIST_DIR="${DIST_DIR:-dist/spa/browser}"

if [ ! -d "$DIST_DIR" ]; then
  echo "[check-no-secrets] $DIST_DIR does not exist; skipping (run after a build)." >&2
  exit 0
fi

FAIL=0

scan_forbidden() {
  local label="$1"
  local value="$2"
  if [ -z "$value" ]; then
    echo "[check-no-secrets] $label not set in env; skipping its scan." >&2
    return
  fi
  local matches
  matches=$(grep -rnFI \
    --include='*.js' --include='*.css' --include='*.html' --include='*.map' \
    -e "$value" "$DIST_DIR" 2>/dev/null | cut -d: -f1,2 || true)
  if [ -n "$matches" ]; then
    echo "[check-no-secrets] FAIL: $label value found in bundle (path:lineno only):" >&2
    echo "$matches" >&2
    FAIL=1
  fi
}

# (No forbidden values registered today — see header comment.)

if [ "$FAIL" -ne 0 ]; then
  exit 1
fi

echo "[check-no-secrets] OK: no forbidden values found in $DIST_DIR."
