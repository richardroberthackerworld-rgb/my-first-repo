import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowRight, Clock, Coins, FileAudio, HardDrive, Star, Zap } from 'lucide-react';
import { EmptyState, SkeletonBlock } from '@/components/ui/States';
import { TOOLS, toolById } from '@/config/tools';
import { formatBytes, formatTime } from '@/services/audio';
import { useSession } from '@/services/session';
import { DAILY_ALLOWANCE } from '@/config/credits';
import {
  listActivity,
  readFavourites,
  storageEstimate,
  summarise,
  toggleFavourite,
  type ActivityRecord,
  type WorkspaceStats,
} from '@/services/workspace';

export default function Dashboard() {
  const [records, setRecords] = useState<ActivityRecord[] | null>(null);
  const [stats, setStats] = useState<WorkspaceStats | null>(null);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [favourites, setFavourites] = useState<string[]>([]);
  const { credits, account, signedIn, available } = useSession();

  useEffect(() => {
    listActivity(30).then((list) => {
      setRecords(list);
      setStats(summarise(list));
    });
    storageEstimate().then(setStorage);
    setFavourites(readFavourites());
  }, []);

  const favouriteTools = TOOLS.filter((tool) => favourites.includes(tool.id) && tool.path);
  const suggested = stats?.byTool.slice(0, 3) ?? [];

  return (
    <div className="container section">
      <header style={{ marginBottom: 26 }}>
        <h1 style={{ fontSize: 'clamp(25px, 4.6vw, 34px)' }}>
          {account ? `Hello, ${account.name.split(' ')[0]}` : 'Dashboard'}
        </h1>
        <p style={{ fontSize: 14.5, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6, maxWidth: 620 }}>
          A summary of what you have processed recently.
        </p>
      </header>

      {/* ------------------------------------------------------------ stats */}
      <div className="stat-grid">
        <StatCard
          icon={Activity}
          label="Jobs run"
          value={stats ? String(stats.runs) : null}
          hint="All time"
          accent="var(--a-violet)"
        />
        <StatCard
          icon={FileAudio}
          label="Files produced"
          value={stats ? String(stats.files) : null}
          hint="Downloaded or previewed"
          accent="var(--a-green)"
        />
        <StatCard
          icon={Clock}
          label="Audio processed"
          value={stats ? formatTime(stats.seconds) : null}
          hint="Total duration"
          accent="var(--a-orange)"
        />
        {available ? (
          <StatCard
            icon={Coins}
            label="Credits"
            value={credits.toLocaleString('en-US')}
            hint={signedIn ? `${DAILY_ALLOWANCE} free every day` : 'Free credits, no account needed'}
            accent="var(--a-blue)"
          />
        ) : (
          <StatCard
            icon={HardDrive}
            label="Storage used"
            value={storage ? formatBytes(storage.usage) : '—'}
            hint={storage ? `of ${formatBytes(storage.quota)} available` : 'Not reported by this browser'}
            accent="var(--a-blue)"
          />
        )}
      </div>

      <div className="dash-grid">
        {/* -------------------------------------------------------- recent */}
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">Recent activity</span>
            <Link to="/tools" className="btn btn-sm btn-quiet">
              New job
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>

          {records === null ? (
            <div style={{ padding: 18, display: 'grid', gap: 12 }}>
              <SkeletonBlock height={46} />
              <SkeletonBlock height={46} />
              <SkeletonBlock height={46} />
            </div>
          ) : records.length === 0 ? (
            <EmptyState
              icon={FileAudio}
              title="No activity yet"
              body="Run any tool and it will show up here."
              action={
                <Link to="/tools" className="btn btn-primary">
                  Open a tool
                </Link>
              }
            />
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {records.map((record, index) => {
                const tool = toolById(record.toolId);
                const Icon = tool?.icon ?? Activity;
                return (
                  <li
                    key={record.id ?? index}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 16px',
                      borderTop: index === 0 ? 0 : '1px solid var(--border)',
                    }}
                  >
                    <span
                      style={{
                        width: 36,
                        height: 36,
                        flex: 'none',
                        display: 'grid',
                        placeItems: 'center',
                        borderRadius: 11,
                        background: `color-mix(in srgb, ${tool?.accent ?? 'var(--brand)'} 12%, transparent)`,
                        color: tool?.accent ?? 'var(--brand)',
                      }}
                    >
                      <Icon size={16} aria-hidden="true" />
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{record.toolName}</div>
                      <div
                        className="mono"
                        style={{
                          fontSize: 11,
                          color: 'var(--text-dim)',
                          marginTop: 2,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={record.fileName}
                      >
                        {record.fileName} · {formatTime(record.duration)} · {record.outputs} file
                        {record.outputs > 1 ? 's' : ''}
                      </div>
                    </div>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', flex: 'none' }}>
                      {relativeTime(record.at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* ----------------------------------------------------------- side */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">Favourite tools</span>
            </div>
            <div style={{ padding: 14, display: 'grid', gap: 8 }}>
              {favouriteTools.length === 0 ? (
                <p style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55, padding: '4px 2px' }}>
                  Star a tool below to pin it here.
                </p>
              ) : (
                favouriteTools.map((tool) => {
                  const Icon = tool.icon;
                  return (
                    <Link
                      key={tool.id}
                      to={tool.path as string}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 'var(--r-sm)', minHeight: 44 }}
                      className="menu-item"
                    >
                      <Icon size={16} style={{ color: tool.accent, flex: 'none' }} aria-hidden="true" />
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{tool.name}</span>
                    </Link>
                  );
                })
              )}

              <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />

              {TOOLS.filter((tool) => tool.path).map((tool) => {
                const active = favourites.includes(tool.id);
                return (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => setFavourites(toggleFavourite(tool.id))}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 10px',
                      minHeight: 40,
                      borderRadius: 'var(--r-sm)',
                      border: 0,
                      background: 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                    aria-pressed={active}
                  >
                    <Star
                      size={15}
                      aria-hidden="true"
                      style={{ color: active ? 'var(--warn)' : 'var(--text-dim)', fill: active ? 'var(--warn)' : 'none', flex: 'none' }}
                    />
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{tool.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {suggested.length > 0 && (
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">Most used</span>
              </div>
              <div style={{ padding: 14, display: 'grid', gap: 10 }}>
                {suggested.map((entry) => {
                  const tool = toolById(entry.toolId);
                  const max = suggested[0].count || 1;
                  return (
                    <div key={entry.toolId}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 5 }}>
                        <span style={{ fontWeight: 600 }}>{entry.toolName}</span>
                        <span className="mono" style={{ color: 'var(--text-dim)' }}>
                          {entry.count}
                        </span>
                      </div>
                      <div className="bar">
                        <i style={{ width: `${(entry.count / max) * 100}%`, background: tool?.accent ?? 'var(--brand)' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="card card-pad" style={{ background: 'var(--brand-soft)', borderColor: 'var(--border-brand)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Zap size={16} style={{ color: 'var(--brand)' }} aria-hidden="true" />
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--brand)' }}>
                {signedIn ? 'Top up your credits' : 'Sign in for more credits'}
              </span>
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 14 }}>
              {signedIn
                ? 'A plan adds credits for the AI separation tools. Everything else stays free.'
                : `Signing in with Gmail gives you ${DAILY_ALLOWANCE} free credits every day.`}
            </p>
            <Link to={signedIn ? '/credits' : '/signin'} className="btn btn-primary btn-sm btn-block">
              {signedIn ? 'Get credits' : 'Sign in'}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: typeof Activity;
  label: string;
  value: string | null;
  hint: string;
  accent: string;
}) {
  return (
    <div className="card card-pad">
      <span
        style={{
          width: 38,
          height: 38,
          display: 'grid',
          placeItems: 'center',
          borderRadius: 11,
          background: `color-mix(in srgb, ${accent} 12%, transparent)`,
          color: accent,
          marginBottom: 14,
        }}
      >
        <Icon size={17} aria-hidden="true" />
      </span>
      <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{label}</div>
      {value === null ? (
        <div style={{ marginTop: 6 }}>
          <SkeletonBlock height={26} width="52%" />
        </div>
      ) : (
        <div className="mono" style={{ fontSize: 23, fontWeight: 700, letterSpacing: '-0.03em', marginTop: 3 }}>
          {value}
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>{hint}</div>
    </div>
  );
}

function relativeTime(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
