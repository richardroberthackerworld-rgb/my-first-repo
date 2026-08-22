# 7By.in Backend

Auth (email OTP + Google), server-authoritative credits, and Razorpay payments for the 7By.in tools.

## Setup

```bash
cd server
npm install
cp .env.example .env      # then edit .env with your real values
npm start                 # http://localhost:8787
```

Without SMTP configured, OTP codes are **printed to the server console** so you can test the full flow locally. Without Google/Razorpay keys, those features return a clear "not configured" error.

## Point the front-end at the backend

In `assets/layout.js` set:

```js
window.API_BASE = 'https://api.7by.in';   // or 'http://localhost:8787' for local dev
```

(Leave it empty to keep the front-end in offline/demo mode.)

## Endpoints

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/auth/signup`  | `{name,email,password}` | Sends OTP from noreply@7by.in |
| POST | `/api/auth/verify`  | `{email,otp}` | Creates account → `{token,user}` |
| POST | `/api/auth/login`   | `{email,password}` | → `{token,user}` |
| POST | `/api/auth/forgot`  | `{email}` | Sends reset OTP |
| POST | `/api/auth/reset`   | `{email,otp,newPassword}` | |
| POST | `/api/auth/google`  | `{credential}` | Google ID token (GIS) |
| GET  | `/api/me`           | — (Bearer) | `{user}` incl. credits |
| POST | `/api/credits/spend`| `{amount}` (Bearer) | Server-authoritative deduct |
| POST | `/api/pay/order`    | `{plan}` (Bearer) | Creates Razorpay order |
| POST | `/api/pay/verify`   | `{razorpay_*, plan}` (Bearer) | Verifies signature, adds credits |

## Credits model

- 20 free credits granted daily (resets each day).
- Paid credits stack on top (Monthly = 1,000 / Annual = 20,000; configurable in `.env`).
- AI tools should call `/api/credits/spend {amount:10*ceil(seconds/300)}` on export.

## Production notes

- Swap the JSON file store (`db.json`) for Postgres/Mongo.
- Serve over HTTPS behind a reverse proxy; set `CORS_ORIGIN` to your real domain.
- Set a strong `JWT_SECRET`.
- For Razorpay, also configure a **webhook** (`payment.captured`) as a backstop to credit accounts even if the browser closes before `/api/pay/verify`.
