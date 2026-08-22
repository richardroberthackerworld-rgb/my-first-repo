import { Info } from 'lucide-react';
import type { AudioFormat, ChannelsOption, ExportSettings, SampleRateOption } from '@/types/audio';
import { FORMATS, encoderCapability, formatBytes, formatTime, needsTranscoder } from '@/services/audio';
import { Select, SettingRow, Slider, Toggle } from './ui/Controls';
import { InlineNotice } from './ui/States';

const FORMAT_ORDER: AudioFormat[] = ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac'];

const SAMPLE_RATES: { value: SampleRateOption; label: string }[] = [
  { value: 'source', label: 'Same as source' },
  { value: 48000, label: '48 kHz' },
  { value: 44100, label: '44.1 kHz' },
  { value: 32000, label: '32 kHz' },
  { value: 22050, label: '22.05 kHz' },
];

const CHANNELS: { value: ChannelsOption; label: string }[] = [
  { value: 'source', label: 'Same as source' },
  { value: 2, label: 'Stereo' },
  { value: 1, label: 'Mono' },
];

/** Rough output size, so the estimate panel is honest about being an estimate. */
export function estimateSize(settings: ExportSettings, duration: number, sourceRate: number, sourceChannels: number): number {
  if (duration <= 0) return 0;
  const rate = settings.sampleRate === 'source' ? sourceRate : settings.sampleRate;
  const channels = settings.channels === 'source' ? sourceChannels : settings.channels;
  if (settings.format === 'wav') return Math.round(duration * rate * channels * 3);
  return Math.round((settings.quality * 1000 * duration) / 8);
}

interface ExportCardProps {
  settings: ExportSettings;
  onChange: (settings: ExportSettings) => void;
  title?: string;
  showFades?: boolean;
  showSampleRate?: boolean;
  showChannels?: boolean;
  /** Renders the estimated-output block when a duration is known. */
  duration?: number;
  sourceRate?: number;
  sourceChannels?: number;
  children?: React.ReactNode;
}

export function ExportCard({
  settings,
  onChange,
  title = 'Export Settings',
  showFades = false,
  showSampleRate = true,
  showChannels = true,
  duration = 0,
  sourceRate = 44100,
  sourceChannels = 2,
  children,
}: ExportCardProps) {
  const info = FORMATS[settings.format];
  const set = (patch: Partial<ExportSettings>) => onChange({ ...settings, ...patch });

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">{title}</span>
      </div>

      <div className="panel-body" style={{ display: 'grid', gap: 14 }}>
        <Select<AudioFormat>
          label="Output Format"
          value={settings.format}
          onChange={(format) => {
            const next = FORMATS[format];
            const quality = next.bitrates.includes(settings.quality) ? settings.quality : (next.bitrates.at(-1) ?? 320);
            set({ format, quality });
          }}
          options={FORMAT_ORDER.map((id) => {
            const capability = encoderCapability(id);
            return {
              value: id,
              label: FORMATS[id].label,
              disabled: !capability.available,
              reason: capability.reason,
            };
          })}
        />

        {info.lossy ? (
          <Select<number>
            label="Audio Quality"
            value={settings.quality}
            onChange={(quality) => set({ quality })}
            options={info.bitrates.map((rate) => ({ value: rate, label: `${rate} kbps` }))}
          />
        ) : (
          <div>
            <span className="field-label">Audio Quality</span>
            <div
              className="field"
              style={{ display: 'flex', alignItems: 'center', color: 'var(--text-muted)', fontSize: 14 }}
            >
              24-bit lossless
            </div>
          </div>
        )}

        {showSampleRate && (
          <Select<SampleRateOption>
            label="Sample Rate"
            value={settings.sampleRate}
            onChange={(sampleRate) => set({ sampleRate })}
            options={SAMPLE_RATES}
          />
        )}

        {showChannels && (
          <Select<ChannelsOption>
            label="Channels"
            value={settings.channels}
            onChange={(channels) => set({ channels })}
            options={CHANNELS}
          />
        )}

        <div className="hairline-top">
          <SettingRow label="Normalize Audio" hint="Lift the loudest peak to −1 dBFS without clipping.">
            <Toggle checked={settings.normalize} onChange={(normalize) => set({ normalize })} label="Normalize audio" />
          </SettingRow>

          {showFades && (
            <>
              <SettingRow label="Fade In">
                <Toggle
                  checked={settings.fadeIn > 0}
                  onChange={(on) => set({ fadeIn: on ? 2 : 0 })}
                  label="Fade in"
                />
              </SettingRow>
              {settings.fadeIn > 0 && (
                <Slider
                  value={settings.fadeIn}
                  min={0.2}
                  max={10}
                  step={0.1}
                  onChange={(fadeIn) => set({ fadeIn })}
                  format={(v) => `${v.toFixed(1)} sec`}
                  label="Fade in duration"
                />
              )}

              <SettingRow label="Fade Out">
                <Toggle
                  checked={settings.fadeOut > 0}
                  onChange={(on) => set({ fadeOut: on ? 2 : 0 })}
                  label="Fade out"
                />
              </SettingRow>
              {settings.fadeOut > 0 && (
                <Slider
                  value={settings.fadeOut}
                  min={0.2}
                  max={10}
                  step={0.1}
                  onChange={(fadeOut) => set({ fadeOut })}
                  format={(v) => `${v.toFixed(1)} sec`}
                  label="Fade out duration"
                />
              )}
            </>
          )}
        </div>

        {children}

        {needsTranscoder(settings.format) && (
          <InlineNotice kind="info">
            The first {info.label} export takes a moment longer to get set up. After that it is quick.
          </InlineNotice>
        )}
      </div>

      {duration > 0 && (
        <div
          style={{
            padding: '14px 20px',
            borderTop: '1px solid var(--border)',
            background: 'var(--brand-soft)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12.5,
              fontWeight: 700,
              color: 'var(--brand)',
              marginBottom: 10,
            }}
          >
            Estimated Output
            <span title="Sizes are approximate until the file is encoded." style={{ display: 'inline-flex', cursor: 'help' }}>
              <Info size={12} aria-hidden="true" />
            </span>
          </div>
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px', margin: 0 }}>
            <Stat label="Format" value={info.label} />
            <Stat label="Quality" value={info.lossy ? `${settings.quality} kbps` : '24-bit'} />
            <Stat label="Duration" value={formatTime(duration)} />
            <Stat label="Size (estimated)" value={`~ ${formatBytes(estimateSize(settings, duration, sourceRate, sourceChannels))}`} />
          </dl>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 2 }}>{label}</dt>
      <dd className="mono" style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>
        {value}
      </dd>
    </div>
  );
}
