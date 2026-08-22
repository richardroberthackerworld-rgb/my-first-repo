import { useState } from 'react';
import { Mic, RotateCcw } from 'lucide-react';
import { ToolShell } from '@/components/ToolShell';
import { UploadZone } from '@/components/UploadZone';
import { Waveform } from '@/components/Waveform';
import { AudioPlayer } from '@/components/AudioPlayer';
import { ExportCard } from '@/components/ExportCard';
import { ResultCard } from '@/components/ResultCard';
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
  downloadAll,
  encodeVocalResult,
  formatBytes,
  formatTime,
  revokeResults,
  separateAudio,
  separationCapability,
  type SeparatedSession,
  type SeparationModel,
  type VocalResult,
} from '@/services/audio';
import type { AudioFormat, ExportSettings } from '@/types/audio';
import { toolById } from '@/config/tools';

const TOOL = toolById('vocal-remover')!;

export default function VocalRemover() {
  const files = useAudioFiles();
  const job = useProcessing();
  const toast = useToast();
  const logRun = useRunLog(TOOL);
  const credited = useCreditedRun('vocal-remover');

  const file = files.first;
  const buffer = file?.buffer ?? null;
  const duration = buffer?.duration ?? 0;
  const url = file ? files.urls[file.meta.id] : null;

  const [model, setModel] = useState<SeparationModel>('standard');
  const [settings, setSettings] = useState<ExportSettings>({ ...DEFAULT_EXPORT, format: 'mp3', quality: 320 });
  const [session, setSession] = useState<SeparatedSession | null>(null);
  const [results, setResults] = useState<VocalResult | null>(null);
  const [encodedAs, setEncodedAs] = useState<AudioFormat | null>(null);

  const capability = separationCapability();

  const run = async () => {
    if (!buffer) return;
    if (results) revokeResults([results.instrumental, results.vocals]);
    setResults(null);
    setSession(null);
    setEncodedAs(null);

    const produced = await credited.run(duration, () =>
      job.run(async (report) => {
        const separated = await separateAudio(buffer, { model, mode: 'vocals' }, report);
        const encoded = await encodeVocalResult(separated, settings, report);
        return { separated, encoded };
      }),
    );

    if (produced) {
      setSession(produced.separated);
      setResults(produced.encoded);
      setEncodedAs(settings.format);
      logRun(file?.meta.name ?? 'audio', duration, [produced.encoded.instrumental, produced.encoded.vocals]);
      toast.success('Processing complete.');
    }
  };

  /** Re-encode what was already separated, rather than separating again. */
  const reExport = async () => {
    if (!session) return;
    if (results) revokeResults([results.instrumental, results.vocals]);
    setResults(null);

    const produced = await job.run((report) => encodeVocalResult(session, settings, report));
    if (produced) {
      setResults(produced);
      setEncodedAs(settings.format);
      toast.success('Processing complete.', `Exported as ${settings.format.toUpperCase()}.`);
    }
  };

  const reset = () => {
    if (results) revokeResults([results.instrumental, results.vocals]);
    setResults(null);
    setSession(null);
    setEncodedAs(null);
    files.clear();
    job.reset();
  };

  const stale = !!session && encodedAs !== null && encodedAs !== settings.format;

  return (
    <ToolShell
      tool={TOOL}
      trust={[
        { title: 'Studio-grade AI', body: 'Clean vocal separation' },
        { title: 'Two tracks out', body: 'Instrumental and vocals' },
        { title: 'WAV or MP3', body: 'Plus FLAC, M4A, OGG, AAC' },
        { title: 'Works everywhere', body: 'Any modern browser' },
      ]}
      howItWorks={[
        { title: 'Choose your song', body: 'Pick a track from your device.' },
        { title: 'Pick a quality', body: 'High quality uses the larger model for a cleaner split.' },
        { title: 'Process', body: 'The first run takes a little longer to get set up.' },
        { title: 'Preview and download', body: 'Play both tracks, then save the ones you want.' },
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
                    <Mic size={18} aria-hidden="true" />
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
                  <Waveform peaks={file.peaks} duration={duration} height={110} showRuler={false} />
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

          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">Results</span>
              {results && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => downloadAll([results.instrumental, results.vocals], '7audio-vocal-remover')}
                >
                  Download both
                </button>
              )}
            </div>

            {results ? (
              <div style={{ padding: 14, display: 'grid', gap: 10 }}>
                <ResultCard result={results.instrumental} accent="var(--a-green)" />
                <ResultCard result={results.vocals} accent={TOOL.accent} />
              </div>
            ) : (
              <EmptyState
                icon={Mic}
                title="No results yet"
                body={file ? 'Choose a quality and format, then start processing.' : 'Choose a song to get an instrumental and a vocal track.'}
                compact
              />
            )}
          </div>
        </div>

        <div className="tool-rail">
          <CreditBar toolId="vocal-remover" durationSeconds={duration} />
          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">Processing Settings</span>
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
                    { value: 'standard', label: MODELS.standard.label, hint: 'Faster, great on most songs' },
                    {
                      value: 'high',
                      label: MODELS.high.label,
                      hint: 'Cleaner split. Much longer one-time setup, and needs a capable computer.',
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
              <Mic size={17} aria-hidden="true" />
              {job.busy ? 'Processing…' : `Export as ${settings.format.toUpperCase()}`}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-lg btn-block"
              onClick={run}
              disabled={!buffer || job.busy || !capability.available}
            >
              <Mic size={17} aria-hidden="true" />
              {job.busy ? 'Processing…' : 'Remove Vocals'}
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
