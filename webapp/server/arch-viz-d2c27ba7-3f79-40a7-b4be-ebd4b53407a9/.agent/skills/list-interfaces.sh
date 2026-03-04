#!/usr/bin/env bash
# list-interfaces.sh
# Finds and lists all exported interfaces, classes, functions, and objects
# in JavaScript and TypeScript files across the project.
#
# Usage:
#   bash .agent/skills/list-interfaces.sh [search_root]
#
# Arguments:
#   search_root  (optional) Directory to scan. Defaults to current directory.
#
# Output format:
#   <file_path>  =>  <export_kind>: <export_name>

SEARCH_ROOT="${1:-.}"

echo "============================================================"
echo " Exported Interfaces / Classes / Functions / Objects"
echo " Root: $(realpath "$SEARCH_ROOT")"
echo "============================================================"

# Patterns to match (works for both JS and TS):
#   export interface Foo
#   export class Foo
#   export function foo
#   export async function foo
#   export const foo = ...
#   export default class Foo
#   export default function foo
#   export type Foo = ...   (TypeScript)
#   module.exports = { ... }  (CommonJS – top-level only)

PATTERN='(export\s+(default\s+)?(interface|class|function|async\s+function|const|let|var|type|enum|abstract\s+class)\s+\w+|module\.exports\s*=)'

found=0

while IFS= read -r file; do
  # grep with line numbers; -P for Perl-compatible regex
  matches=$(grep -nP "$PATTERN" "$file" 2>/dev/null)
  if [[ -n "$matches" ]]; then
    while IFS= read -r match; do
      lineno=$(echo "$match" | cut -d: -f1)
      content=$(echo "$match" | cut -d: -f2-)

      # Determine export kind
      if echo "$content" | grep -qP 'export\s+(default\s+)?interface'; then
        kind="interface"
      elif echo "$content" | grep -qP 'export\s+(default\s+)?(abstract\s+)?class'; then
        kind="class"
      elif echo "$content" | grep -qP 'export\s+(default\s+)?async\s+function'; then
        kind="async function"
      elif echo "$content" | grep -qP 'export\s+(default\s+)?function'; then
        kind="function"
      elif echo "$content" | grep -qP 'export\s+const'; then
        kind="const"
      elif echo "$content" | grep -qP 'export\s+let'; then
        kind="let"
      elif echo "$content" | grep -qP 'export\s+var'; then
        kind="var"
      elif echo "$content" | grep -qP 'export\s+type'; then
        kind="type"
      elif echo "$content" | grep -qP 'export\s+enum'; then
        kind="enum"
      elif echo "$content" | grep -qP 'module\.exports'; then
        kind="module.exports"
      else
        kind="export"
      fi

      # Extract the name (word after the keyword sequence)
      name=$(echo "$content" | grep -oP '(?<=(interface|class|function|const|let|var|type|enum)\s)\w+' | head -1)
      [[ -z "$name" ]] && name="(default or anonymous)"

      printf "%-60s  line %-5s  =>  %-18s %s\n" "$file" "$lineno" "$kind" "$name"
      ((found++))
    done <<< "$matches"
  fi
done < <(find "$SEARCH_ROOT" \
  -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.mjs" -o -name "*.cjs" \) \
  ! -path "*/node_modules/*" \
  ! -path "*/.git/*" \
  ! -path "*/dist/*" \
  ! -path "*/build/*" \
  | sort)

echo "------------------------------------------------------------"
echo " Total exports found: $found"
echo "============================================================"
