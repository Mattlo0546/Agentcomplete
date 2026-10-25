#!/bin/bash
set -euo pipefail
source_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
mkdir -p "$source_dir/.build"
xcrun clang -fno-objc-arc -fblocks -Wall -Wextra -Werror -Wno-unused-parameter -mmacosx-version-min=14.0 \
  -I"$source_dir/Sources" -c "$source_dir/Sources/PEInputController.m" -o "$source_dir/.build/PEInputController-tests.o"
xcrun clang -fno-objc-arc -fblocks -Wall -Wextra -Werror -Wno-unused-parameter -mmacosx-version-min=14.0 \
  -I"$source_dir/Sources" -c "$source_dir/Tests/BridgeTests.m" -o "$source_dir/.build/BridgeTests.o"
xcrun clang -fobjc-arc -fblocks -Wall -Wextra -Werror -Wno-unused-parameter -mmacosx-version-min=14.0 \
  -I"$source_dir/Sources" "$source_dir/Sources/PEBackendClient.m" "$source_dir/Sources/PECompletionEngine.m" "$source_dir/Sources/PEDiagnostics.m" \
  "$source_dir/Tests/EngineTests.m" "$source_dir/Tests/BackendClientTests.m" \
  "$source_dir/Tests/AccessibilityClientTests.m" \
  "$source_dir/Sources/PECoordinator.m" "$source_dir/Sources/PEAccessibilityClient.m" "$source_dir/Tests/TextSystemTests.m" \
  "$source_dir/Tests/CoordinatorTests.m" "$source_dir/Tests/main.m" "$source_dir/.build/PEInputController-tests.o" "$source_dir/.build/BridgeTests.o" \
  -framework AppKit -framework InputMethodKit -framework Carbon -framework ApplicationServices -o "$source_dir/.build/native-tests"
"$source_dir/.build/native-tests"
