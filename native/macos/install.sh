#!/bin/bash
set -euo pipefail
source_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
"$source_dir/build.sh"
destination_dir="$HOME/Library/Input Methods/Prompt Enhance.app"
if [[ -e "$destination_dir" ]]; then
  installed_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$destination_dir/Contents/Info.plist")
  if [[ "$installed_id" != 'com.promptenhance.inputmethod.PromptEnhance' ]]; then
    printf 'Refusing to replace an unrelated app: %s\n' "$destination_dir" >&2
    exit 1
  fi
  if diff -qr -- "$source_dir/.build/Prompt Enhance.app" "$destination_dir" >/dev/null 2>&1; then
    if ! "$source_dir/.build/register-input-source" "$destination_dir"; then
      exit 1
    fi
    printf 'Installed helper already matches the signed build; left it in place so its Accessibility grant is preserved.\n'
    exit 0
  fi
  if [[ "${PROMPT_ENHANCE_SIGN_IDENTITY:--}" == "-" ]]; then
    printf 'This ad-hoc signed replacement can change the helper identity macOS uses for Accessibility. Refresh the Prompt Enhance grant after installing.\n' >&2
  fi
  backup_dir="$source_dir/.build/backups/$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$backup_dir"
  ditto "$destination_dir" "$backup_dir/Prompt Enhance.app"
fi
mkdir -p "$(dirname -- "$destination_dir")"
staging_dir="$(mktemp -d "$(dirname -- "$destination_dir")/.prompt-enhance-install.XXXXXX")"
trap 'rm -rf -- "$staging_dir"' EXIT
ditto "$source_dir/.build/Prompt Enhance.app" "$staging_dir/Prompt Enhance.app"
codesign --verify --strict "$staging_dir/Prompt Enhance.app"
if [[ -e "$destination_dir" ]]; then
  mv "$destination_dir" "$staging_dir/previous.app"
fi
if ! mv "$staging_dir/Prompt Enhance.app" "$destination_dir"; then
  if [[ -e "$staging_dir/previous.app" ]]; then mv "$staging_dir/previous.app" "$destination_dir"; fi
  exit 1
fi
if ! "$source_dir/.build/register-input-source" "$destination_dir"; then
  mv "$destination_dir" "$staging_dir/failed.app"
  if [[ -e "$staging_dir/previous.app" ]]; then mv "$staging_dir/previous.app" "$destination_dir"; fi
  exit 1
fi
printf 'Installed: %s\n' "$destination_dir"
