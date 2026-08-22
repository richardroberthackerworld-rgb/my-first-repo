# 7 Audio — email setup

Everything in the application is written and tested. What remains is outside a
codebase: creating four mailboxes and publishing four DNS records. Until those
exist, the server logs each email as `not-configured` rather than pretending it
was sent.

**Nothing below has been configured by me.** I have no access to your DNS or your
hosting panel. These are the exact records to create; verify each one after
publishing using the commands at the end.

---

## 1. Create the four mailboxes

On the mail host for `7audio.7by.in`:

| Address | Purpose |
|---|---|
| `noreply@7audio.7by.in` | verification codes |
| `welcome@7audio.7by.in` | account created |
| `thankyou@7audio.7by.in` | payment outcome |
| `contact@7audio.7by.in` | **a person must read this one** |

The first three are send-only. `contact@` is the reply-to on every email the
application sends, so it needs a real inbox somebody watches — forward it to
wherever you actually read mail.

Only one set of SMTP credentials is needed. Most hosts let a single
authenticated account send as any address on the same domain; if yours does not,
authenticate as `noreply@` and add the other three as permitted send-as
identities.

---

## 2. Server environment variables

Set these on the Node app (cPanel → Setup Node.js App → Environment Variables,
or your host's equivalent). **None of these may ever appear in frontend code or
in a `VITE_`/`NEXT_PUBLIC_` variable.**

```
AUDIO_MAIL_DOMAIN=7audio.7by.in

AUDIO_SMTP_HOST=<your mail host, e.g. smtp.hostinger.com>
AUDIO_SMTP_PORT=587
AUDIO_SMTP_USER=noreply@7audio.7by.in
AUDIO_SMTP_PASS=<the mailbox password>

AUDIO_SITE_URL=https://7audio.7by.in
AUDIO_PRICING_URL=https://7audio.7by.in/pricing
AUDIO_DASHBOARD_URL=https://7audio.7by.in/dashboard
AUDIO_LOGO_URL=https://7audio.7by.in/brand/icon-192.png
```

Restart the app. The boot log then prints:

```
  ✓ 7 Audio email ready: noreply@7audio.7by.in, welcome@7audio.7by.in, thankyou@7audio.7by.in, contact@7audio.7by.in
```

If it instead prints `⚠ 7 Audio email not configured`, the host or user variable
is missing and no email will leave the server.

---

## 3. DNS records — what is already there, and what is not

**This was checked against live DNS on 22 August 2026.** Most of it is already
correct, because cPanel provisions SPF and DKIM automatically when a subdomain
is created. Run `node check-email-dns.mjs` to re-check at any time.

### Already correct — do not touch

**SPF** on `7audio.7by.in`:

```
v=spf1 +a +mx +ip4:190.92.174.87 include:spf.mysecurecloudhost.com ~all
```

Valid, single record, 3 of the permitted 10 DNS lookups, and the include chain
resolves (to MailChannels and antispamcloud, which is the host's outbound
relay). Nothing to change.

**DKIM** on `default._domainkey.7audio.7by.in`: a valid 2048-bit RSA key, and
notably its *own* key rather than a copy of `7by.in`'s — which is what you
want. Nothing to change.

### The one record to add: DMARC

`7audio.7by.in` has no DMARC record of its own. It is not unprotected — DMARC
falls back to the organisational domain, so `7by.in`'s `v=DMARC1; p=none;`
currently applies to the subdomain too.

The reason to add one anyway is reporting. Neither record has a `rua=` tag, so
**no aggregate reports are being sent to anyone, for any domain**. You have no
way of knowing whether your mail is passing authentication until a customer
tells you a code never arrived.

| Field | Value |
|---|---|
| Type | `TXT` |
| Name / Host | `_dmarc.7audio` |
| TTL | default |
| Value | `v=DMARC1; p=none; rua=mailto:contact@7audio.7by.in; fo=1; adkim=r; aspf=r` |

What each part does:

- `p=none` — monitor only. Nothing is quarantined or rejected. This is the
  correct starting point and you should stay on it for a few weeks.
- `rua=mailto:contact@7audio.7by.in` — where daily aggregate reports go. This
  is the whole point of adding the record.
- `fo=1` — send a report when *either* SPF or DKIM fails, not only when both do.
- `adkim=r` / `aspf=r` — relaxed alignment. Strict (`s`) would require an exact
  domain match and is easy to trip over on a subdomain; relaxed is the right
  default here.

Once the reports show SPF and DKIM passing consistently for a few weeks, tighten
in two steps: `p=quarantine` first, then `p=reject`. Never jump straight to
reject — a mistake there sends your own verification codes to nowhere.

While you are in the DNS panel it is worth adding `rua=` to `_dmarc.7by.in`
as well, for the same reason.

### Optional: an explicit MX

`7audio.7by.in` has no MX record. Mail still arrives, because SMTP falls back
to the A record when no MX exists — the implicit-MX rule — and that A record
points at the same cPanel server that handles mail for `7by.in`.

It works, and an explicit record is clearer and less fragile:

| Field | Value |
|---|---|
| Type | `MX` |
| Name / Host | `7audio` |
| Priority | `0` |
| Value | `7by.in` |

This matches how `7by.in` itself is configured.

### What I could not check

Whether the four mailboxes exist and whether the mail server accepts mail for
`7audio.7by.in`. Port 25 is blocked from most consumer connections, so that
test has to run on the server itself:

```bash
printf 'EHLO t\r\nMAIL FROM:<>\r\nRCPT TO:<contact@7audio.7by.in>\r\nQUIT\r\n' | nc localhost 25
```

A `250` on the RCPT line means the domain is accepted. A `550` means
`7audio.7by.in` is not set up as a mail domain in cPanel, and you need to add
it there before any of the DNS above matters.

---

## 4. Verify the records

After publishing, wait for propagation (minutes to a few hours), then run the
checker — it queries public resolvers directly, so a local DNS cache cannot
show you a stale answer:

```bash
node check-email-dns.mjs
```

It reports SPF validity and lookup count, DKIM key validity, DMARC policy and
reporting, and MX. Exit code 0 means nothing is broken.

Or by hand:

```bash
nslookup -type=TXT 7audio.7by.in
nslookup -type=TXT _dmarc.7audio.7by.in
nslookup -type=TXT <selector>._domainkey.7audio.7by.in
```

Then send yourself a real one: sign up with a Gmail address, open the message,
and use Gmail's **Show original**. You want to see all three of:

```
SPF:   PASS
DKIM:  PASS
DMARC: PASS
```

Anything less and Gmail will eventually start filtering your verification codes,
which looks to a customer like the site is broken.

---

## 5. Cashfree webhook

The receipt is sent by the webhook, so the webhook must be reachable.

- Cashfree Dashboard → Developers → Webhooks
- URL: `https://api.7by.in/api/pay/cashfree/webhook`
- Subscribe to `PAYMENT_SUCCESS_WEBHOOK`, and to the failure events if you want
  the "payment not completed" email to go out.
- Set `CASHFREE_WEBHOOK_SECRET` to the signing secret shown there.

A retried webhook is safe: credits are granted once and the receipt is sent
once, keyed on the order id.

---

## 6. What the application does with all this

| Event | Sender | Reply-to |
|---|---|---|
| Verification code requested | `noreply@` | `noreply@` |
| Account created | `welcome@` | `contact@` |
| Payment confirmed **by the server** | `thankyou@` | `contact@` |
| Payment not completed | `thankyou@` | `contact@` |

The receipt is sent only after the server has established that the payment
succeeded — either from a signature-verified webhook, or from the confirm
endpoint asking Cashfree's order API directly. A browser reaching a success page
grants nothing and sends nothing.

Every send is recorded in the `emails` table of the database with its type,
recipient, sender, user, timestamp and status. That record is what makes the
system idempotent, and it is where to look when a customer says an email never
arrived.
