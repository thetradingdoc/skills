#!/usr/bin/env bash
# list-interfaces.sh
# Finds all exported TypeScript interfaces in the project.
# Usage: bash .agent/skills/list-interfaces.sh [root_dir]
#
# Output columns: <file>:<line>  <interface_name>
#
# Requires: grep (POSIX), available on macOS/Linux/WSL.

ROOT="${1:-.}"

echo "=== Exported TypeScript Interfaces ==="
echo "Root: $(realpath "$ROOT")"
echo ""

# Search recursively for 'export interface <Name>' in .ts and .tsx files.
# Exclude node_modules, dist, out, and .agent directories.
grep -rn --include="*.ts" --include="*.tsx" \
     --exclude-dir=node_modules \
     --exclude-dir=dist \
     --exclude-dir=out \
     --exclude-dir=".agent" \
     "export interface " "$ROOT" \
  | sed -E 's|^([^:]+):([0-9]+):.*export interface ([A-Za-z_][A-Za-z0-9_]*).*|\1:\2  \3|' \
  | sort

echo ""
echo "--- Done ---"
