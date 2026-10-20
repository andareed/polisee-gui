#!/usr/bin/env bash
# Resolve the sibling library in Git worktrees without requiring filesystem symlinks.
set -euo pipefail
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
cd -- "$project_dir"

# Respect an explicitly selected workspace (including GOWORK=off), or one Go
# already discovers. Ordinary adjacent checkouts need no generated workspace.
if [[ -n "${GOWORK:-}" && "${GOWORK}" != auto ]] ||
   [[ -n "$(go env GOWORK)" ]] || [[ -f ../polisee-lib/go.mod ]]; then
  exec go "$@"
fi

common_dir=$(git rev-parse --path-format=absolute --git-common-dir)
primary_dir=$(dirname -- "$common_dir")
project_parent=$(dirname -- "$primary_dir")
library_dir="$project_parent/polisee-lib"

# Grouped projects still keep task artifacts under the actual code root.
code_root="$project_parent"
while [[ "$code_root" != / ]]; do
  case "$(basename -- "$code_root")" in code.sandbox|code.playground) break ;; esac
  code_root=$(dirname -- "$code_root")
done
if [[ "$code_root" == / ]]; then code_root="$project_parent"; fi
if [[ ! -f "$library_dir/go.mod" ]]; then
  printf 'Cannot find polisee-lib. Keep it beside the primary checkout: %s\n' "$library_dir" >&2
  exit 1
fi

# Keep generated local build artifacts outside source and under the code root.
workspace_dir="$code_root/.agent-work/polisee-gui/$(basename -- "$project_dir")"
mkdir -p -- "$workspace_dir"
export GOWORK="$workspace_dir/go.work"
if [[ ! -f "$GOWORK" ]]; then
  (cd -- "$workspace_dir" && GOWORK=off go work init "$project_dir")
fi
go work edit "-replace=github.com/andareed/polisee-lib=$library_dir"
exec go "$@"
