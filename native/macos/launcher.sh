#!/bin/bash
set -euo pipefail

source_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
build_dir="$source_dir/.build"
bundle_dir="$build_dir/Prompt Enhance Setup.app"
install_dir="$HOME/Applications/Prompt Enhance Setup.app"
expected_identifier='com.promptenhance.setup'

rm -rf -- "$bundle_dir"
mkdir -p "$bundle_dir/Contents/MacOS"

/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string $expected_identifier" "$bundle_dir/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleExecutable string PromptEnhanceSetup' "$bundle_dir/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleName string Prompt Enhance Setup' "$bundle_dir/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleDisplayName string Prompt Enhance Setup' "$bundle_dir/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundlePackageType string APPL' "$bundle_dir/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleShortVersionString string 1.2.0' "$bundle_dir/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleVersion string 3' "$bundle_dir/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :LSMinimumSystemVersion string 14.0' "$bundle_dir/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :NSPrincipalClass string NSApplication' "$bundle_dir/Contents/Info.plist"

common=(-fblocks -Wall -Wextra -Werror -Wno-unused-parameter -mmacosx-version-min=14.0)
xcrun clang "${common[@]}" -fobjc-arc "$source_dir/Tools/Launcher.m" \
  -framework AppKit -framework Carbon -o "$bundle_dir/Contents/MacOS/PromptEnhanceSetup"
codesign --force --sign - --timestamp=none "$bundle_dir"
codesign --verify --strict "$bundle_dir"

mkdir -p "$(dirname -- "$install_dir")"
if [[ -e "$install_dir" ]]; then
  installed_identifier=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$install_dir/Contents/Info.plist")
  if [[ "$installed_identifier" != "$expected_identifier" ]]; then
    printf 'Refusing to replace an unrelated application: %s\n' "$install_dir" >&2
    exit 1
  fi
  backup_dir="$build_dir/backups/setup-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$backup_dir"
  ditto "$install_dir" "$backup_dir/Prompt Enhance Setup.app"
fi

staging_dir="$(mktemp -d "$(dirname -- "$install_dir")/.prompt-enhance-setup.XXXXXX")"
trap 'rm -rf -- "$staging_dir"' EXIT
ditto "$bundle_dir" "$staging_dir/Prompt Enhance Setup.app"
staged_identifier=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$staging_dir/Prompt Enhance Setup.app/Contents/Info.plist")
if [[ "$staged_identifier" != "$expected_identifier" ]]; then
  printf 'Built bundle identifier did not match the expected setup application.\n' >&2
  exit 1
fi
codesign --verify --strict "$staging_dir/Prompt Enhance Setup.app"
if [[ -e "$install_dir" ]]; then
  mv "$install_dir" "$staging_dir/previous.app"
fi
if ! mv "$staging_dir/Prompt Enhance Setup.app" "$install_dir"; then
  if [[ -e "$staging_dir/previous.app" ]]; then
    mv "$staging_dir/previous.app" "$install_dir"
  fi
  exit 1
fi

printf 'Built and installed setup launcher: %s\n' "$install_dir"
