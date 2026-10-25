#!/bin/bash
set -euo pipefail
source_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
build_dir="$source_dir/.build"
bundle_dir="$build_dir/Prompt Enhance.app"
mkdir -p "$bundle_dir/Contents/MacOS" "$bundle_dir/Contents/Resources"
cp "$source_dir/Info.plist" "$bundle_dir/Contents/Info.plist"
common=(-fblocks -Wall -Wextra -Werror -Wno-unused-parameter -mmacosx-version-min=14.0 -I"$source_dir/Sources")
for file in PEBackendClient PECompletionEngine PECoordinator PEDiagnostics main; do
  xcrun clang "${common[@]}" -fobjc-arc -c "$source_dir/Sources/$file.m" -o "$build_dir/$file.o"
done
# InputMethodKit's legacy controller and its client proxy stay in Objective-C MRC.
xcrun clang "${common[@]}" -fno-objc-arc -c "$source_dir/Sources/PEInputController.m" -o "$build_dir/PEInputController.o"
xcrun clang "$build_dir/PEBackendClient.o" "$build_dir/PECompletionEngine.o" "$build_dir/PECoordinator.o" "$build_dir/PEDiagnostics.o" "$build_dir/PEInputController.o" "$build_dir/main.o" \
  -framework AppKit -framework InputMethodKit -framework Carbon -o "$bundle_dir/Contents/MacOS/PromptEnhanceInput"
xcrun clang "${common[@]}" -fobjc-arc "$source_dir/Tools/Register.m" -framework AppKit -framework Carbon -o "$build_dir/register-input-source"
xcrun swift "$source_dir/Tools/Icon.swift" "$bundle_dir/Contents/Resources/InputMenu.tiff"
codesign --force --sign - --timestamp=none "$bundle_dir"
codesign --verify --strict "$bundle_dir"
printf 'Built: %s\n' "$bundle_dir"
