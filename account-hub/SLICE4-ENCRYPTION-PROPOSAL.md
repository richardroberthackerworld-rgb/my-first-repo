# Slice 4 — API-key encryption at rest

**Status: proposal. No code written. Awaiting approval.**

This covers the ten points you listed, plus the two extra questions:
whether keys are encrypted individually, and how the metadata is stored.

---

## 1. `OPS_KEY_SECRET` — where the secret lives

A **dedicated** secret, used for nothing else.

```
OPS_KEY_SECRET = 64 hex characters (32 bytes of CSPRNG output)
```

**Not `app_secret`.** That value already signs sessions, tokens and OTP
payloads. Reusing it would mean rotating it — a routine security action —
silently destroys every stored API key. Two jobs, two secrets.

**Storage, in order of preference:**

1. **cPanel → Setup PHP → environment variable** — never on disk in the
   document root, absent from every backup that copies files.
2. **`keys-secret.php` outside the document root**, e.g.
   `/home/byin/secrets/keys-secret.php`, `chmod 600`, returning the string.

Resolution order: `getenv('OPS_KEY_SECRET')` → the file → **fail closed**.
Never a hardcoded fallback: a default secret is the same as no encryption,
and worse because it looks encrypted.

If the secret is absent, `api_keys` operations refuse and raise a
`CONFIG_MISSING_KEY_SECRET` incident. **The site keeps serving** — this
degrades AI features only.

---

## 2. AES-256-GCM

`openssl_encrypt($plain, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $nonce, $tag)`

GCM is **AEAD** — it authenticates as well as encrypts. CBC would encrypt
but let an attacker with database write access flip ciphertext bits
undetected. GCM's tag makes tampering a decryption *failure*, not a
silently corrupted key.

The 32-byte encryption key is **derived**, not used raw:

```
key = HKDF-SHA256(ikm: hex2bin(OPS_KEY_SECRET),
                  salt: "7by.ops.apikeys.v1",
                  info: "apikey:" || provider || ":" || key_id)
```

Per-row `info` means every row gets a distinct key. Two rows holding the
same Gemini key produce different ciphertext, and a nonce reused across
rows still cannot cross-contaminate — which matters because GCM nonce
reuse *under the same key* is catastrophic.

---

## 3. Nonce generation

**12 bytes** (96 bits — the GCM-native size, no internal rehashing) from
`random_bytes()`, **fresh for every encryption**, including re-encrypting
an unchanged key.

Stored **alongside** the ciphertext, not derived and not secret. A nonce
is public by design; it only must never repeat for a given key. With
per-row key derivation *and* a random nonce, collision probability is
negligible.

**Never a counter, never a timestamp, never derived from the key id** —
all of those repeat after a restore-from-backup.

---

## 4. Authentication tag

16 bytes, produced by `openssl_encrypt`, stored with the record.

On decrypt, a bad tag makes `openssl_decrypt` return `false`. That is
treated as **tamper or wrong key** — never as an empty key:

- mark the row `enabled = 0`
- raise `APIKEY_DECRYPT_FAILED` (severity high)
- **skip to the next key** in the failover chain

A key that will not decrypt must never be sent to a provider as an empty
string, which would look like an auth failure and poison the health stats.

**AAD binds the ciphertext to its row:** `provider || ":" || id`. Moving a
row's ciphertext to a different provider fails the tag check — so a
database editor cannot repoint a key by swapping columns.

---

## 5. Key versioning

Every row records the scheme that produced it:

```
enc_v = 1   →  HKDF-SHA256 + AES-256-GCM, 12-byte nonce, 16-byte tag
```

Stored as a column, not inferred from the payload. Decryption dispatches
on it, so v1 and a future v2 coexist during a migration and old rows stay
readable. Without a version, changing the algorithm later means a flag
day.

---

## 6. Rotation

Two independent things, deliberately separated:

**Rotating an API key** (the provider's secret changed) — already
supported by the slice 1 schema: add the new key, set priority, disable
the old one, delete when confident. No downtime, no re-encryption.

**Rotating `OPS_KEY_SECRET`** — a maintenance script:

1. read `OPS_KEY_SECRET_OLD` and `OPS_KEY_SECRET` (both present)
2. for each row: decrypt with old → re-encrypt with new → write in **one
   transaction** per row, with `enc_v` and a new nonce
3. verify every row decrypts under the new secret
4. only then remove `OPS_KEY_SECRET_OLD`

Per-row transactions mean an interrupted rotation leaves a mix of old and
new — recoverable — rather than a half-written table.

---

## 7. Backup and recovery

**The database backup alone is useless without the secret. That is the
point.** It also means a backup restored to a machine without the secret
has no working AI keys.

Requirements:
- back up `OPS_KEY_SECRET` **separately** from the database, in a password
  manager or sealed envelope — never in the same archive, never in git
- verify a restore path at least once
- after any restore, run a decrypt check across all rows before trusting
  the deployment

---

## 8. If `OPS_KEY_SECRET` is lost

**The stored keys are unrecoverable.** Not "hard" — mathematically gone.
There is no backdoor, no recovery key, no vendor escape hatch. That is
what makes the encryption worth having.

Recovery is: reissue the API keys at each provider (Gemini, Groq,
Cerebras, OpenRouter, Mistral, GitHub) and re-enter them. Roughly
15 minutes of work, and only the *keys* are affected — no user, payment or
subscription data is encrypted with this secret.

I will implement a `--verify` mode that decrypts every row and reports
failures, so a lost or wrong secret is discovered by a health check rather
than by customers hitting a dead AI service.

---

## 9. Migrating existing keys

Today's keys live in **`keys.php` as plaintext PHP** on the server. They
were never in `api_keys`, so there is nothing to decrypt — this is an
import, not a re-encryption.

```
ops-import-keys.php   (CLI only, run once, then deleted)
  read keys.php  →  encrypt each  →  insert into api_keys
  print a per-key masked confirmation (AIza••••9X2)
  DO NOT delete or modify keys.php
```

`keys.php` stays untouched as the rollback path until the admin panel is
proven. Only after that would we empty it — a separate, reversible step.

**Order matters:** import first, verify the panel reads them, *then* switch
`api.php` from `keys.php` to `api_keys`. Never both at once.

---

## 10. Decryption stays server-side

Structural guarantees, not conventions:

- no endpoint returns `secret_enc` or a decrypted key — the admin API
  returns `hint` only (`AIza••••••••9X2`, first 4 + last 3)
- decryption happens **only** inside the provider-call path, into a local
  variable, never into a response array, session, log line or template
- the admin "Test key" action calls the provider **server-side** and
  returns pass/fail — the browser never touches the secret
- incident capture masks anything matching known key shapes before storage
- a self-test asserts no HTTP response body ever contains a decrypted key

---

## Extra question 1 — individually or in bulk?

**Individually — one ciphertext per key.**

Bulk encrypting a JSON blob of all keys would mean: reading one key
decrypts all of them into memory; rotating one rewrites the whole blob;
one corrupt byte loses every key; and per-key `enabled`/`priority`/
`failures` could no longer be plain indexed columns. Row-level encryption
keeps the operational columns queryable and blast radius at one key.

## Extra question 2 — where the metadata goes

Ciphertext, nonce and tag are **separate columns**, not a packed string:

| Column | Type | Contents |
|---|---|---|
| `secret_enc` | `TEXT` | base64 ciphertext |
| `enc_nonce` | `VARBINARY(12)` | GCM nonce |
| `enc_tag` | `VARBINARY(16)` | GCM auth tag |
| `enc_v` | `TINYINT` | scheme version |
| `hint` | `VARCHAR(32)` | masked display value |

Three columns are added to the slice 1 `api_keys` table via `ALTER` — the
same pattern used for `provider_msg_id`, so a live table upgrades in place.

Separate columns over a packed `v1$nonce$tag$ct` string because parsing is
a place bugs live, and because a `VARBINARY` column cannot be silently
mangled by a charset conversion during a database export/import.

---

## What I need from you before writing code

1. **Approve or amend this design.**
2. **Choose the secret's home** — cPanel env var (preferred) or a file
   outside the document root.
3. **Confirm the migration stance:** import into `api_keys` while leaving
   `keys.php` intact as the rollback, and cut over only after the panel is
   proven.

No Slice 4 code until you have said yes.
