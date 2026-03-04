#!/usr/bin/env bash
# list-interfaces.sh
# Scans all JS/TS files for exported symbols:
#   - ES6: export const/function/class/default/interface/type
#   - CommonJS: module.exports = { ... } or module.exports.X = ...
# Usage: bash list-interfaces.sh [root_dir]
#   root_dir defaults to current directory

ROOT="${1:-.}"

echo "======================================================"
echo " Exported Interfaces / Symbols"
echo " Project root: $(realpath "$ROOT")"
echo "======================================================"
echo ""

# ── 1. ES-style named exports ──────────────────────────────────────────────────
echo "── ES-style exports ──────────────────────────────────"
grep -rn \
  --include="*.js" --include="*.ts" --include="*.mjs" \
  -E "^export\s+(default\s+)?(async\s+)?(function\*?|class|const|let|var|interface|type|enum)\s+[A-Za-z_\$][A-Za-z0-9_\$]*" \
  "$ROOT" \
| while IFS=: read -r file line content; do
    # Extract the kind and name
    kind=$(echo "$content" | grep -oE "(function\*?|class|const|let|var|interface|type|enum)" | head -1)
    name=$(echo "$content" | grep -oE "(function\*?|class|const|let|var|interface|type|enum)\s+[A-Za-z_\$][A-Za-z0-9_\$]*" | head -1 | awk '{print $NF}')
    is_default=$(echo "$content" | grep -c "export default" || true)
    [ "$is_default" -gt 0 ] && kind="default $kind"
    printf "  %-12s  %-40s  %s:%s\n" "$kind" "$name" "$file" "$line"
  done

echo ""

# ── 2. ES-style re-exports  (export { X, Y } from '...')  ─────────────────────
echo "── ES re-exports ─────────────────────────────────────"
grep -rn \
  --include="*.js" --include="*.ts" --include="*.mjs" \
  -E "^export\s*\{[^}]+\}" \
  "$ROOT" \
| while IFS=: read -r file line content; do
    # Pull out each name between { }
    names=$(echo "$content" | grep -oE "\{[^}]+\}" | tr -d '{}' | tr ',' '\n' | sed 's/as [^ ]*//' | tr -d ' ')
    for name in $names; do
      [ -z "$name" ] && continue
      printf "  %-12s  %-40s  %s:%s\n" "re-export" "$name" "$file" "$line"
    done
  done

echo ""

# ── 3. CommonJS: module.exports = { key, key, ... } ──────────────────────────
echo "── CommonJS module.exports = { ... } ─────────────────"
grep -rn \
  --include="*.js" --include="*.ts" \
  -E "module\.exports\s*=\s*\{" \
  "$ROOT" \
| while IFS=: read -r file line content; do
    # Grab the block starting at this line and extract keys
    block=$(awk "NR>=$line" "$file" | awk '/module\.exports\s*=\s*\{/{found=1} found{print} /\};/{if(found) exit}')
    keys=$(echo "$block" | grep -oE "[A-Za-z_\$][A-Za-z0-9_\$]*\s*:" | sed 's/\s*://' | sort -u)
    for key in $keys; do
      printf "  %-12s  %-40s  %s:%s\n" "cjs-export" "$key" "$file" "$line"
    done
  done

echo ""

# ── 4. CommonJS: module.exports.X = ... ───────────────────────────────────────
echo "── CommonJS module.exports.X = ... ───────────────────"
grep -rn \
  --include="*.js" --include="*.ts" \
  -E "module\.exports\.[A-Za-z_\$][A-Za-z0-9_\$]*\s*=" \
  "$ROOT" \
| while IFS=: read -r file line content; do
    name=$(echo "$content" | grep -oE "module\.exports\.[A-Za-z_\$][A-Za-z0-9_\$]*" | sed 's/module\.exports\.//')
    printf "  %-12s  %-40s  %s:%s\n" "cjs-prop" "$name" "$file" "$line"
  done

echo ""

# ── 5. CommonJS: exports.X = ... ──────────────────────────────────────────────
echo "── CommonJS exports.X = ... ───────────────────────────"
grep -rn \
  --include="*.js" --include="*.ts" \
  -E "^exports\.[A-Za-z_\$][A-Za-z0-9_\$]*\s*=" \
  "$ROOT" \
| while IFS=: read -r file line content; do
    name=$(echo "$content" | grep -oE "exports\.[A-Za-z_\$][A-Za-z0-9_\$]*" | sed 's/exports\.//')
    printf "  %-12s  %-40s  %s:%s\n" "cjs-exports" "$name" "$file" "$line"
  done

echo ""
echo "======================================================"
echo " Done."
echo "======================================================"
