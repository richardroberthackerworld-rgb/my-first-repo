import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, Menu, Moon, Sun, X } from 'lucide-react';
import { BrandLogo, BrandMark } from './Brand';
import { MAIN_NAV } from '@/config/site';
import { TOOLS } from '@/config/tools';
import { useTheme } from '@/hooks/useTheme';
import { AccountChip } from './AccountChip';

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { toggle, isDark } = useTheme();
  const [, force] = useState(0);
  return (
    <button
      type="button"
      className="icon-btn"
      style={compact ? { width: 42, height: 42 } : undefined}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => {
        toggle();
        force((n) => n + 1);
      }}
    >
      {isDark ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}
    </button>
  );
}

/* ------------------------------------------------------- tools dropdown --- */

function ToolsMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = location.pathname.startsWith('/tools');

  return (
    <div ref={wrapRef} style={{ position: 'relative' }} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="nav-link"
        aria-expanded={open}
        aria-haspopup="true"
        data-active={active}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 0, background: 'none', cursor: 'pointer' }}
      >
        Tools
        <ChevronDown size={14} aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s ease' }} />
      </button>

      {open && (
        <div
          className="card fade-up"
          style={{
            position: 'absolute',
            top: 'calc(100% + 10px)',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 560,
            maxWidth: 'calc(100vw - 40px)',
            padding: 10,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 2,
            boxShadow: 'var(--shadow-lg)',
            zIndex: 60,
          }}
        >
          {TOOLS.filter((tool) => tool.path).map((tool) => {
            const Icon = tool.icon;
            return (
              <Link
                key={tool.id}
                to={tool.path as string}
                style={{ display: 'flex', gap: 11, padding: '10px 11px', borderRadius: 'var(--r-sm)', alignItems: 'flex-start' }}
                className="menu-item"
              >
                <span
                  style={{
                    width: 34,
                    height: 34,
                    flex: 'none',
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: 10,
                    background: `color-mix(in srgb, ${tool.accent} 12%, transparent)`,
                    color: tool.accent,
                  }}
                >
                  <Icon size={17} aria-hidden="true" />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, letterSpacing: '-0.01em' }}>{tool.name}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.45, marginTop: 1 }}>
                    {tool.short}
                  </span>
                </span>
              </Link>
            );
          })}
          <Link
            to="/tools"
            className="menu-item"
            style={{
              gridColumn: '1 / -1',
              marginTop: 4,
              padding: '11px',
              borderRadius: 'var(--r-sm)',
              textAlign: 'center',
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--brand)',
              background: 'var(--brand-soft)',
            }}
          >
            View all tools →
          </Link>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- drawer -- */

function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 140, background: 'rgba(9,11,22,0.45)', backdropFilter: 'blur(2px)' }}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <nav
        aria-label="Main menu"
        style={{
          position: 'absolute',
          inset: '0 auto 0 0',
          width: 'min(320px, 86vw)',
          background: 'var(--surface)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          animation: 'slideIn 0.24s cubic-bezier(0.22,0.9,0.3,1)',
          paddingTop: 'env(safe-area-inset-top)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
          <Link to="/" onClick={onClose}>
            <BrandLogo size={32} />
          </Link>
          <button type="button" className="icon-btn icon-btn-sm" onClick={onClose} aria-label="Close menu">
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        <div style={{ padding: 12, overflowY: 'auto', flex: 1 }}>
          {MAIN_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={onClose}
              className="drawer-link"
              style={({ isActive }) => ({
                display: 'block',
                padding: '13px 14px',
                borderRadius: 'var(--r)',
                fontSize: 15,
                fontWeight: 600,
                minHeight: 44,
                color: isActive ? 'var(--brand)' : 'var(--text)',
                background: isActive ? 'var(--brand-soft)' : 'transparent',
              })}
            >
              {item.label}
            </NavLink>
          ))}

          <div style={{ height: 1, background: 'var(--border)', margin: '12px 6px' }} />
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-dim)', padding: '4px 14px 8px' }}>
            All tools
          </p>
          {TOOLS.filter((t) => t.path).map((tool) => {
            const Icon = tool.icon;
            return (
              <NavLink
                key={tool.id}
                to={tool.path as string}
                onClick={onClose}
                className="drawer-link"
                style={({ isActive }) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: 11,
                  padding: '11px 14px',
                  borderRadius: 'var(--r)',
                  fontSize: 14,
                  fontWeight: 600,
                  minHeight: 44,
                  color: isActive ? 'var(--brand)' : 'var(--text-muted)',
                  background: isActive ? 'var(--brand-soft)' : 'transparent',
                })}
              >
                <Icon size={16} style={{ color: tool.accent, flex: 'none' }} aria-hidden="true" />
                {tool.name}
              </NavLink>
            );
          })}
        </div>

        <div style={{ padding: 16, borderTop: '1px solid var(--border)', paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}>
          <Link to="/signin" onClick={onClose} className="btn btn-primary btn-block">
            Sign In
          </Link>
        </div>
      </nav>
      <style>{'@keyframes slideIn{from{transform:translateX(-100%)}to{transform:none}}'}</style>
    </div>
  );
}

/* ---------------------------------------------------------------- header -- */

export function Header() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <header className="site-header" data-scrolled={scrolled}>
        <div className="container header-inner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <button
              type="button"
              className="icon-btn hamburger"
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
            >
              <Menu size={19} aria-hidden="true" />
            </button>
            <Link to="/" aria-label="7 Audio home" style={{ minWidth: 0 }}>
              <span className="logo-full">
                <BrandLogo size={34} />
              </span>
              <span className="logo-mark">
                <BrandMark size={30} />
              </span>
            </Link>
          </div>

          <nav className="desktop-nav" aria-label="Primary">
            {MAIN_NAV.map((item) =>
              item.tools ? (
                <ToolsMenu key={item.to} />
              ) : (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className="nav-link"
                  style={({ isActive }) => ({ color: isActive ? 'var(--brand)' : undefined })}
                >
                  {item.label}
                </NavLink>
              ),
            )}
          </nav>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ThemeToggle />
            <AccountChip />
          </div>
        </div>
      </header>

      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}
