import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Coins, Grid2x2, Home, Plus, User } from 'lucide-react';
import { TOOLS } from '@/config/tools';
import { Modal } from './ui/Modal';

const ITEMS = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/tools', label: 'Tools', icon: Grid2x2, end: false },
  { to: '/credits', label: 'Credits', icon: Coins, end: false },
  { to: '/profile', label: 'Profile', icon: User, end: false },
];

/**
 * Fixed bottom navigation for the mobile app experience.
 * The centre button opens a real quick-action sheet, not a decoration.
 */
export function BottomNav() {
  const [quickOpen, setQuickOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <>
      <nav className="bottom-nav" aria-label="Primary">
        {ITEMS.slice(0, 2).map((item) => (
          <BottomLink key={item.to} {...item} />
        ))}

        <button
          type="button"
          className="bottom-fab"
          aria-label="Quick actions"
          aria-haspopup="dialog"
          onClick={() => setQuickOpen(true)}
        >
          <Plus size={24} aria-hidden="true" />
        </button>

        {ITEMS.slice(2).map((item) => (
          <BottomLink key={item.to} {...item} />
        ))}
      </nav>

      <Modal
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        title="Start something"
        description="Pick a tool and load a file from your device."
        width={440}
        footer={
          <button type="button" className="btn btn-secondary btn-block" onClick={() => setQuickOpen(false)}>
            Cancel
          </button>
        }
      >
        <div style={{ display: 'grid', gap: 8 }}>
          {TOOLS.filter((tool) => tool.path).map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => {
                  setQuickOpen(false);
                  navigate(tool.path as string);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                  minHeight: 56,
                  textAlign: 'left',
                  borderRadius: 'var(--r)',
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    width: 38,
                    height: 38,
                    flex: 'none',
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: 11,
                    background: `color-mix(in srgb, ${tool.accent} 12%, transparent)`,
                    color: tool.accent,
                  }}
                >
                  <Icon size={18} aria-hidden="true" />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>{tool.name}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.4 }}>
                    {tool.tagline}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Modal>
    </>
  );
}

function BottomLink({ to, label, icon: Icon, end }: { to: string; label: string; icon: typeof Home; end: boolean }) {
  return (
    <NavLink to={to} end={end} className="bottom-link">
      {({ isActive }) => (
        <>
          <span className="bottom-icon" data-active={isActive}>
            <Icon size={20} aria-hidden="true" />
          </span>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: isActive ? 'var(--brand)' : 'var(--text-dim)' }}>
            {label}
          </span>
        </>
      )}
    </NavLink>
  );
}
