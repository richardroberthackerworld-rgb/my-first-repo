import { useCallback, useEffect, useMemo, useState } from 'react';
import { Minus, Package, Plus, RotateCcw, Scissors, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { ToolShell } from '@/components/ToolShell';
import { UploadZone } from '@/components/UploadZone';
import { Waveform } from '@/components/Waveform';
import { Transport, useAudioElement } from '@/components/AudioPlayer';
import { ExportCard } from '@/components/ExportCard';
import { ResultList } from '@/components/ResultCard';
import { EmptyState, ErrorState, InlineNotice, ProcessingState } from '@/components/ui/States';
import { Select, SettingRow, Toggle } from '@/components/ui/Controls';
import { useToast } from '@/components/ui/Toast';
import { useAudioFiles, useProcessing } from '@/hooks/useAudioFiles';
import { useRunLog } from '@/hooks/useRunLog';
import {
  DEFAULT_EXPORT,
  exportCuts,
  formatBytes,
  formatTime,
  formatTimePrecise,
  nextId,
  parseTime,
  revokeResults,
} from '@/services/audio';
import type { AudioResult, CutSegment, ExportSettings } from '@/types/audio';
import { toolById } from '@/config/tools';

const TOOL = toolById('audio-cutter')!;

const SNAP_OPTIONS = [
  { value: 0.1, label: '0.1 sec' },
  { value: 0.5, label: '0.5 sec' },
  { value: 1, label: '1 sec' },
  { value: 5, label: '5 sec' },
];

export default function AudioCutter() {
  const files = useAudioFiles();
  const job = useProcessing();
  const toast = useToast();
  const logRun = useRunLog(TOOL);

  const file = files.first;
  const buffer = file?.buffer ?? null;
  const duration = buffer?.duration ?? 0;
  const url = file ? files.urls[file.meta.id] : null;

  const player = useAudioElement(url ?? null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [segments, setSegments] = useState<CutSegment[]>([]);
  const [zoom, setZoom] = useState(1);
  const [snapOn, setSnapOn] = useState(false);
  const [snapStep, setSnapStep] = useState(0.1);
  const [settings, setSettings] = useState<ExportSettings>({ ...DEFAULT_EXPORT, format: 'mp3', quality: 320 });
  const [results, setResults] = useState<AudioResult[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Default to the middle half of the track, so there is something to preview.
  useEffect(() => {
    if (duration > 0) {
      setSelection({ start: duration * 0.2, end: duration * 0.6 });
      setSegments([]);
      setSelectedIds([]);
    }
  }, [duration]);

  const selectionLength = selection ? selection.end - selection.start : 0;

  const clampSelection = useCallback(
    (next: { start: number; end: number }) => {
      const start = Math.max(0, Math.min(next.start, duration));
      const end = Math.max(start + 0.05, Math.min(next.end, duration));
      setSelection({ start, end });
    },
    [duration],
  );

  const addCut = () => {
    if (!selection || selectionLength <= 0.05) return;
    const segment: CutSegment = { id: nextId('seg'), start: selection.start, end: selection.end };
    setSegments((current) => [...current, segment].sort((a, b) => a.start - b.start));
    setSelectedIds((current) => [...current, segment.id]);
    toast.success('Cut added', `${formatTimePrecise(segment.start)} – ${formatTimePrecise(segment.end)}`);
  };

  const removeSegment = (id: string) => {
    setSegments((current) => current.filter((segment) => segment.id !== id));
    setSelectedIds((current) => current.filter((sid) => sid !== id));
  };

  const runExport = async (list: CutSegment[], label: string) => {
    if (!buffer || list.length === 0) return;
    revokeResults(results);
    setResults([]);
    const produced = await job.run((report) => exportCuts(buffer, list, settings, report));
    if (produced) {
      setResults(produced);
      logRun(
        file?.meta.name ?? 'audio',
        list.reduce((sum, segment) => sum + (segment.end - segment.start), 0),
        produced,
      );
      toast.success(label, `${produced.length} file${produced.length > 1 ? 's' : ''} ready to download.`);
    }
  };

  const totalCutDuration = useMemo(
    () => segments.reduce((sum, segment) => sum + (segment.end - segment.start), 0),
    [segments],
  );

  const selectedSegments = segments.filter((segment) => selectedIds.includes(segment.id));

  const reset = () => {
    revokeResults(results);
    setResults([]);
    setSegments([]);
    setSelectedIds([]);
    setZoom(1);
    job.reset();
    if (duration > 0) setSelection({ start: duration * 0.2, end: duration * 0.6 });
  };

  return (
    <ToolShell
      tool={TOOL}
      howItWorks={[
        { title: 'Load a file', body: 'Your audio appears as a waveform you can drag across.' },
        { title: 'Mark a range', body: 'Drag across the waveform, or type exact start and end times.' },
        { title: 'Add as many cuts as you need', body: 'Each one is listed with its own preview and delete control.' },
        { title: 'Export', body: 'Save one cut, the selected ones, or all of them as a single zip.' },
      ]}
    >
      {!file ? (
        <UploadZone onFiles={files.addFiles} title="Choose the audio you want to cut" />
      ) : file.status === 'error' ? (
        <div className="panel">
          <ErrorState body="Something went wrong while reading this audio. Please try another file." onRetry={files.clear} retryLabel="Choose another file" />
        </div>
      ) : (
        <div className="tool-columns">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            {/* ------------------------------------------------- file bar */}
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
                  <Scissors size={18} aria-hidden="true" />
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    title={file.meta.name}
                  >
                    {file.meta.name}
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                    {formatTime(duration)} · {formatBytes(file.meta.size)} · {file.meta.format} · {file.meta.sampleRate} Hz
                  </div>
                </div>
                <button type="button" className="btn btn-sm btn-secondary" onClick={files.clear}>
                  <RotateCcw size={14} aria-hidden="true" />
                  <span className="hide-narrow">Replace File</span>
                </button>
              </div>
            </div>

            {/* ------------------------------------------------- waveform */}
            <div className="panel">
              <div className="panel-body">
                <Waveform
                  peaks={file.peaks}
                  duration={duration}
                  currentTime={player.time}
                  selection={selection}
                  onSelectionChange={clampSelection}
                  onSeek={player.seek}
                  regions={segments.map((segment) => ({ id: segment.id, start: segment.start, end: segment.end }))}
                  zoom={zoom}
                  snap={snapOn ? snapStep : 0}
                  height={168}
                />

                <div style={{ marginTop: 16 }}>
                  <Transport
                    playing={player.playing}
                    onToggle={player.toggle}
                    onSkipStart={() => player.seek(selection?.start ?? 0)}
                    onSkipEnd={() => player.seek(selection?.end ?? duration)}
                    time={player.time}
                    duration={duration}
                  >
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="icon-btn icon-btn-sm"
                        onClick={() => setZoom((z) => Math.max(1, z - 1))}
                        disabled={zoom <= 1}
                        aria-label="Zoom out"
                      >
                        <ZoomOut size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn-sm"
                        onClick={() => setZoom((z) => Math.min(8, z + 1))}
                        disabled={zoom >= 8}
                        aria-label="Zoom in"
                      >
                        <ZoomIn size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </Transport>
                </div>
              </div>

              {/* --------------------------------------- range controls */}
              <div style={{ borderTop: '1px solid var(--border)', padding: 16, display: 'grid', gap: 14 }}>
                <div className="cut-fields">
                  <TimeField
                    label="Start Time"
                    value={selection?.start ?? 0}
                    max={selection?.end ?? duration}
                    onChange={(start) => selection && clampSelection({ start, end: selection.end })}
                  />
                  <TimeField
                    label="End Time"
                    value={selection?.end ?? 0}
                    max={duration}
                    onChange={(end) => selection && clampSelection({ start: selection.start, end })}
                  />
                  <div>
                    <span className="field-label">Duration</span>
                    <div
                      className="field mono"
                      style={{ display: 'flex', alignItems: 'center', color: 'var(--brand)', fontWeight: 600 }}
                    >
                      {formatTimePrecise(selectionLength)}
                    </div>
                  </div>
                  <div>
                    <span className="field-label">Snap to Grid</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Toggle checked={snapOn} onChange={setSnapOn} label="Snap to grid" />
                      <Select<number>
                        value={snapStep}
                        onChange={setSnapStep}
                        options={SNAP_OPTIONS}
                        disabled={!snapOn}
                      />
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={addCut} disabled={selectionLength <= 0.05}>
                    <Plus size={15} aria-hidden="true" />
                    Add Cut
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={() => duration > 0 && setSelection({ start: 0, end: duration })}
                  >
                    <X size={15} aria-hidden="true" />
                    Select All
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => selection && runExport([{ id: 'one', ...selection }], 'Cut exported')}
                    disabled={selectionLength <= 0.05 || job.busy}
                  >
                    <Scissors size={15} aria-hidden="true" />
                    Cut Selected Part
                  </button>
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
                <ErrorState body="Something went wrong while processing this audio. Please try again." compact />
              </div>
            )}

            <ResultList results={results} accent={TOOL.accent} zipName="7audio-cuts" title="Exported cuts" />
          </div>

          {/* ------------------------------------------------------- rail */}
          <div className="tool-rail">
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">
                  Cut Segments <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}>({segments.length})</span>
                </span>
                {segments.length > 0 && (
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                    {formatTime(totalCutDuration)}
                  </span>
                )}
              </div>

              {segments.length === 0 ? (
                <EmptyState
                  icon={Scissors}
                  title="No cuts yet"
                  body="Drag across the waveform to mark a range, then choose Add Cut."
                  compact
                />
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {segments.map((segment, index) => {
                    const checked = selectedIds.includes(segment.id);
                    return (
                      <li
                        key={segment.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '11px 14px',
                          borderTop: index === 0 ? 0 : '1px solid var(--border)',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) =>
                            setSelectedIds((current) =>
                              event.target.checked ? [...current, segment.id] : current.filter((id) => id !== segment.id),
                            )
                          }
                          aria-label={`Include cut ${index + 1} in the selected export`}
                          style={{ width: 16, height: 16, accentColor: 'var(--brand)', flex: 'none' }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setSelection({ start: segment.start, end: segment.end });
                            player.seek(segment.start);
                          }}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            textAlign: 'left',
                            background: 'none',
                            border: 0,
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        >
                          <span className="mono" style={{ display: 'block', fontSize: 12, fontWeight: 600 }}>
                            {formatTimePrecise(segment.start)} – {formatTimePrecise(segment.end)}
                          </span>
                          <span className="mono" style={{ display: 'block', fontSize: 10.5, color: 'var(--text-dim)' }}>
                            {formatTimePrecise(segment.end - segment.start)}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="icon-btn icon-btn-sm"
                          onClick={() => removeSegment(segment.id)}
                          aria-label={`Delete cut ${index + 1}`}
                          style={{ color: 'var(--err)' }}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {segments.length > 0 && (
                <div style={{ borderTop: '1px solid var(--border)', padding: 12 }}>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm btn-block"
                    onClick={() => {
                      setSegments([]);
                      setSelectedIds([]);
                    }}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    Clear All
                  </button>
                </div>
              )}
            </div>

            <ExportCard
              settings={settings}
              onChange={setSettings}
              showFades
              duration={selectionLength}
              sourceRate={file.meta.sampleRate ?? 44100}
              sourceChannels={file.meta.channels ?? 2}
            >
              <SettingRow label="Crossfade between cuts" lockedReason="Crossfade applies when joining tracks — use the Song Joiner for that.">
                <Toggle checked={false} onChange={() => {}} label="Crossfade" disabled />
              </SettingRow>
            </ExportCard>

            <button
              type="button"
              className="btn btn-primary btn-lg btn-block"
              onClick={() => runExport(segments, 'All cuts exported')}
              disabled={segments.length === 0 || job.busy}
            >
              <Package size={17} aria-hidden="true" />
              Export All Cuts ({segments.length})
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-block"
              onClick={() => runExport(selectedSegments, 'Selected cuts exported')}
              disabled={selectedSegments.length === 0 || job.busy}
            >
              Export Selected ({selectedSegments.length})
            </button>

            <button type="button" className="btn btn-quiet btn-block" onClick={reset} disabled={job.busy}>
              <RotateCcw size={15} aria-hidden="true" />
              Reset All
            </button>
          </div>
        </div>
      )}

      {files.rejected.length > 0 && (
        <InlineNotice kind="error">
          {files.rejected.map((message) => (
            <span key={message} style={{ display: 'block' }}>
              {message}
            </span>
          ))}
        </InlineNotice>
      )}
    </ToolShell>
  );
}

/** mm:ss.cc text entry with nudge buttons, kept in sync with the waveform. */
function TimeField({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(() => formatTimePrecise(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(formatTimePrecise(value));
  }, [value, focused]);

  const commit = (raw: string) => {
    const parsed = parseTime(raw);
    if (parsed === null) {
      setText(formatTimePrecise(value));
      return;
    }
    onChange(Math.max(0, Math.min(parsed, max)));
  };

  return (
    <div>
      <span className="field-label">{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          type="button"
          className="icon-btn icon-btn-sm"
          onClick={() => onChange(Math.max(0, value - 0.1))}
          aria-label={`Decrease ${label}`}
        >
          <Minus size={14} aria-hidden="true" />
        </button>
        <input
          className="field mono"
          style={{ textAlign: 'center', minWidth: 0 }}
          value={text}
          aria-label={label}
          onFocus={() => setFocused(true)}
          onChange={(event) => setText(event.target.value)}
          onBlur={(event) => {
            setFocused(false);
            commit(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          }}
        />
        <button
          type="button"
          className="icon-btn icon-btn-sm"
          onClick={() => onChange(Math.min(max, value + 0.1))}
          aria-label={`Increase ${label}`}
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
