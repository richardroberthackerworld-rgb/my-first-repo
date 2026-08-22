import { useEffect, useRef, useState } from 'react';
import { Music2, Pause, Play, RotateCcw, SkipBack, SlidersHorizontal } from 'lucide-react';
import { ToolShell } from '@/components/ToolShell';
import { UploadZone } from '@/components/UploadZone';
import { Waveform } from '@/components/Waveform';
import { ExportCard } from '@/components/ExportCard';
import { ResultList } from '@/components/ResultCard';
import { ErrorState, InlineNotice, ProcessingState } from '@/components/ui/States';
import { ChoiceCards, Slider } from '@/components/ui/Controls';
import { useToast } from '@/components/ui/Toast';
import { useAudioFiles, useProcessing } from '@/hooks/useAudioFiles';
import { useRunLog } from '@/hooks/useRunLog';
import { useLivePitch, semitonesToRatio } from '@/hooks/useLivePitch';
import { DEFAULT_EXPORT, formatBytes, formatTime, revokeResults, shiftPitch } from '@/services/audio';
import type { StretchQuality } from '@/services/audio/dsp';
import type { AudioResult, ExportSettings } from '@/types/audio';
import { toolById } from '@/config/tools';

const TOOL = toolById('pitch-shifter')!;

const PRESETS = [
  { id: 'lower', label: 'Lower', hint: '−2 semitones', semitones: -2 },
  { id: 'higher', label: 'Higher', hint: '+2 semitones', semitones: 2 },
  { id: 'chipmunk', label: 'Chipmunk', hint: '+6 semitones', semitones: 6 },
  { id: 'deep', label: 'Deep Voice', hint: '−6 semitones', semitones: -6 },
];

export default function PitchShifter() {
  const files = useAudioFiles();
  const job = useProcessing();
  const toast = useToast();
  const logRun = useRunLog(TOOL);

  const file = files.first;
  const buffer = file?.buffer ?? null;
  const duration = buffer?.duration ?? 0;
  const url = file ? files.urls[file.meta.id] : null;

  const [semitones, setSemitones] = useState(0);
  const [tempo, setTempo] = useState(1);
  const [quality, setQuality] = useState<StretchQuality>('balanced');
  const [settings, setSettings] = useState<ExportSettings>({ ...DEFAULT_EXPORT, format: 'mp3', quality: 320 });
  const [result, setResult] = useState<AudioResult | null>(null);

  const preview = useLivePitch(url ?? null);
  const semitonesRef = useRef(semitones);

  // Push every pitch change straight into the running preview.
  useEffect(() => {
    semitonesRef.current = semitones;
    preview.setRatio(semitonesToRatio(semitones));
  }, [semitones, preview]);

  useEffect(() => {
    setSemitones(0);
    setTempo(1);
    setResult(null);
  }, [file?.meta.id]);

  const outputDuration = duration / tempo;
  const activePreset = PRESETS.find((preset) => preset.semitones === semitones)?.id ?? 'custom';

  const run = async () => {
    if (!buffer) return;
    if (result) revokeResults([result]);
    setResult(null);

    const produced = await job.run((report) => shiftPitch(buffer, { semitones, tempo, quality }, settings, report));
    if (produced) {
      setResult(produced);
      logRun(file?.meta.name ?? 'audio', outputDuration, [produced]);
      toast.success('Processing complete.');
    }
  };

  const reset = () => {
    if (result) revokeResults([result]);
    setResult(null);
    setSemitones(0);
    setTempo(1);
    job.reset();
  };

  return (
    <ToolShell
      tool={TOOL}
      howItWorks={[
        { title: 'Choose your audio', body: 'Pick a file and it appears as a waveform.' },
        { title: 'Move the pitch control', body: 'Press play and drag — you hear the new pitch straight away.' },
        { title: 'The length stays the same', body: 'Pitch and tempo are separate controls, so one does not drag the other along.' },
        { title: 'Download', body: 'The exported file is rendered at higher quality than the live preview.' },
      ]}
    >
      {!file ? (
        <UploadZone onFiles={files.addFiles} title="Choose the audio you want to shift" />
      ) : file.status === 'error' ? (
        <div className="panel">
          <ErrorState
            body="Something went wrong while reading this audio. Please try another file."
            onRetry={files.clear}
            retryLabel="Choose another file"
          />
        </div>
      ) : (
        <div className="tool-columns">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
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
                  <Music2 size={18} aria-hidden="true" />
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
                <button type="button" className="btn btn-sm btn-secondary" onClick={files.clear}>
                  <RotateCcw size={14} aria-hidden="true" />
                  <span className="hide-narrow">Replace File</span>
                </button>
              </div>
            </div>

            {/* ------------------------------------------------ live preview */}
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">Preview</span>
                <span className="badge badge-ai">
                  {semitones > 0 ? '+' : ''}
                  {semitones} semitones
                </span>
              </div>
              <div className="panel-body">
                <Waveform peaks={file.peaks} duration={duration} currentTime={preview.time} onSeek={preview.seek} height={140} />

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="icon-btn icon-btn-sm"
                    onClick={() => preview.seek(0)}
                    aria-label="Jump to start"
                  >
                    <SkipBack size={15} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ width: 48, height: 48, minHeight: 48, padding: 0, borderRadius: '50%' }}
                    onClick={() => preview.toggle(semitonesToRatio(semitonesRef.current))}
                    aria-label={preview.playing ? 'Pause preview' : 'Play preview'}
                  >
                    {preview.playing ? (
                      <Pause size={19} aria-hidden="true" />
                    ) : (
                      <Play size={19} aria-hidden="true" style={{ marginLeft: 2 }} />
                    )}
                  </button>
                  <span className="mono" style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                    {formatTime(preview.time)} / {formatTime(duration)}
                  </span>
                </div>

                <p style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center', marginTop: 12, lineHeight: 1.5 }}>
                  {preview.supported
                    ? 'Press play and move the pitch control — you will hear the change as you drag.'
                    : 'Live preview is not available in this browser. Use the button below to render the result.'}
                </p>
              </div>
            </div>

            {/* ----------------------------------------------- pitch control */}
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">Pitch Shift</span>
                <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand)' }}>
                  {semitones > 0 ? '+' : ''}
                  {semitones.toFixed(1)}
                </span>
              </div>
              <div className="panel-body" style={{ display: 'grid', gap: 18 }}>
                <Slider
                  value={semitones}
                  min={-12}
                  max={12}
                  step={0.5}
                  onChange={setSemitones}
                  label="Semitones"
                  format={(value) => `${value > 0 ? '+' : ''}${value}`}
                  ticks={[-12, -9, -6, -3, 0, 3, 6, 9, 12]}
                />

                <div className="pitch-stats">
                  <Stat label="Pitch" value={`${semitonesToRatio(semitones).toFixed(3)}×`} />
                  <Stat label="Speed" value={`${tempo.toFixed(2)}×`} />
                  <Stat label="Output length" value={formatTime(outputDuration)} />
                </div>

                <Slider
                  label="Speed (Tempo)"
                  value={tempo}
                  min={0.5}
                  max={2}
                  step={0.01}
                  onChange={setTempo}
                  format={(value) => `${value.toFixed(2)}×`}
                />

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => setSemitones(0)}>
                    Reset pitch
                  </button>
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => setTempo(1)}>
                    Reset tempo
                  </button>
                </div>

                {tempo !== 1 && (
                  <InlineNotice kind="info">
                    The live preview follows the pitch control. Tempo is applied when you render the download.
                  </InlineNotice>
                )}
              </div>
            </div>

            {/* -------------------------------------------- advanced options */}
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">
                  <SlidersHorizontal size={14} aria-hidden="true" style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }} />
                  Advanced Options
                </span>
              </div>
              <div className="panel-body">
                <span className="field-label">Export quality</span>
                <ChoiceCards<StretchQuality>
                  label="Export quality"
                  value={quality}
                  onChange={setQuality}
                  options={[
                    { value: 'fast', label: 'Fast', hint: 'Quickest render' },
                    { value: 'balanced', label: 'Balanced', hint: 'Recommended' },
                    { value: 'high', label: 'High Quality', hint: 'Smoothest result' },
                  ]}
                />
              </div>
            </div>

            {job.progress && job.progress.stage !== 'done' && job.progress.stage !== 'error' && (
              <div className="panel">
                <ProcessingState progress={job.progress} />
              </div>
            )}

            {job.error && (
              <div className="panel">
                <ErrorState body="Something went wrong while processing this audio. Please try again." onRetry={run} compact />
              </div>
            )}

            {result && <ResultList results={[result]} accent={TOOL.accent} title="Result" />}
          </div>

          <div className="tool-rail">
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">Presets</span>
              </div>
              <div className="panel-body">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {PRESETS.map((preset) => {
                    const active = activePreset === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setSemitones(preset.semitones)}
                        style={{
                          textAlign: 'left',
                          padding: '12px 13px',
                          minHeight: 62,
                          borderRadius: 'var(--r)',
                          cursor: 'pointer',
                          background: active ? 'var(--brand-soft)' : 'var(--surface)',
                          border: `1.5px solid ${active ? 'var(--brand)' : 'var(--border)'}`,
                        }}
                      >
                        <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: active ? 'var(--brand)' : 'var(--text)' }}>
                          {preset.label}
                        </span>
                        <span className="mono" style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                          {preset.hint}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div
                  style={{
                    marginTop: 10,
                    padding: '12px 13px',
                    borderRadius: 'var(--r)',
                    border: `1.5px solid ${activePreset === 'custom' ? 'var(--brand)' : 'var(--border)'}`,
                    background: activePreset === 'custom' ? 'var(--brand-soft)' : 'var(--surface)',
                  }}
                >
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>Custom</span>
                  <span className="mono" style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                    {semitones > 0 ? '+' : ''}
                    {semitones} semitones · {tempo.toFixed(2)}× tempo
                  </span>
                </div>
              </div>
            </div>

            <ExportCard
              settings={settings}
              onChange={setSettings}
              duration={outputDuration}
              sourceRate={file.meta.sampleRate ?? 44100}
              sourceChannels={file.meta.channels ?? 2}
            />

            <button
              type="button"
              className="btn btn-primary btn-lg btn-block"
              onClick={run}
              disabled={job.busy || (semitones === 0 && tempo === 1)}
            >
              <Music2 size={17} aria-hidden="true" />
              {job.busy ? 'Processing…' : 'Shift Pitch'}
            </button>

            {semitones === 0 && tempo === 1 && (
              <p style={{ fontSize: 11.5, color: 'var(--text-dim)', textAlign: 'center' }}>
                Move the pitch or tempo control to enable rendering.
              </p>
            )}

            <button type="button" className="btn btn-secondary btn-block" onClick={reset} disabled={job.busy}>
              <RotateCcw size={16} aria-hidden="true" />
              Reset All
            </button>
          </div>
        </div>
      )}
    </ToolShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 'var(--r-sm)',
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{label}</div>
      <div className="mono" style={{ fontSize: 13.5, fontWeight: 600, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}
