#!/bin/bash
set -e

# Load environment
set -a
source .env
set +a

BUILD_MODE="${BUILD_MODE:-assembleDebug}"

case "$BUILD_MODE" in
    assembleDebug)
        BUILD_TYPE="Debug"
        APK="android/app/build/outputs/apk/debug/app-debug.apk"
        ;;
    assembleRelease)
        BUILD_TYPE="Release"
        APK="android/app/build/outputs/apk/release/app-release.apk"
        APK_UNSIGNED="android/app/build/outputs/apk/release/app-release-unsigned.apk"
        ;;
    *)
        printf "\033[1;31mUnsupported BUILD_MODE: %s\033[0m\n" "$BUILD_MODE"
        exit 1
        ;;
esac

printf "\033[1;36mBuilding %s...\033[0m\n" "$BUILD_TYPE"

mkdir -p resources
cp public/icon.png resources/

npm run build

if [ -d "android" ]; then
    printf "Android has already been added\n"
else
    npx cap add android
    node scripts/patch-android.mjs
fi

npx capacitor-assets generate --android
npx cap sync

cd android
./gradlew clean "$BUILD_MODE"
cd ..

rm -rf icons resources public/manifest.webmanifest

if [ "$BUILD_MODE" = "assembleRelease" ] && [ ! -f "$APK" ]; then
    if [ -f "$APK_UNSIGNED" ]; then
        APK="$APK_UNSIGNED"
    fi
fi

if [ ! -f "$APK" ]; then
    printf "\033[1;31m%s APK not found!\033[0m\n" "$BUILD_TYPE"
    exit 1
fi

printf "\n\033[1;32m=================== Done ===================\033[0m\n"
printf "%s APK: %s\n" "$BUILD_TYPE" "$APK"
printf "Size: %s\n" "$(du -h "$APK" | cut -f1)"