#!/usr/bin/env bash
# =====================================================================
# 7By — build the Play Store app bundles (AAB) for 7Solve and 7Q.
#
# RUN THIS ONLY AFTER the PWA files are live on the sites, i.e. these
# must all load in a browser:
#     https://7solve.7by.in/manifest.json      https://7marks.7by.in/manifest.json
#     https://7solve.7by.in/sw.js              https://7marks.7by.in/sw.js
#     https://7solve.7by.in/icon-512.png       https://7marks.7by.in/icon-512.png
#
# Usage:   bash build-apps.sh            # both apps
#          bash build-apps.sh 7solve     # just one
#
# Output:  android/7solve/app-release-bundle.aab   <- upload to Play Console
#          android/7q/app-release-bundle.aab
# =====================================================================
set -u
cd "$(dirname "$0")"

export BUBBLEWRAP_KEYSTORE_PASSWORD="${BUBBLEWRAP_KEYSTORE_PASSWORD:-SevenBy7by2026}"
export BUBBLEWRAP_KEY_PASSWORD="${BUBBLEWRAP_KEY_PASSWORD:-SevenBy7by2026}"

APPS=("${@:-7solve 7q}")
[ $# -gt 0 ] && APPS=("$@") || APPS=(7solve 7q)

for app in "${APPS[@]}"; do
  echo ""
  echo "==================== $app ===================="
  dir="android/$app"
  [ -f "$dir/twa-manifest.json" ] || { echo "!! $dir/twa-manifest.json missing — skipping"; continue; }

  host=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$dir/twa-manifest.json')).host)")
  echo "-- checking https://$host/manifest.json is live ..."
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://$host/manifest.json")
  if [ "$code" != "200" ]; then
    echo "!! https://$host/manifest.json returned $code (need 200)."
    echo "   Upload the site zip first, then re-run this script."
    continue
  fi
  echo "   OK (200)"

  ( cd "$dir" \
    && echo "-- generating Android project ..." \
    && bubblewrap update --skipVersionUpgrade \
    && echo "-- building signed AAB (first run downloads Gradle, be patient) ..." \
    && bubblewrap build --skipPwaValidation )

  if [ -f "$dir/app-release-bundle.aab" ]; then
    echo "== DONE: $dir/app-release-bundle.aab"
    ls -lh "$dir/app-release-bundle.aab" | awk '{print "   size:", $5}'
  else
    echo "!! build finished but no .aab found in $dir"
  fi
done

echo ""
echo "Next: upload the .aab file(s) in Google Play Console."
echo "IMPORTANT: after uploading, copy the SHA-256 from Play Console ->"
echo "  Test and release -> Setup -> App integrity -> App signing key certificate,"
echo "  and ADD it to .well-known/assetlinks.json on the site (keep the existing one)."
echo "  Without that, the app shows a browser address bar."
