import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
  /** ms; 0 keeps it until dismissed. */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  push: (toast: Omit<Toast, 'id'>) => number;
  dismiss: (id: number) => void;
  success: (title: string, body?: string) => number;
  error: (title: string, body?: string) => number;
  info: (title: string, body?: string) => number;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const ICONS: Record<ToastKind, typeof Info> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
};

const COLORS: Record<ToastKind, string> = {
  success: 'var(--ok)',
  error: 'var(--err)',
  info: 'var(--brand)',
  warning: 'var(--warn)',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      seq.current += 1;
      const id = seq.current;
      const duration = toast.duration ?? (toast.kind === 'error' ? 8000 : 4500);
      setToasts((list) => [...list.slice(-3), { ...toast, id }]);
      if (duration > 0) {
        timers.current.set(id, window.setTimeout(() => dismiss(id), duration));
      }
      return id;
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      push,
      dismiss,
      success: (title, body) => push({ kind: 'success', title, body }),
      error: (title, body) => push({ kind: 'error', title, body }),
      info: (title, body) => push({ kind: 'info', title, body }),
    }),
    [push, dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => window.clearTimeout(t));
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        style={{
          position: 'fixed',
          zIndex: 120,
          right: 'max(16px, env(safe-area-inset-right))',
          bottom: 'calc(16px + env(safe-area-inset-bottom))',
          left: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          pointerEvents: 'none',
          maxWidth: 'min(380px, calc(100vw - 32px))',
        }}
        className="toast-stack"
      >
        {toasts.map((toast) => {
          const Icon = ICONS[toast.kind];
          return (
            <div
              key={toast.id}
              role={toast.kind === 'error' ? 'alert' : 'status'}
              className="card fade-up"
              style={{
                pointerEvents: 'auto',
                display: 'flex',
                gap: 12,
                padding: '14px 14px 14px 16px',
                boxShadow: 'var(--shadow-lg)',
                borderLeft: `3px solid ${COLORS[toast.kind]}`,
              }}
            >
              <Icon size={18} style={{ color: COLORS[toast.kind], flex: 'none', marginTop: 2 }} aria-hidden="true" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-0.01em' }}>{toast.title}</div>
                {toast.body && (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5 }}>
                    {toast.body}
                  </div>
                )}
                {toast.action && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    style={{ marginTop: 10 }}
                    onClick={() => {
                      toast.action?.onClick();
                      dismiss(toast.id);
                    }}
                  >
                    {toast.action.label}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss notification"
                style={{
                  background: 'none',
                  border: 0,
                  cursor: 'pointer',
                  color: 'var(--text-dim)',
                  padding: 4,
                  margin: -4,
                  height: 'fit-content',
                }}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
