# 7 Audio — Android App Bundle

This is a Trusted Web Activity: a thin Android wrapper that opens
`https://7audio.7by.in` full-screen, with no browser chrome. It is the same
structure as the 7Stem app that already passed Play review, reconfigured for
7 Audio.

## Status — read this first

**The bundle is built.** `7audio-release-unsigned.aab`, 1.5 MB, at the repo
root, copied from `app/build/outputs/bundle/release/app-release.aab`.

It is **unsigned**, and Play will not accept it that way. Signing needs a
keystore password, which belongs to you and to a password manager. Everything
up to that point is done and verified.

An earlier version of this file said the bundle "cannot be built on the machine
this project was prepared on" because there was no JDK, Gradle or Android SDK.
That was wrong. All of it is installed:

    JDK          21.0.10   C:/Program Files/Android/Android Studio/jbr
    Android SDK            C:/Users/chint/AppData/Local/Android/Sdk
    platforms              android-33 … android-36.1
    build-tools            34.0.0 … 37.0.0
    Gradle       8.11.1    via ./gradlew (downloads itself)

Verified in the built bundle:

    applicationId    in.sevenby.audio
    versionCode      1          versionName 1.0.0
    minSdk           23         targetSdk   35
    host             7audio.7by.in
    launchUrl        https://7audio.7by.in/
    webManifestUrl   https://7audio.7by.in/manifest.webmanifest

### Two bugs fixed to get here

**`webManifestUrl` pointed at `/manifest.json`.** The site serves
`/manifest.webmanifest`. Chrome OS and Meta Quest use this URL to open the web
version instead of the TWA, so it would have resolved to nothing on exactly the
platforms that rely on it. Fixed in `app/build.gradle` and `twa-manifest.json`.

**`jcenter()` was still in `build.gradle`.** JCenter has been shut down. Left
in, it makes dependency resolution fail or hang against a dead host, with an
error that blames the dependency. Now `mavenCentral()`.

---

## What you need

Already installed on this machine — listed for a different one:

- **JDK 17 or later.** Gradle 8.11 works with 21, which is what is here.
- **Android SDK** with platform 35+ and build-tools 35+.
- `local.properties` in `android/7audio/` pointing at the SDK:
  ```properties
  sdk.dir=C:/Users/chint/AppData/Local/Android/Sdk
  ```
  **Forward slashes.** This is a Java `.properties` file where backslash is the
  escape character, so a Windows path with single backslashes mangles silently
  and AGP fails with `Invalid file path` from `SdkLocator` — an error that says
  nothing about this file. That cost a build cycle here.

  It is gitignored: the path is specific to one computer.

---

## 1. Create a signing key

**Once, ever.** If you lose this key you cannot update the app on Play — you
would have to publish a new listing under a new package name.

`android/7by-apps.keystore` already exists on this machine, alias `7by`, and is
gitignored. Use it, or make a dedicated one:

```bash
"C:/Program Files/Android/Android Studio/jbr/bin/keytool.exe" -genkeypair -v -keystore 7audio-release.jks -alias 7audio -keyalg RSA -keysize 4096 -validity 10000
```

It prompts for the password rather than taking it on the command line, which
keeps it out of your shell history. Put it in a password manager.

**Do not write the password into any tracked file.** That is not hypothetical
here: the 7Pay signing key was published exactly that way — keystore committed,
password in plain text in `build.sh` and `README.md` — and had to be retired.

## 2. Point the build at the key

`app/build.gradle` already reads `keystore.properties` and is wired up. You only
need to create the file — `android/7audio/keystore.properties`, gitignored:

```properties
storeFile=../7by-apps.keystore
storePassword=<your store password>
keyAlias=7by
keyPassword=<your key password>
```

If the file is absent the build still succeeds and produces an unsigned bundle,
so a missing password is never a broken build — just one Play will refuse.

## 3. Build

```bash
cd "U:/New folder/android/7audio" && JAVA_HOME="C:/Program Files/Android/Android Studio/jbr" ./gradlew bundleRelease
```

Output: `app/build/outputs/bundle/release/app-release.aab`

Confirm it is actually signed before uploading — this lists the signature block,
and prints nothing at all for an unsigned bundle:

```bash
unzip -l "U:/New folder/android/7audio/app/build/outputs/bundle/release/app-release.aab" | grep -E "META-INF/.*\.(RSA|EC|DSA)"
```

To test on a device first:

```bash
cd "U:/New folder/android/7audio" && JAVA_HOME="C:/Program Files/Android/Android Studio/jbr" ./gradlew assembleRelease
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
