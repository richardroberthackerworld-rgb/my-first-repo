import { useState } from 'react';
import { AudioLines, RotateCcw } from 'lucide-react';
import { ToolShell } from '@/components/ToolShell';
import { UploadZone } from '@/components/UploadZone';
import { Waveform } from '@/components/Waveform';
import { AudioPlayer } from '@/components/AudioPlayer';
import { ExportCard } from '@/components/ExportCard';
import { ResultList } from '@/components/ResultCard';
import { EmptyState, ErrorState, ProcessingState } from '@/components/ui/States';
import { ChoiceCards, Segmented } from '@/components/ui/Controls';
import { useToast } from '@/components/ui/Toast';
import { useAudioFiles, useProcessing } from '@/hooks/useAudioFiles';
import { useRunLog } from '@/hooks/useRunLog';
import { useCreditedRun } from '@/hooks/useCreditedRun';
import { CreditBar, OutOfCreditsModal } from '@/components/CreditGate';
import {
  DEFAULT_EXPORT,
  MODELS,
  STEM_LABELS,
  encodeStems,
  formatBytes,
  formatTime,
  orderedStems,
  revokeResults,
  separateAudio,
  separationCapability,
  type SeparatedSession,
  type SeparationModel,
} from '@/services/audio';
import type { AudioFormat, AudioResult, ExportSettings, StemName } from '@/types/audio';
import { toolById } from '@/config/tools';

const TOOL = toolById('stem-splitter')!;

const STEM_ACCENTS: Record<StemName, string> = {
  vocals: 'var(--a-violet)',
  drums: 'var(--a-pink)',
  bass: 'var(--a-green)',
  guitar: 'var(--a-orange)',
  piano: 'var(--a-blue)',
  other: 'var(--a-teal)',
};

export default function StemSplitter() {
  const files = useAudioFiles();
  const job = useProcessing();
  const toast = useToast();
  const logRun = useRunLog(TOOL);
  const credited = useCreditedRun('stem-splitter');

  const file = files.first;
  const buffer = file?.buffer ?? null;
  const duration = buffer?.duration ?? 0;
  const url = file ? files.urls[file.meta.id] : null;

  const [model, setModel] = useState<SeparationModel>('standard');
  const [settings, setSettings] = useState<ExportSettings>({ ...DEFAULT_EXPORT, format: 'wav' });
  const [session, setSession] = useState<SeparatedSession | null>(null);
  const [stems, setStems] = useState<AudioResult[]>([]);
  /** Format the current results were encoded in, so we know when they are stale. */
  const [encodedAs, setEncodedAs] = useState<AudioFormat | null>(null);

  const capability = separationCapability();

  const run = async () => {
    if (!buffer) return;
    revokeResults(stems);
    setStems([]);
    setSession(null);
    setEncodedAs(null);

    const produced = await credited.run(duration, () =>
      job.run(async (report) => {
        const separated = await separateAudio(buffer, { model, mode: 'stems' }, report);
        const encoded = await encodeStems(separated, settings, report);
        return { separated, encoded };
      }),
    );

    if (produced) {
      setSession(produced.separated);
      setStems(produced.encoded);
      setEncodedAs(settings.format);
      logRun(file?.meta.name ?? 'audio', duration, produced.encoded);
      toast.success('Processing complete.', `${produced.encoded.length} stems ready.`);
    }
  };

  /** Re-encode from the stems already separated in this session. */
  const reExport = async () => {
    if (!session) return;
    revokeResults(stems);
    setStems([]);

    const produced = await job.run((report) => encodeStems(session, settings, report));
    if (produced) {
      setStems(produced);
      setEncodedAs(settings.format);
      toast.success('Processing complete.', `Stems re-exported as ${settings.format.toUpperCase()}.`);
    }
  };

  const reset = () => {
    revokeResults(stems);
    setStems([]);
    setSession(null);
    setEncodedAs(null);
    files.clear();
    job.reset();
  };

  const available = session ? orderedStems(session) : MODELS[model].stems;
  const stale = !!session && encodedAs !== null && encodedAs !== settings.format;

  return (
    <ToolShell
      tool={TOOL}
      trust={[
        { title: 'Studio-grade AI', body: 'Up to six separate stems' },
        { title: 'Preview each stem', body: 'Play before you download' },
        { title: 'Lossless option', body: '24-bit WAV export' },
        { title: 'Batch download', body: 'All stems as one zip' },
      ]}
      howItWorks={[
        { title: 'Choose your audio', body: 'Pick a track from your device.' },
        { title: 'Pick a quality', body: 'Standard gives four stems. High quality adds guitar and piano.' },
        { title: 'Process', body: 'The first run takes a little longer to get set up.' },
        { title: 'Preview and download', body: 'Play each stem, then save them individually or all at once.' },
      ]}
    >
      <div className="tool-columns">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {!file ? (
            <UploadZone onFiles={files.addFiles} title="Choose your audio file" buttonLabel="Choose File" />
          ) : file.status === 'error' ? (
            <div className="panel">
              <ErrorState
                body="Something went wrong while reading this audio. Please try another file."
                onRetry={files.clear}
                retryLabel="Choose another file"
              />
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
                    <AudioLines size={18} aria-hidden="true" />
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
                  <div style={{ marginTop: 12 }}>
                    <AudioPlayer src={url} duration={duration} label="original track" />
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

          {stems.length > 0 ? (
            <ResultList results={stems} zipName="7audio-stems" title="Stems" accent={STEM_ACCENTS.vocals} />
          ) : (
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">Stems</span>
              </div>
              <EmptyState
                icon={AudioLines}
                title="No stems yet"
                body={file ? 'Choose a quality and format, then start processing.' : 'Choose a track to split it into separate stems.'}
                compact
              />
            </div>
          )}
        </div>

        <div className="tool-rail">
          <CreditBar toolId="stem-splitter" durationSeconds={duration} />
          {/* -------------------------------------------------- separation */}
          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">Separation Settings</span>
            </div>
            <div className="panel-body" style={{ display: 'grid', gap: 16 }}>
              <div>
                <span className="field-label">Quality</span>
                <ChoiceCards<SeparationModel>
                  label="Separation quality"
                  value={model}
                  onChange={(next) => {
                    setModel(next);
                    setSession(null);
                  }}
                  columns={2}
                  options={[
                    { value: 'standard', label: MODELS.standard.label, hint: MODELS.standard.hint },
                    {
                      value: 'high',
                      label: MODELS.high.label,
                      hint: 'Adds guitar and piano. Much longer one-time setup, and needs a capable computer.',
                      badge: 'BEST',
                    },
                  ]}
                />
              </div>

              <div>
                <span className="field-label">Format</span>
                <Segmented<AudioFormat>
                  label="Output format"
                  value={settings.format === 'wav' || settings.format === 'mp3' ? settings.format : 'wav'}
                  onChange={(format) =>
                    setSettings((s) => ({ ...s, format, quality: format === 'mp3' ? 320 : s.quality }))
                  }
                  options={[
                    { value: 'wav', label: 'WAV' },
                    { value: 'mp3', label: 'MP3' },
                  ]}
                />
                <p style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.5 }}>
                  More formats are available in Export Settings below.
                </p>
              </div>

              <div>
                <span className="field-label">You will get</span>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                  {available.map((name) => (
                    <li key={name} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5 }}>
                      <span
                        style={{ width: 8, height: 8, borderRadius: '50%', background: STEM_ACCENTS[name], flex: 'none' }}
                        aria-hidden="true"
                      />
                      {STEM_LABELS[name]}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <ExportCard
            settings={settings}
            onChange={setSettings}
            title="Export Settings"
            duration={duration}
            sourceRate={44100}
            sourceChannels={2}
          />

          {stale ? (
            <button type="button" className="btn btn-primary btn-lg btn-block" onClick={reExport} disabled={job.busy}>
              <AudioLines size={17} aria-hidden="true" />
              {job.busy ? 'Processing…' : `Export as ${settings.format.toUpperCase()}`}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-lg btn-block"
              onClick={run}
              disabled={!buffer || job.busy || !capability.available}
            >
              <AudioLines size={17} aria-hidden="true" />
              {job.busy ? 'Processing…' : 'Split Into Stems'}
            </button>
          )}

          {file && (
            <button type="button" className="btn btn-secondary btn-block" onClick={reset} disabled={job.busy}>
              <RotateCcw size={16} aria-hidden="true" />
              Start Over
            </button>
          )}
        </div>
      </div>
      <OutOfCreditsModal open={credited.gateOpen} onClose={credited.closeGate} message={credited.blocked} />
    </ToolShell>
  );
}
