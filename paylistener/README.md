# 7Pay Listener (Android companion app)

Tiny Android app (~17 KB) that makes 7Pay's automatic payment detection work
without any third-party forwarder app. It captures:

- **Payment notifications** from every app — Google Pay, PhonePe, Paytm, BHIM,
  bank apps (anything whose notification says "received"/"credited")
- **Incoming bank SMS** (credit alerts)

…and POSTs the text to the gateway's `upi.credit` endpoint, which matches the
unique paise-amount and auto-captures the payment.

## Install (on the phone that receives payments)

1. On the phone, download **https://7pay.7by.in/7pay-listener.apk**
2. Install (allow "install unknown apps" for the browser; Play Protect will
   warn because it's self-signed — tap "Install anyway")
3. Open the app:
   - paste the gateway URL incl. your token:
     `https://7pay.7by.in/api.php?action=upi.credit&token=YOUR_TOKEN` → Save
   - **1 · Grant notification access** → enable "7Pay Listener"
   - **2 · Grant SMS permission** → Allow
   - **3 · Send test** → log should show `HTTP 200`
4. Phone Settings → Battery → 7Pay Listener → **Unrestricted**

The app keeps a small activity log on its screen (last forwards + HTTP codes).

## Build

`./build.sh` (Git Bash) — uses the local Android SDK directly (aapt2 → javac →
d8 → zipalign → apksigner), no Gradle. Note: d8 from build-tools **34.0.0**
crashes on JDK-21-compiled classes; the script pins build-tools **37.0.0**.

`7pay-release.keystore` signs every build. Android only installs updates
signed with the same key, so keep it and back it up — losing it means every
user has to uninstall and reinstall. Output lands in
`build/7pay-listener.apk`; copy it to `pay/7pay-listener.apk` to publish.

The password is **not written down here**. It lives in `keystore.properties`
next to `build.sh` (gitignored) and in a password manager. `build.sh` reads it
from there or from `KEYSTORE_PASS`/`KEY_PASS`.

### The first key was compromised

The original key, created 12 Jul 2026, was published: the keystore file was
committed to a public repository, and its password was written in plain text in
both this README and `build.sh`. Anyone who cloned the repo between then and
22 Aug 2026 can sign an APK that Android accepts as a genuine update to this
app — which for a listener holding a gateway token is worth taking seriously.

Retired key, for identifying anything it signed:

    alias   7pay
    created 12 Jul 2026
    SHA-256 F1:2E:22:4B:41:C3:D0:E9:82:81:2F:59:DE:88:44:C3:
            F9:CB:37:2B:EC:C8:A5:DF:6D:6A:44:20:54:2D:5E:06
    SHA-1   89:0B:38:6A:3E:26:1D:F8:55:1B:74:2E:AE:DE:4F:FA:91:25:D3:FD

Any APK carrying that SHA-256 is signed with the compromised key and should be
treated as untrusted, including any copy of `7pay-listener.apk` downloaded
before the replacement was published.

Because the signature changes, the new build **cannot install over the old
one**. On each phone: uninstall 7Pay Listener, install the new APK, then set
the gateway URL and re-grant notification and SMS access.
