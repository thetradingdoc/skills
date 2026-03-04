#!/usr/bin/env bash
# list-interfaces.sh
# Scans all JS/TS files in the project and prints every exported symbol:
#   - TypeScript: exported interface, class, function, type, enum, const, let, var
#   - JavaScript (ESM): export { ... }, export default, export function/class/const/let/var
#   - JavaScript (CJS): module.exports = { ... } top-level keys
#
# Usage: bash list-interfaces.sh [root_dir]
#   root_dir defaults to the current directory.

ROOT="${1:-.}"

echo "=== Exported Interfaces / Symbols ==="
echo "Scanning: $ROOT"
echo ""

# ─── TypeScript & ESM exports ────────────────────────────────────────────────
# Matches patterns like:
#   export interface Foo
#   export type Foo
#   export class Foo
#   export function foo
#   export const foo
#   export let foo / export var foo
#   export enum Foo
#   export default function/class/identifier
#   export { Foo, Bar }
find "$ROOT" \
  \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.mjs" \) \
  -not -path "*/node_modules/*" \
  -not -path "*/.git/*" | sort | while read -r FILE; do

  # Named keyword exports
  grep -nE \
    "^\s*export\s+(default\s+)?(async\s+)?(interface|type|class|function|const|let|var|enum)\s+([A-Za-z_\$][A-Za-z0-9_\$]*)" \
    "$FILE" | while IFS=: read -r LINE REST; do
      KIND=$(echo "$REST" | grep -oE "(interface|type|class|function|const|let|var|enum)" | head -1)
      NAME=$(echo "$REST" | grep -oE "(interface|type|class|function|const|let|var|enum)\s+([A-Za-z_\$][A-Za-z0-9_\$]*)" | head -1 | awk '{print $NF}')
      echo "  [${KIND}] ${NAME}  →  ${FILE}:${LINE}"
  done

  # export default (anonymous or identifier)
  grep -nE "^\s*export\s+default\s+[A-Za-z_\$][A-Za-z0-9_\$]*\s*;" "$FILE" | while IFS=: read -r LINE REST; do
    NAME=$(echo "$REST" | grep -oE "[A-Za-z_\$][A-Za-z0-9_\$]*\s*;" | sed 's/;//')
    echo "  [default] ${NAME}  →  ${FILE}:${LINE}"
  done

  # export { Foo, Bar as Baz }
  grep -nE "^\s*export\s+\{[^}]+\}" "$FILE" | while IFS=: read -r LINE REST; do
    NAMES=$(echo "$REST" | grep -oE "\{[^}]+\}" | tr -d '{}' | tr ',' '\n' | sed 's/as [^ ]*//' | tr -d ' ')
    for NAME in $NAMES; do
      [ -n "$NAME" ] && echo "  [re-export] ${NAME}  →  ${FILE}:${LINE}"
    done
  done

  # CommonJS: module.exports = { key1, key2 } or module.exports.key = ...
  grep -nE "^\s*module\.exports\s*=" "$FILE" | while IFS=: read -r LINE REST; do
    # Try to extract object keys on the same line
    KEYS=$(echo "$REST" | grep -oE "\{[^}]*\}" | tr -d '{}' | tr ',' '\n' | grep -oE "[A-Za-z_\$][A-Za-z0-9_\$]*" | head -20)
    if [ -n "$KEYS" ]; then
      for KEY in $KEYS; do
        echo "  [cjs-export] ${KEY}  →  ${FILE}:${LINE}"
      done
    else
      echo "  [cjs-export] (default/function)  →  ${FILE}:${LINE}"
    fi
  done

  grep -nE "^\s*module\.exports\.[A-Za-z_\$][A-Za-z0-9_\$]*\s*=" "$FILE" | while IFS=: read -r LINE REST; do
    NAME=$(echo "$REST" | grep -oE "exports\.[A-Za-z_\$][A-Za-z0-9_\$]*" | sed 's/exports\.//')
    echo "  [cjs-export] ${NAME}  →  ${FILE}:${LINE}"
  done

done

echo ""
echo "=== Done ==="
