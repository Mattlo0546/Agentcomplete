#!/bin/bash
set -euo pipefail

source_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
build_dir="$source_dir/.build"
bundle_dir="$build_dir/Prompt Enhance Fixture.app"
macos_dir="$bundle_dir/Contents/MacOS"
system_input_mode=false
if [[ "${1:-}" == '--system-input' ]]; then
  system_input_mode=true
elif [[ $# -ne 0 ]]; then
  printf 'Usage: %s [--system-input]\n' "$0" >&2
  exit 2
fi

rm -rf -- "$bundle_dir"
mkdir -p "$macos_dir"

/usr/libexec/PlistBuddy -c 'Add :CFBundleIdentifier string com.promptenhance.input.fixture' "$bundle_dir/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleExecutable string PromptEnhanceFixture' "$bundle_dir/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleName string Prompt Enhance Fixture' "$bundle_dir/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleDisplayName string Prompt Enhance Fixture' "$bundle_dir/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundlePackageType string APPL' "$bundle_dir/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleShortVersionString string 0.3.0' "$bundle_dir/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleVersion string 1' "$bundle_dir/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :LSMinimumSystemVersion string 14.0' "$bundle_dir/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :NSPrincipalClass string NSApplication' "$bundle_dir/Contents/Info.plist"
if [[ "$system_input_mode" == true ]]; then
  /usr/libexec/PlistBuddy -c 'Add :PEUseSystemInput bool true' "$bundle_dir/Contents/Info.plist"
fi

common=(-fblocks -Wall -Wextra -Werror -Wno-unused-parameter -mmacosx-version-min=14.0 -I"$source_dir/Sources")
xcrun clang "${common[@]}" -fobjc-arc \
  "$source_dir/Sources/PEBackendClient.m" \
  "$source_dir/Sources/PECompletionEngine.m" \
  "$source_dir/Sources/PECoordinator.m" \
  "$source_dir/Sources/PEAccessibilityClient.m" \
  "$source_dir/Sources/PEDiagnostics.m" \
  "$source_dir/Tests/ComposerFixture.m" \
  -framework AppKit -framework ApplicationServices \
  -o "$macos_dir/PromptEnhanceFixture"

codesign --force --sign - --timestamp=none "$bundle_dir"
codesign --verify --strict "$bundle_dir"
if [[ "$system_input_mode" == true ]]; then
  printf 'Built system-input fixture: %s\n' "$bundle_dir"
else
  printf 'Built fixture: %s\n' "$bundle_dir"
fi
