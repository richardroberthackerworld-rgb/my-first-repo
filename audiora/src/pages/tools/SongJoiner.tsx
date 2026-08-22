import { useState } from 'react';
import { Link2, RotateCcw } from 'lucide-react';
import { ToolShell } from '@/components/ToolShell';
import { UploadZone } from '@/components/UploadZone';
import { AudioFileList } from '@/components/AudioFileList';
import { ExportCard } from '@/components/ExportCard';
import { ResultList } from '@/components/ResultCard';
import { ErrorState, InlineNotice, ProcessingState } from '@/components/ui/States';
import { Select, SettingRow, Slider, Toggle } from '@/components/ui/Controls';
import { useToast } from '@/components/ui/Toast';
import { useAudioFiles, useProcessing } from '@/hooks/useAudioFiles';
import { useRunLog } from '@/hooks/useRunLog';
import { DEFAULT_EXPORT, joinAudio, revokeResults } from '@/services/audio';
import type { AudioResult, ExportSettings } from '@/types/audio';
import { toolById } from '@/config/tools';

const TOOL = toolById('song-joiner')!;

const CROSSFADE_OPTIONS = [
  { value: 0, label: 'None' },
  { value: 0.5, label: '0.5 seconds' },
  { value: 1, label: '1 second' },
  { value: 2, label: '2 seconds' },
  { value: 4, label: '4 seconds' },
];

export default function SongJoiner() {
  const files = useAudioFiles({ multiple: true });
  const job = useProcessing();
  const toast = useToast();
  const logRun = useRunLog(TOOL);

  const [crossfadeOn, setCrossfadeOn] = useState(true);
  const [crossfade, setCrossfade] = useState(2);
  const [normalize, setNormalize] = useState(true);
  const [removeSilence, setRemoveSilence] = useState(false);
  const [threshold, setThreshold] = useState(-40);
  const [settings, setSettings] = useState<ExportSettings>({ ...DEFAULT_EXPORT, format: 'mp3', quality: 320 });
  const [result, setResult] = useState<AudioResult | null>(null);

  const ready = files.ready;
  const totalDuration = ready.reduce((sum, file) => sum + (file.meta.duration ?? 0), 0);
  const effectiveCrossfade = crossfadeOn ? crossfade : 0;
  const joinedDuration = Math.max(0, totalDuration - effectiveCrossfade * Math.max(0, ready.length - 1));

  const join = async () => {
    if (ready.length < 2) return;
    if (result) revokeResults([result]);
    setResult(null);

    const produced = await job.run((report) =>
      joinAudio(
        ready.map((file) => file.buffer!),
        { crossfade: effectiveCrossfade, normalize, removeSilence, silenceThresholdDb: threshold },
        settings,
        report,
      ),
    );

    if (produced) {
      setResult(produced);
      logRun(`${ready.length} tracks`, joinedDuration, [produced]);
      toast.success('Processing complete.');
    }
  };

  const reset = () => {
    if (result) revokeResults([result]);
    setResult(null);
    files.clear();
    job.reset();
  };

  return (
    <ToolShell
      tool={TOOL}
      howItWorks={[
        { title: 'Add two or more files', body: 'Drag them in, or browse for them.' },
        { title: 'Put them in order', body: 'Drag the handles, or use the up and down buttons.' },
        { title: 'Set the crossfade', body: 'An equal-power curve keeps the loudness steady through the overlap.' },
        { title: 'Join and download', body: 'One continuous track, saved straight to your downloads.' },
      ]}
    >
      <div className="tool-columns">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <UploadZone onFiles={files.addFiles} multiple title="Drag & drop your audio files here" />

          {files.rejected.length > 0 && (
            <InlineNotice kind="error">
              {files.rejected.map((message) => (
                <span key={message} style={{ display: 'block' }}>
                  {message}
                </span>
              ))}
            </InlineNotice>
          )}

          <AudioFileList
            files={files.files}
            urls={files.urls}
            onRemove={files.remove}
            onClear={files.clear}
            onReorder={files.reorder}
          />

          {ready.length === 1 && (
            <InlineNotice>Add at least one more file — joining needs two or more tracks.</InlineNotice>
          )}

          {/* ------------------------------------------- advanced options */}
          {ready.length > 0 && (
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">Advanced Options</span>
              </div>
              <div className="panel-body" style={{ paddingTop: 4, paddingBottom: 8 }}>
                <SettingRow label="Normalize Volume" hint="Match the overall level so no track jumps out.">
                  <Toggle checked={normalize} onChange={setNormalize} label="Normalize volume" />
                </SettingRow>

                <SettingRow label="Remove Silence Between Tracks" hint="Trims quiet lead-ins and tails before joining.">
                  <Toggle checked={removeSilence} onChange={setRemoveSilence} label="Remove silence between tracks" />
                </SettingRow>

                {removeSilence && (
                  <div style={{ padding: '4px 0 12px' }}>
                    <Slider
                      label="Silence threshold"
                      value={threshold}
                      min={-60}
                      max={-20}
                      step={1}
                      onChange={setThreshold}
                      format={(value) => `${value} dB`}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {job.progress && job.progress.stage !== 'done' && job.progress.stage !== 'error' && (
            <div className="panel">
              <ProcessingState progress={job.progress} />
            </div>
          )}

          {job.error && (
            <div className="panel">
              <ErrorState body="Something went wrong while processing this audio. Please try again." onRetry={join} compact />
            </div>
          )}

          {result && <ResultList results={[result]} accent={TOOL.accent} title="Joined track" />}
        </div>

        <div className="tool-rail">
          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">Join Settings</span>
            </div>
            <div className="panel-body" style={{ display: 'grid', gap: 12 }}>
              <SettingRow label="Crossfade" hint="Smoothly blend the end of one track into the start of the next.">
                <Toggle checked={crossfadeOn} onChange={setCrossfadeOn} label="Crossfade" />
              </SettingRow>

              <Select<number>
                value={crossfade}
                onChange={setCrossfade}
                options={CROSSFADE_OPTIONS}
                disabled={!crossfadeOn}
                hint={crossfadeOn ? 'Equal-power curve, applied between each pair of tracks.' : undefined}
              />
            </div>
          </div>

          <ExportCard
            settings={settings}
            onChange={setSettings}
            showFades
            duration={joinedDuration}
            sourceRate={ready[0]?.meta.sampleRate ?? 44100}
            sourceChannels={ready[0]?.meta.channels ?? 2}
          />

          <button type="button" className="btn btn-primary btn-lg btn-block" onClick={join} disabled={ready.length < 2 || job.busy}>
            <Link2 size={17} aria-hidden="true" />
            {job.busy ? 'Joining…' : 'Join Songs'}
          </button>

          <button type="button" className="btn btn-secondary btn-block" onClick={reset} disabled={job.busy}>
            <RotateCcw size={16} aria-hidden="true" />
            Reset All
          </button>
        </div>
      </div>
    </ToolShell>
  );
}
