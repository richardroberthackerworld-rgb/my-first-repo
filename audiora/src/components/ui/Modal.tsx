import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  /** Max content width in px. */
  width?: number;
}

/**
 * Accessible dialog: focus is trapped while open, Escape closes, background
 * scroll is locked, and focus returns to whatever opened it.
 */
export function Modal({ open, onClose, title, description, children, footer, width = 480 }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement as HTMLElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown, true);

    const timer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>('[data-autofocus], button, a[href]')?.focus();
    }, 20);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(timer);
      restoreFocus.current?.focus?.();
    };
  }, [open, onKeyDown]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 130,
        display: 'grid',
        placeItems: 'center',
        padding: 18,
        background: 'rgba(9, 11, 22, 0.45)',
        backdropFilter: 'blur(3px)',
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        aria-describedby={description ? 'modal-desc' : undefined}
        className="card fade-up"
        style={{ width: '100%', maxWidth: width, boxShadow: 'var(--shadow-lg)', maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '20px 20px 0' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="modal-title" style={{ fontSize: 18 }}>
              {title}
            </h2>
            {description && (
              <p id="modal-desc" style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.55 }}>
                {description}
              </p>
            )}
          </div>
          <button type="button" className="icon-btn icon-btn-sm" onClick={onClose} aria-label="Close dialog">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {children && <div style={{ padding: '18px 20px 0', overflowY: 'auto' }}>{children}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap', padding: 20 }}>
          {footer ?? (
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
