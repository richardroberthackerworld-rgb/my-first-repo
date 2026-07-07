/**
 * 7By.in — credit meter.
 * Premium tools (Vocal Remover, Stem Splitter, Noise Remover) charge credits.
 * Rule: 10 credits per 5 minutes of audio, minimum 10 — charged by file duration.
 *
 * Two modes, same synchronous API so the tools don't need to change:
 *  - Guest (not signed in): a local daily allowance in localStorage (front-end only).
 *  - Signed in (window.API_BASE + a saved token): the SERVER is authoritative.
 *    A signed-in user's balance is fetched from /api/me and each spend is committed
 *    to /api/credits/spend, so it can't be reset by clearing localStorage.
 */
(function () {
  const KEY = '7by_credits_v1';          // guest local wallet
  const SRV = '7by_credits_srv';          // cached server balance (signed-in)
  const DAILY_FREE = 20;
  const PER_5MIN = 10;

  function today() { return new Date().toDateString(); }
  function load(k) { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch (e) { return {}; } }
  function save(k, o) { try { localStorage.setItem(k, JSON.stringify(o)); } catch (e) {} }
  function token() { try { return localStorage.getItem('7by_token'); } catch (e) { return null; } }
  function apiOn() { return !!window.API_BASE && !!token(); }

  async function api(path, body, method) {
    const headers = { 'Content-Type': 'application/json' };
    const t = token(); if (t) headers['Authorization'] = 'Bearer ' + t;
    const r = await fetch(window.API_BASE + path, { method: method || 'POST', headers, body: body ? JSON.stringify(body) : undefined });
    let d = {}; try { d = await r.json(); } catch (e) {}
    if (!r.ok) { const err = new Error(d.error || ('HTTP ' + r.status)); err.status = r.status; err.data = d; throw err; }
    return d;
  }

  // ----- guest local wallet -----
  function guestState() {
    let s = load(KEY);
    if (typeof s.paid !== 'number') s.paid = 0;
    if (s.date !== today()) { s.date = today(); s.free = DAILY_FREE; }
    if (typeof s.free !== 'number') s.free = DAILY_FREE;
    save(KEY, s);
    return s;
  }

  // ----- signed-in cached balance -----
  function srvBalance() { const s = load(SRV); return typeof s.credits === 'number' ? s.credits : 0; }
  function setSrv(c) { save(SRV, { credits: c, ts: Date.now() }); if (typeof window.renderCredits === 'function') try { window.renderCredits(); } catch (e) {} }

  const Credits = {
    DAILY_FREE,
    loggedIn() { return apiOn(); },

    cost(seconds) { return Math.max(PER_5MIN, Math.ceil((seconds || 0) / 300) * PER_5MIN); },

    balance() { return apiOn() ? srvBalance() : (function () { const s = guestState(); return s.free + s.paid; })(); },
    freeLeft() { return apiOn() ? srvBalance() : guestState().free; },
    canSpend(n) { return this.balance() >= n; },

    // Pull the authoritative balance from the server (call on load + after login/payment).
    async sync() {
      if (!apiOn()) return this.balance();
      try { const d = await api('/api/me', null, 'GET'); if (d.user && typeof d.user.credits === 'number') setSrv(d.user.credits); }
      catch (e) { /* keep cached value; if the session is invalid the auth layer clears it */ }
      return this.balance();
    },

    // Spend credits. Signed in → commit to the server (authoritative), optimistic UI.
    // Guest → local wallet. Returns the new balance (may be optimistic for signed-in).
    spend(n) {
      if (apiOn()) {
        const before = srvBalance();
        setSrv(Math.max(0, before - n));          // optimistic
        api('/api/credits/spend', { amount: n }).then(d => {
          if (typeof d.credits === 'number') setSrv(d.credits);
        }).catch(e => {
          if (e.status === 402 && e.data && typeof e.data.credits === 'number') setSrv(e.data.credits);
          else this.sync();
          if (typeof window.toast === 'function') window.toast('Credit sync issue — balance refreshed');
        });
        return srvBalance();
      }
      const s = guestState();
      let rem = n; const useFree = Math.min(s.free, rem); s.free -= useFree; rem -= useFree;
      s.paid = Math.max(0, s.paid - rem); save(KEY, s);
      return s.free + s.paid;
    },

    // Local top-up for guests / demo only. Real purchases credit the account server-side.
    addPaid(n) { if (apiOn()) return srvBalance(); const s = guestState(); s.paid += n; save(KEY, s); return s.free + s.paid; }
  };

  window.Credits = Credits;
  // Refresh from the server on load if already signed in.
  if (typeof window !== 'undefined') setTimeout(() => { try { if (Credits.loggedIn()) Credits.sync(); } catch (e) {} }, 0);
})();
