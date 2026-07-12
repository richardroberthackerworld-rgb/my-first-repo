#!/bin/sh
# Build 7Pay Listener APK with the raw Android SDK toolchain (no Gradle).
# Works in Git Bash on Windows. Output: build/7pay-listener.apk
set -e
SDK="C:/Users/chint/AppData/Local/Android/Sdk"
BT="$SDK/build-tools/37.0.0"            # d8 in build-tools 34.0.0 is buggy — use 37
PLAT="$SDK/platforms/android-34/android.jar"
JBR="C:/Program Files/Android/Android Studio/jbr/bin"

cd "$(dirname "$0")"
rm -rf build
mkdir -p build/classes
mkdir -p build/dex
mkdir -p build/res

# Compile resources (launcher icons) then link them into the APK.
"$BT/aapt2.exe" compile --dir res -o build/res.zip
"$BT/aapt2.exe" link -o build/base.apk --manifest AndroidManifest.xml -I "$PLAT" \
  build/res.zip --min-sdk-version 21 --target-sdk-version 34
"$JBR/javac.exe" --release 11 -classpath "$PLAT" -d build/classes src/in/sevenby/paylistener/*.java
"$JBR/jar.exe" cf build/classes.jar -C build/classes .
"$JBR/java.exe" -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 --release --lib "$PLAT" \
  --min-api 26 --output build/dex build/classes.jar

cp build/base.apk build/unsigned.apk
(cd build/dex && "$JBR/jar.exe" uf ../unsigned.apk classes.dex)
"$BT/zipalign.exe" -f 4 build/unsigned.apk build/aligned.apk

# Same keystore forever — app updates on the phone require the same signature.
if [ ! -f 7pay-release.keystore ]; then
  "$JBR/keytool.exe" -genkeypair -keystore 7pay-release.keystore -alias 7pay \
    -storepass sevenpay7by -keypass sevenpay7by -keyalg RSA -keysize 2048 \
    -validity 10950 -dname "CN=7By, O=7By.in, C=IN"
fi
# v1 (JAR) signing MUST be enabled — many Indian OEM installers (Xiaomi/Redmi,
# Realme, Oppo, Vivo) reject v2/v3-only APKs with "App not installed".
"$JBR/java.exe" -jar "$BT/lib/apksigner.jar" sign --ks 7pay-release.keystore \
  --ks-pass pass:sevenpay7by --key-pass pass:sevenpay7by \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --min-sdk-version 21 \
  --out build/7pay-listener.apk build/aligned.apk

"$JBR/java.exe" -jar "$BT/lib/apksigner.jar" verify --min-sdk-version 19 --verbose build/7pay-listener.apk \
  | grep -iE "v1 scheme|v2 scheme|v3 scheme"
echo "OK -> build/7pay-listener.apk"
