# 7 Audio — Android App Bundle

This is a Trusted Web Activity: a thin Android wrapper that opens
`https://7audio.7by.in` full-screen, with no browser chrome. It is the same
structure as the 7Stem app that already passed Play review, reconfigured for
7 Audio.

## Status — read this first

**The `.aab` has not been built, and cannot be built on the machine this project
was prepared on.** There is no JDK, no Gradle and no Android SDK installed:

```
java        not installed
gradle      not installed
sdkmanager  not installed
keytool     not installed
```

The project itself is complete and correct. What follows is exactly what to run
on a machine that has the toolchain. I have not run any of it, and I am not
claiming the bundle works until you have built it and installed it once.

---

## What you need

- **JDK 17** — Temurin or Oracle. Gradle 8.x requires 17.
- **Android SDK** with platform 35 and build-tools 35. Easiest via Android
  Studio; otherwise the command-line tools plus:
  ```
  sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
  ```
- `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) pointing at the SDK.

---

## 1. Create a signing key

**Once, ever.** If you lose this key you cannot update the app on Play — you
would have to publish a new listing under a new package name.

```bash
keytool -genkeypair -v \
  -keystore 7audio-release.jks \
  -alias 7audio \
  -keyalg RSA -keysize 2048 -validity 10000
```

Store the keystore and its passwords in a password manager. **Do not commit the
keystore, and do not commit the passwords.** `android/*/*.jks` should be in
`.gitignore` before you create it.

## 2. Point the build at the key

Create `android/7audio/keystore.properties` — **untracked**:

```properties
storeFile=../7audio-release.jks
storePassword=<your store password>
keyAlias=7audio
keyPassword=<your key password>
```

Then confirm `app/build.gradle` reads it rather than containing the passwords
inline. If the signing block is not present, add:

```gradle
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('keystore.properties')
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {
    signingConfigs {
        release {
            storeFile file(keystoreProperties['storeFile'])
            storePassword keystoreProperties['storePassword']
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
        }
    }
    buildTypes {
        release { signingConfig signingConfigs.release }
    }
}
```

## 3. Build

```bash
cd "U:/New folder/android/7audio"
./gradlew bundleRelease
```

Output: `app/build/outputs/bundle/release/app-release.aab`

To test on a device before uploading, build an APK instead:

```bash
./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```

---

## 4. Digital Asset Links — the step that decides whether it works

A TWA only runs without a browser address bar if the website vouches for the
app. That is done with a file the site serves.

`audiora/public/.well-known/assetlinks.json` already exists in this repo with a
placeholder. **Do not edit it by hand** — a single wrong character produces a
file that looks correct and fails silently. Use the script:

```bash
node audiora/scripts/set-assetlinks.mjs <SHA-256>

# both keys, if you want sideloaded builds to verify too:
node audiora/scripts/set-assetlinks.mjs <PLAY-SHA-256> <UPLOAD-SHA-256>

# check what is currently set:
node audiora/scripts/set-assetlinks.mjs --show
```

It validates the format strictly and normalises case and spacing. The release
script also refuses to build if the fingerprint is malformed, so a bad paste
cannot reach the site.

Get the fingerprint from your keystore:

```bash
keytool -list -v -keystore 7audio-release.jks -alias 7audio | grep SHA256
```

**If you use Play App Signing** — and you almost certainly should — Google
re-signs your bundle with *their* key, so the fingerprint that matters is theirs,
not yours. Find it after your first upload at:

> Play Console → your app → Setup → App integrity → App signing key certificate → SHA-256

Use that value. Using your upload key's fingerprint instead is the single
commonest reason a TWA ships with a browser bar visible.

The finished file must be served at:

```
https://7audio.7by.in/.well-known/assetlinks.json
```

with `Content-Type: application/json` and no redirect. Verify with:

```bash
curl -i https://7audio.7by.in/.well-known/assetlinks.json
```

Google's own checker:
`https://developers.google.com/digital-asset-links/tools/generator`

> **Note on hosting:** some Apache configurations block dot-directories.
> If the URL 404s after deploying, that is why — `.well-known` needs to be
> allowed through.

---

## 5. Play Console

Steps I cannot do for you — they need your Play account.

1. Create the app. Package name **`in.sevenby.audio`** (permanent).
2. Upload the `.aab` to a closed test track first, not straight to production.
3. Complete: store listing, content rating, data safety, target audience,
   privacy policy URL (`https://7audio.7by.in/privacy`).
4. Install from the test track on a real device and confirm:
   - it opens full-screen with **no address bar** — if you see one, asset links
     are wrong;
   - the splash screen shows the 7 Audio icon;
   - back navigation behaves;
   - sign-in works inside the app.
5. Promote to production.

### Store listing assets

`store_icon.png` was deliberately **not** copied from the 7Stem project — it is
7Stem's. You need a 512×512 PNG for Play; `audiora/public/brand/icon-512.png`
is the right mark at the right size.

Screenshots must be real captures of the app running. The 7Stem screenshots
were not copied for the same reason.

### The Play Store link on the website

`audiora/src/config/site.ts` has:

```ts
playStoreUrl: null as string | null,
```

The promo card refuses to link anywhere while that is `null`, which is
deliberate — no invented URL. Once the listing is live, paste the real URL there
and rebuild.

---

## What was changed from the 7Stem project

| | 7Stem | 7 Audio |
|---|---|---|
| Package | `in.sevenby.stem` | `in.sevenby.audio` |
| Host | `vocalremover.7by.in` | `7audio.7by.in` |
| App name | 7Stem — Vocal Remover & Audio Studio | 7 Audio — AI Audio Toolkit |
| Launcher name | 7Stem | 7 Audio |
| Splash background | `#F7F8FB` | `#FBFBFE` |
| Orientation | portrait | any |
| Launcher icons | 7Stem mark | 7 Audio mark, from the site's own brand assets |
| Bundled web manifest | 7Stem's | copied from `audiora/public/manifest.webmanifest` |

Not copied: keystore, build output, `.aab`, store icon, store screenshots,
`manifest-checksum.txt`. Those are 7Stem's and reusing them would be wrong.
