#!/bin/sh
# Build 7Pay Listener APK with the raw Android SDK toolchain (no Gradle).
# Works in Git Bash on Windows. Output: build/7pay-listener.apk
#
# ---------------------------------------------------------------------------
# THE SIGNING PASSWORD DOES NOT LIVE IN THIS FILE.
#
# It used to. This script and README.md both carried it in plain text, and both
# are tracked in a public repository — as was the keystore itself. Key and
# password were published together, which is how the original 7pay key had to
# be retired.
#
# The password now comes from keystore.properties (gitignored, next to this
# script) or from the environment. If you ever find yourself typing a password
# into this file again, that is the bug repeating.
#
#   keystore.properties:
#     storePassword=...
#     keyPassword=...
#
#   or:  KEYSTORE_PASS=... KEY_PASS=... ./build.sh
# ---------------------------------------------------------------------------
set -e
SDK="C:/Users/chint/AppData/Local/Android/Sdk"
BT="$SDK/build-tools/37.0.0"            # d8 in build-tools 34.0.0 is buggy — use 37
PLAT="$SDK/platforms/android-34/android.jar"
JBR="C:/Program Files/Android/Android Studio/jbr/bin"

cd "$(dirname "$0")"

KEYSTORE=7pay-release.keystore
ALIAS=7pay

# ---- credentials ----------------------------------------------------------
# Environment wins, so CI can supply them without a file on disk.
if [ -f keystore.properties ]; then
  # Read without sourcing, so the file cannot execute anything.
  [ -z "$KEYSTORE_PASS" ] && KEYSTORE_PASS=$(sed -n 's/^storePassword=//p' keystore.properties | head -1)
  [ -z "$KEY_PASS" ]      && KEY_PASS=$(sed -n 's/^keyPassword=//p' keystore.properties | head -1)
fi

if [ -z "$KEYSTORE_PASS" ] || [ -z "$KEY_PASS" ]; then
  echo "build.sh: no signing password." >&2
  echo >&2
  echo "  Create keystore.properties next to this script:" >&2
  echo "    storePassword=<your store password>" >&2
  echo "    keyPassword=<your key password>" >&2
  echo >&2
  echo "  It is gitignored. Keep the real values in a password manager." >&2
  exit 1
fi

if [ ! -f "$KEYSTORE" ]; then
  echo "build.sh: $KEYSTORE not found." >&2
  echo >&2
  echo "  This script will NOT create one for you. It used to, with a password" >&2
  echo "  hardcoded above, and that is exactly how the previous key was lost." >&2
  echo >&2
  echo "  Generate it deliberately instead:" >&2
  echo "    \"\$JBR/keytool.exe\" -genkeypair -keystore $KEYSTORE -alias $ALIAS \\" >&2
  echo "      -keyalg RSA -keysize 4096 -validity 10950 -dname \"CN=7By, O=7By.in, C=IN\"" >&2
  echo >&2
  echo "  keytool will prompt for the password. Put it in your password manager" >&2
  echo "  and in keystore.properties, and back the keystore up somewhere safe —" >&2
  echo "  Android only installs updates signed with the same key." >&2
  exit 1
fi

# ---- compile --------------------------------------------------------------
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

# ---- sign -----------------------------------------------------------------
# v1 (JAR) signing MUST be enabled — many Indian OEM installers (Xiaomi/Redmi,
# Realme, Oppo, Vivo) reject v2/v3-only APKs with "App not installed".
#
# Passwords go in via env: to apksigner these look like a file named
# "pass:$KEYSTORE_PASS", so the literal never appears in the process list.
KS_PASS="$KEYSTORE_PASS" K_PASS="$KEY_PASS" \
"$JBR/java.exe" -jar "$BT/lib/apksigner.jar" sign --ks "$KEYSTORE" \
  --ks-pass env:KS_PASS --key-pass env:K_PASS \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --min-sdk-version 21 \
  --out build/7pay-listener.apk build/aligned.apk

"$JBR/java.exe" -jar "$BT/lib/apksigner.jar" verify --min-sdk-version 19 --verbose build/7pay-listener.apk \
  | grep -iE "v1 scheme|v2 scheme|v3 scheme"

echo
echo "Signed with:"
"$JBR/java.exe" -jar "$BT/lib/apksigner.jar" verify --print-certs build/7pay-listener.apk \
  | grep -i "SHA-256 digest" | head -1

echo "OK -> build/7pay-listener.apk"
