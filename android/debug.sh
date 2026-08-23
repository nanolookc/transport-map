#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "$0")" && pwd)"
workspace_dir="$(cd "$project_dir/.." && pwd)"
step_wrapper="$workspace_dir/../step/gradlew"

export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk}"
export ANDROID_HOME="${ANDROID_HOME:-/home/dima/Android/Sdk}"

if [[ ! -x "$JAVA_HOME/bin/java" ]]; then
    echo "JDK 21 was not found at $JAVA_HOME." >&2
    exit 1
fi

if [[ ! -f "$step_wrapper" ]]; then
    echo "Gradle wrapper was not found: $step_wrapper" >&2
    exit 1
fi

bash "$step_wrapper" -p "$project_dir" --no-daemon --console=plain :app:assembleDebug

apk_path="$project_dir/app/build/outputs/apk/debug/app-debug.apk"
if [[ ! -f "$apk_path" ]]; then
    echo "Gradle finished but the debug APK was not found: $apk_path" >&2
    exit 1
fi

if ! command -v adb >/dev/null 2>&1; then
    echo "adb is required to install the debug APK." >&2
    exit 1
fi

device_count="$(adb devices | awk 'NR > 1 && $2 == "device" { count += 1 } END { print count + 0 }')"
if [[ "$device_count" != "1" ]]; then
    echo "Expected exactly one connected ADB device; found $device_count." >&2
    adb devices >&2
    exit 1
fi

adb install -r "$apk_path"
echo
echo "Installed Transport Map (uk.hrebeni.transit)."
