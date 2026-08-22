import { useState } from 'react';
import { RefreshCw, RotateCcw } from 'lucide-react';
import { ToolShell } from '@/components/ToolShell';
import { UploadZone } from '@/components/UploadZone';
import { AudioFileList } from '@/components/AudioFileList';
import { ExportCard } from '@/components/ExportCard';
import { ResultList } from '@/components/ResultCard';
import { ErrorState, InlineNotice, ProcessingState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { useAudioFiles, useProcessing } from '@/hooks/useAudioFiles';
import { useRunLog } from '@/hooks/useRunLog';
import { DEFAULT_EXPORT, convertAudio, revokeResults } from '@/services/audio';
import type { AudioResult, ExportSettings } from '@/types/audio';
import { toolById } from '@/config/tools';

const TOOL = toolById('audio-converter')!;

export default function AudioConverter() {
  const files = useAudioFiles({ multiple: true });
  const job = useProcessing();
  const toast = useToast();
  const logRun = useRunLog(TOOL);
  const [settings, setSettings] = useState<ExportSettings>({ ...DEFAULT_EXPORT, format: 'mp3', quality: 320 });
  const [results, setResults] = useState<AudioResult[]>([]);

  const ready = files.ready;
  const totalDuration = ready.reduce((sum, file) => sum + (file.meta.duration ?? 0), 0);
  const source = ready[0];

  const convert = async () => {
    if (ready.length === 0) return;
    revokeResults(results);
    setResults([]);

    const produced = await job.run(async (report) => {
      const out: AudioResult[] = [];
      for (let i = 0; i < ready.length; i++) {
        const file = ready[i];
        report({
          stage: 'processing',
          percent: Math.round((i / ready.length) * 100),
          message: `Converting ${i + 1} of ${ready.length}`,
          detail: file.meta.name,
        });
        const result = await convertAudio(file.buffer!, settings, (p) =>
          report({ ...p, detail: file.meta.name }),
        );
        // Keep the original name so a batch is identifiable after download.
        result.label = file.meta.name;
        out.push(result);
      }
      return out;
    });

    if (produced) {
      setResults(produced);
      logRun(ready.map((file) => file.meta.name).join(', '), totalDuration, produced);
      toast.success('Processing complete.', `${produced.length} file${produced.length > 1 ? 's' : ''} ready.`);
    }
  };

  const resetAll = () => {
    revokeResults(results);
    setResults([]);
    files.clear();
    job.reset();
    setSettings({ ...DEFAULT_EXPORT, format: 'mp3', quality: 320 });
  };

  return (
    <ToolShell
      tool={TOOL}
      howItWorks={[
        { title: 'Add your files', body: 'Pick one file or many at once.' },
        { title: 'Choose the output', body: 'Format, bitrate, sample rate and channels — plus normalising and fades.' },
        { title: 'Convert', body: 'One button converts the whole batch.' },
        { title: 'Download', body: 'Save files one by one, or grab the whole batch as a zip.' },
      ]}
    >
      <div className="tool-columns">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <UploadZone onFiles={files.addFiles} multiple />

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

          {job.progress && job.progress.stage !== 'done' && job.progress.stage !== 'error' && (
            <div className="panel">
              <ProcessingState progress={job.progress} />
            </div>
          )}

          {job.error && (
            <div className="panel">
              <ErrorState body="Something went wrong while processing this audio. Please try again." onRetry={convert} compact />
            </div>
          )}

          <ResultList results={results} accent={TOOL.accent} zipName="7audio-converted" title="Converted files" />
        </div>

        <div className="tool-rail">
          <ExportCard
            settings={settings}
            onChange={setSettings}
            title="Conversion Settings"
            showFades
            duration={totalDuration}
            sourceRate={source?.meta.sampleRate ?? 44100}
            sourceChannels={source?.meta.channels ?? 2}
          />

          <button type="button" className="btn btn-primary btn-lg btn-block" onClick={convert} disabled={ready.length === 0 || job.busy}>
            <RefreshCw size={17} aria-hidden="true" />
            {job.busy ? 'Converting…' : `Convert ${ready.length > 1 ? `${ready.length} Files` : 'Now'}`}
          </button>

          <button type="button" className="btn btn-secondary btn-block" onClick={resetAll} disabled={job.busy}>
            <RotateCcw size={16} aria-hidden="true" />
            Reset All
          </button>
        </div>
      </div>
    </ToolShell>
  );
}
