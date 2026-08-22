import { useEffect, useState } from 'react';
import { HardDrive, Palette, Trash2 } from 'lucide-react';
import { Segmented, SettingRow, Select } from '@/components/ui/Controls';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useTheme, type ThemeChoice } from '@/hooks/useTheme';
import { formatBytes } from '@/services/audio';
import { releaseEngine, anyModelCached } from '@/services/audio';
import { clearActivity, clearModelCache, storageEstimate } from '@/services/workspace';

const DEFAULT_FORMAT_KEY = 'audiora:default-format';

export default function Settings() {
  const { choice, setChoice } = useTheme();
  const toast = useToast();

  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [modelCached, setModelCached] = useState<boolean | null>(null);
  const [confirmClear, setConfirmClear] = useState<null | 'history' | 'model'>(null);
  const [defaultFormat, setDefaultFormat] = useState<string>(
    () => localStorage.getItem(DEFAULT_FORMAT_KEY) ?? 'mp3',
  );

  const refresh = () => {
    storageEstimate().then(setStorage);
    anyModelCached().then(setModelCached);
  };

  useEffect(refresh, []);

  const doClear = async () => {
    if (confirmClear === 'history') {
      await clearActivity();
      toast.success('History cleared', 'Your local activity log is empty.');
    } else if (confirmClear === 'model') {
      releaseEngine();
      const removed = await clearModelCache();
      toast.success(removed ? 'Saved data cleared' : 'Nothing to clear');
    }
    setConfirmClear(null);
    refresh();
  };

  return (
    <div className="container section" style={{ maxWidth: 720 }}>
      <header style={{ marginBottom: 26 }}>
        <h1 style={{ fontSize: 'clamp(25px, 4.6vw, 34px)' }}>Settings</h1>
        <p style={{ fontSize: 14.5, color: 'var(--text-muted)', marginTop: 8 }}>
          Preferences and saved data for 7 Audio.
        </p>
      </header>

      {/* ------------------------------------------------------ appearance */}
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-head">
          <span className="panel-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Palette size={15} aria-hidden="true" />
            Appearance
          </span>
        </div>
        <div className="panel-body">
          <SettingRow label="Theme" hint="System follows your operating system setting.">
            <Segmented<ThemeChoice>
              label="Theme"
              size="sm"
              value={choice}
              onChange={setChoice}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
                { value: 'system', label: 'System' },
              ]}
            />
          </SettingRow>
        </div>
      </div>

      {/* --------------------------------------------------------- defaults */}
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-head">
          <span className="panel-title">Defaults</span>
        </div>
        <div className="panel-body" style={{ display: 'grid', gap: 14 }}>
          <Select<string>
            label="Preferred export format"
            value={defaultFormat}
            onChange={(value) => {
              setDefaultFormat(value);
              localStorage.setItem(DEFAULT_FORMAT_KEY, value);
              toast.info('Saved', `New jobs will start on ${value.toUpperCase()}.`);
            }}
            options={[
              { value: 'mp3', label: 'MP3 — smaller files' },
              { value: 'wav', label: 'WAV — lossless' },
            ]}
            hint="Applies to tools you open from now on."
          />
        </div>
      </div>

      {/* ---------------------------------------------------------- storage */}
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-head">
          <span className="panel-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <HardDrive size={15} aria-hidden="true" />
            Storage
          </span>
          {storage && (
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
              {formatBytes(storage.usage)} used
            </span>
          )}
        </div>
        <div className="panel-body" style={{ display: 'grid', gap: 4 }}>
          {storage && storage.quota > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div className="bar">
                <i style={{ width: `${Math.min(100, (storage.usage / storage.quota) * 100)}%` }} />
              </div>
              <p className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
                {formatBytes(storage.usage)} of {formatBytes(storage.quota)} used
              </p>
            </div>
          )}

          <SettingRow label="Activity history" hint="The list of jobs shown on your dashboard.">
            <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmClear('history')}>
              <Trash2 size={14} aria-hidden="true" />
              Clear
            </button>
          </SettingRow>

          <SettingRow
            label="Saved setup data"
            hint={
              modelCached === true
                ? 'Keeps the AI tools starting instantly.'
                : 'Nothing saved yet.'
            }
          >
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => setConfirmClear('model')}
              disabled={modelCached !== true}
            >
              <Trash2 size={14} aria-hidden="true" />
              Remove
            </button>
          </SettingRow>
        </div>
      </div>

      <Modal
        open={confirmClear !== null}
        onClose={() => setConfirmClear(null)}
        title={confirmClear === 'model' ? 'Clear saved setup data?' : 'Clear your activity history?'}
        description={
          confirmClear === 'model'
            ? 'The AI tools will need to set themselves up again next time, which takes a little longer.'
            : 'This deletes the record of jobs you have run. Your audio files are not affected.'
        }
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirmClear(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={doClear} data-autofocus>
              {confirmClear === 'model' ? 'Clear data' : 'Clear history'}
            </button>
          </>
        }
      />
    </div>
  );
}
