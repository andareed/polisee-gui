#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
case "${1:-run}" in
  run)
    make build
    exec ./bin/polisee-gui
    ;;
  build|preview|check|test|race|smoke) exec make "$1" ;;
  *) printf 'Usage: %s [run|build|preview|check|test|race|smoke]\n' "$0" >&2; exit 2 ;;
esac
