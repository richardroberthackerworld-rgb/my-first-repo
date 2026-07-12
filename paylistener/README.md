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

`7pay-release.keystore` (pass `sevenpay7by`) signs every build — **keep it**:
Android only installs updates signed with the same key. Output lands in
`build/7pay-listener.apk`; copy it to `pay/7pay-listener.apk` to publish.
