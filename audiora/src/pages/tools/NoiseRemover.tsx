import { useState } from 'react';
import { Activity, RotateCcw, Sparkles } from 'lucide-react';
import { ToolShell } from '@/components/ToolShell';
import { UploadZone } from '@/components/UploadZone';
import { Waveform } from '@/components/Waveform';
import { AudioPlayer } from '@/components/AudioPlayer';
import { ExportCard } from '@/components/ExportCard';
import { ResultCard } from '@/components/ResultCard';
import { EmptyState, ErrorState, InlineNotice, ProcessingState } from '@/components/ui/States';
import { ChoiceCards, Segmented, SettingRow, Slider, Toggle } from '@/components/ui/Controls';
import { useToast } from '@/components/ui/Toast';
import { useAudioFiles, useProcessing } from '@/hooks/useAudioFiles';
import { useRunLog } from '@/hooks/useRunLog';
import {
  DEFAULT_DENOISE,
  DEFAULT_EXPORT,
  denoiseCapability,
  formatBytes,
  formatTime,
  reduceNoise,
  revokeResults,
} from '@/services/audio';
import type { NoiseStrength, NoiseType } from '@/services/audio';
import type { AudioResult, ExportSettings } from '@/types/audio';
import { toolById } from '@/config/tools';

const TOOL = toolById('noise-remover')!;

const NOISE_TYPES: { value: NoiseType; label: string; hint: string }[] = [
  { value: 'general', label: 'General', hint: 'For everyday background noise' },
  { value: 'hiss', label: 'Hiss', hint: 'Tape hiss and high-frequency noise' },
  { value: 'hum', label: 'Hum', hint: 'Mains hum at 50/60 Hz and harmonics' },
  { value: 'wind', label: 'Wind', hint: 'Low-frequency rumble and wind' },
];

export default function NoiseRemover() {
  const files = useAudioFiles();
  const job = useProcessing();
  const toast = useToast();
  const logRun = useRunLog(TOOL);

  const file = files.first;
  const buffer = file?.buffer ?? null;
  const duration = buffer?.duration ?? 0;
  const url = file ? files.urls[file.meta.id] : null;

  const [options, setOptions] = useState({ ...DEFAULT_DENOISE });
  const [settings, setSettings] = useState<ExportSettings>({ ...DEFAULT_EXPORT, format: 'wav' });
  const [result, setResult] = useState<AudioResult | null>(null);

  const capability = denoiseCapability();
  const set = (patch: Partial<typeof options>) => setOptions((current) => ({ ...current, ...patch }));

  const run = async () => {
    if (!buffer) return;
    if (result) revokeResults([result]);
    setResult(null);

    const produced = await job.run((report) => reduceNoise(buffer, options, settings, report));
    if (produced) {
      setResult(produced);
      logRun(file?.meta.name ?? 'audio', duration, [produced]);
      toast.success('Processing complete.');
    }
  };

  const reset = () => {
    if (result) revokeResults([result]);
    setResult(null);
    files.clear();
    job.reset();
    setOptions({ ...DEFAULT_DENOISE });
  };

  return (
    <ToolShell
      tool={TOOL}
      trust={[
        { title: 'Clear results', body: 'Noise out, detail kept' },
        { title: 'Voice protected', body: 'The speech band is preserved' },
        { title: 'Lossless option', body: '24-bit WAV export' },
        { title: 'Works everywhere', body: 'Any modern browser' },
      ]}
      howItWorks={[
        { title: 'Load a recording', body: 'Choose the file you want to clean up.' },
        {
          title: 'The noise floor is measured',
          body: '7 Audio works out what the steady background noise sounds like on its own — you do not have to select a sample.',
        },
        {
          title: 'That floor is gated out',
          body: 'The background is turned down while the parts you want are left alone, then smoothed so nothing warbles.',
        },
        { title: 'Compare and download', body: 'Play the original against the cleaned version before you save it.' },
      ]}
    >
      <div className="tool-columns">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {!file ? (
            <UploadZone onFiles={files.addFiles} title="Upload your audio file" buttonLabel="Choose File" />
          ) : file.status === 'error' ? (
            <div className="panel">
              <ErrorState body="Something went wrong while reading this audio. Please try another file." onRetry={files.clear} retryLabel="Choose another file" />
            </div>
          ) : (
            <>
              <div className="panel">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }}>
                  <span
                    style={{
                      width: 40,
                      height: 40,
                      flex: 'none',
                      display: 'grid',
                      placeItems: 'center',
                      borderRadius: 12,
                      background: `color-mix(in srgb, ${TOOL.accent} 12%, transparent)`,
                      color: TOOL.accent,
                    }}
                  >
                    <Activity size={18} aria-hidden="true" />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                      title={file.meta.name}
                    >
                      {file.meta.name}
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                      {formatTime(duration)} · {formatBytes(file.meta.size)} · {file.meta.format}
                    </div>
                  </div>
                  <button type="button" className="btn btn-sm btn-secondary" onClick={files.clear} disabled={job.busy}>
                    <RotateCcw size={14} aria-hidden="true" />
                    <span className="hide-narrow">Replace File</span>
                  </button>
                </div>
                <div style={{ borderTop: '1px solid var(--border)', padding: 16 }}>
                  <Waveform peaks={file.peaks} duration={duration} height={104} showRuler={false} />
                </div>
              </div>

              {/* ------------------------------------------------- controls */}
              <div className="panel">
                <div className="panel-head">
                  <span className="panel-title">Noise Removal Controls</span>
                </div>
                <div className="panel-body" style={{ display: 'grid', gap: 20 }}>
                  <div className="denoise-grid">
                    <div>
                      <Slider
                        label="Noise Reduction"
                        value={Math.round(options.reduction * 100)}
                        min={10}
                        max={100}
                        step={1}
                        onChange={(value) => set({ reduction: value / 100 })}
                        format={(value) => `${value}%`}
                      />
                      <p style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.5 }}>
                        How far the noise floor is pulled down. Below 100% a little of the original room tone is kept,
                        which usually sounds more natural.
                      </p>
                    </div>

                    <div>
                      <span className="field-label">AI Strength</span>
                      <Segmented<NoiseStrength>
                        label="Strength"
                        value={options.strength}
                        onChange={(strength) => set({ strength })}
                        options={[
                          { value: 'light', label: 'Light' },
                          { value: 'balanced', label: 'Balanced' },
                          { value: 'strong', label: 'Strong' },
                        ]}
                      />
                      <p style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.5 }}>
                        Balanced is right for most recordings. Strong removes more, at the cost of some detail.
                      </p>
                    </div>
                  </div>

                  <div>
                    <span className="field-label">Noise Type</span>
                    <ChoiceCards<NoiseType>
                      label="Noise type"
                      value={options.noiseType}
                      onChange={(noiseType) => set({ noiseType })}
                      options={NOISE_TYPES}
                      columns={4}
                    />
                  </div>

                  <div className="hairline-top">
                    <SettingRow label="Preserve Voice" hint="Protects roughly 180 Hz – 4.2 kHz, where speech lives.">
                      <Toggle
                        checked={options.preserveVoice}
                        onChange={(preserveVoice) => set({ preserveVoice })}
                        label="Preserve voice"
                      />
                    </SettingRow>
                  </div>
                </div>
              </div>

              {job.progress && job.progress.stage !== 'done' && job.progress.stage !== 'error' && (
                <div className="panel">
                  <ProcessingState progress={job.progress} />
                </div>
              )}

              {job.error && (
                <div className="panel">
                  <ErrorState body="Something went wrong while processing this audio. Please try again." onRetry={run} />
                </div>
              )}
            </>
          )}
        </div>

        <div className="tool-rail">
          {/* -------------------------------------------------- comparison */}
          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">Preview</span>
            </div>
            {file && file.status === 'ready' ? (
              <div style={{ padding: 14, display: 'grid', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700 }}>Original</span>
                    <span className="badge badge-neutral">With noise</span>
                  </div>
                  <AudioPlayer src={url} duration={duration} compact label="original" accent="var(--err)" />
                </div>

                <div style={{ height: 1, background: 'var(--border)' }} />

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700 }}>Processed</span>
                    {result ? (
                      <span className="badge badge-free">Noise removed</span>
                    ) : (
                      <span className="badge badge-neutral">Not rendered yet</span>
                    )}
                  </div>
                  {result ? (
                    <ResultCard result={result} accent="var(--ok)" />
                  ) : (
                    <p style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                      Run Remove Noise to hear the cleaned version here.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <EmptyState icon={Sparkles} title="Nothing loaded" body="Choose a recording to get started." compact />
            )}
          </div>

          <ExportCard
            settings={settings}
            onChange={setSettings}
            title="Output Settings"
            duration={duration}
            sourceRate={file?.meta.sampleRate ?? 44100}
            sourceChannels={file?.meta.channels ?? 2}
          />

          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            onClick={run}
            disabled={!buffer || job.busy || !capability.available}
          >
            <Activity size={17} aria-hidden="true" />
            {job.busy ? 'Cleaning…' : 'Remove Noise'}
          </button>

          {!capability.available && <InlineNotice kind="error">{capability.reason}</InlineNotice>}

          {file && (
            <button type="button" className="btn btn-secondary btn-block" onClick={reset} disabled={job.busy}>
              <RotateCcw size={16} aria-hidden="true" />
              Reset All
            </button>
          )}
        </div>
      </div>
    </ToolShell>
  );
}
