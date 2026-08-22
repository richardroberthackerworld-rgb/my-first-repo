import { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw, Share, SquarePlus, X } from 'lucide-react';
import {
  applyUpdate,
  installAvailable,
  isIos,
  isStandalone,
  onInstallAvailabilityChange,
  onUpdateReady,
  promptInstall,
} from '@/services/pwa';

const DISMISSED_KEY = 'audiora:install-dismissed';
/** How long a "not now" lasts before the offer may come back. */
const SNOOZE_DAYS = 14;

function snoozed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISSED_KEY) ?? '0');
    return Date.now() - at < SNOOZE_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function snooze(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  } catch {
    /* storage disabled */
  }
}

/* ============================================================== install === */

/**
 * The install offer.
 *
 * Shown only when the browser has actually decided 7 Audio is installable —
 * or on iOS, where no such event exists and the Share sheet is the only route.
 * Never shown to someone already running it from their home screen, and not
 * again for a fortnight after a "not now".
 */
export function InstallCard() {
  const [canInstall, setCanInstall] = useState(installAvailable);
  const [hidden, setHidden] = useState(() => isStandalone() || snoozed());
  const [busy, setBusy] = useState(false);

  useEffect(() => onInstallAvailabilityChange(() => setCanInstall(installAvailable())), []);

  const ios = isIos();
  if (hidden || (!canInstall && !ios)) return null;

  const dismiss = () => {
    snooze();
    setHidden(true);
  };

  const install = async () => {
    setBusy(true);
    const outcome = await promptInstall();
    setBusy(false);
    if (outcome === 'accepted') setHidden(true);
    if (outcome === 'dismissed') dismiss();
  };

  return (
    <div className="install-card">
      <span className="install-icon">
        <Download size={20} aria-hidden="true" />
      </span>

      <div style={{ minWidth: 0, flex: 1 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700 }}>Install 7 Audio</h3>
        {ios && !canInstall ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
            Tap <Share size={13} style={{ verticalAlign: '-2px' }} aria-label="Share" /> then{' '}
            <b style={{ color: 'var(--text)' }}>
              Add to Home Screen <SquarePlus size={13} style={{ verticalAlign: '-2px' }} aria-hidden="true" />
            </b>
            .
          </p>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
            Open it straight from your home screen, with no browser bar in the way.
          </p>
        )}
      </div>

      {canInstall && (
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void install()} disabled={busy}>
          {busy ? 'Please wait…' : 'Install'}
        </button>
      )}

      <button type="button" className="install-dismiss" onClick={dismiss} aria-label="Not now">
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

/* =============================================================== update === */

/**
 * A new build is downloaded and waiting. It is NOT applied on its own: a
 * separation job runs for minutes, and swapping the app underneath one would
 * throw that work away. The user decides when.
 */
export function UpdateBanner() {
  const [ready, setReady] = useState(false);
  const [taking, setTaking] = useState(false);

  useEffect(() => onUpdateReady(() => setReady(true)), []);

  const take = useCallback(() => {
    setTaking(true);
    applyUpdate();
  }, []);

  if (!ready) return null;

  return (
    <div className="update-banner" role="status">
      <RefreshCw size={15} aria-hidden="true" style={{ flex: 'none' }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        A new version of 7 Audio is ready. Anything you are processing right now will finish first.
      </span>
      <button type="button" className="btn btn-sm btn-primary" onClick={take} disabled={taking}>
        {taking ? 'Please wait…' : 'Reload'}
      </button>
      <button type="button" className="install-dismiss" onClick={() => setReady(false)} aria-label="Later">
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
