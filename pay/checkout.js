/**
 * 7Pay checkout.js — drop-in payment SDK (Razorpay-compatible shape).
 *
 *   <script src="https://pay.7by.in/checkout.js"></script>
 *   var sp = new SevenPay({
 *     key: '7pay_yourkey',
 *     order_id: 'order_xxx',            // from POST /api.php?action=order.create
 *     description: 'Monthly — 1000 credits',
 *     prefill: { email: '', contact: '' },
 *     handler: function (resp) {
 *       // resp.sevenpay_order_id, resp.sevenpay_payment_id, resp.sevenpay_signature
 *     },
 *     modal: { ondismiss: function () {} },
 *   });
 *   sp.on('payment.failed', function (e) {});
 *   sp.open();
 */
(function () {
  'use strict';

  // Gateway base = wherever this script was loaded from.
  var script = document.currentScript;
  var BASE = (script && script.src) ? script.src.replace(/\/checkout\.js.*$/, '') : '';

  function SevenPay(opts) {
    if (!(this instanceof SevenPay)) return new SevenPay(opts);
    this.opts = opts || {};
    this._handlers = {};
    this._overlay = null;
    this._msgListener = null;
  }

  SevenPay.prototype.on = function (event, fn) {
    (this._handlers[event] = this._handlers[event] || []).push(fn);
    return this;
  };

  SevenPay.prototype._emit = function (event, data) {
    (this._handlers[event] || []).forEach(function (fn) {
      try { fn(data); } catch (e) { /* user handler error */ }
    });
  };

  SevenPay.prototype.open = function () {
    var self = this, o = this.opts;
    if (!o.key || !o.order_id) throw new Error('SevenPay: key and order_id are required');
    if (this._overlay) return;

    var overlay = document.createElement('div');
    overlay.setAttribute('style',
      'position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,0.55);' +
      'backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;' +
      'opacity:0;transition:opacity 200ms ease;padding:16px;');

    var frame = document.createElement('iframe');
    var q = 'order_id=' + encodeURIComponent(o.order_id)
      + '&key_id=' + encodeURIComponent(o.key)
      + '&embed=1'
      + (o.description ? '&description=' + encodeURIComponent(o.description) : '')
      + (o.prefill && o.prefill.email ? '&email=' + encodeURIComponent(o.prefill.email) : '')
      + (o.prefill && o.prefill.contact ? '&contact=' + encodeURIComponent(o.prefill.contact) : '');
    frame.src = BASE + '/checkout.php?' + q;
    frame.setAttribute('allowtransparency', 'true');
    frame.setAttribute('style',
      'width:100%;max-width:420px;height:640px;max-height:94vh;border:0;border-radius:20px;' +
      'background:transparent;box-shadow:0 24px 80px rgba(15,23,42,0.35);' +
      'transform:translateY(12px);transition:transform 250ms ease;');
    overlay.appendChild(frame);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () {
      overlay.style.opacity = '1';
      frame.style.transform = 'translateY(0)';
    });
    this._overlay = overlay;

    this._msgListener = function (ev) {
      var m = ev.data || {};
      if (typeof m !== 'object' || !m.type || String(m.type).indexOf('sevenpay:') !== 0) return;
      if (m.type === 'sevenpay:success') {
        self.close();
        if (typeof o.handler === 'function') o.handler(m.data);
      } else if (m.type === 'sevenpay:failed') {
        self._emit('payment.failed', m.data || {});
      } else if (m.type === 'sevenpay:dismiss') {
        self.close();
        if (o.modal && typeof o.modal.ondismiss === 'function') o.modal.ondismiss();
      }
    };
    window.addEventListener('message', this._msgListener);
  };

  SevenPay.prototype.close = function () {
    if (!this._overlay) return;
    var overlay = this._overlay;
    this._overlay = null;
    window.removeEventListener('message', this._msgListener);
    overlay.style.opacity = '0';
    setTimeout(function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.body.style.overflow = '';
    }, 200);
  };

  window.SevenPay = SevenPay;
})();
