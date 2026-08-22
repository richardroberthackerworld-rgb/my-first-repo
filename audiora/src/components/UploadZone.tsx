import { useCallback, useRef, useState, type DragEvent } from 'react';
import { FileAudio, FolderOpen, ShieldCheck, UploadCloud } from 'lucide-react';
import { ACCEPT_ATTR, MAX_FILE_BYTES, formatBytes } from '@/services/audio';

interface UploadZoneProps {
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  title?: string;
  hint?: string;
  buttonLabel?: string;
  compact?: boolean;
  disabled?: boolean;
}

/**
 * File picker + drop target. Reads with the File API only — the file is never
 * sent anywhere; the "Upload" wording follows the references, but the privacy
 * line below it states plainly what actually happens.
 */
export function UploadZone({
  onFiles,
  multiple = false,
  title,
  hint,
  buttonLabel,
  compact = false,
  disabled = false,
}: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const handleFiles = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      const files = Array.from(list);
      onFiles(multiple ? files : files.slice(0, 1));
    },
    [multiple, onFiles],
  );

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (disabled) return;
    handleFiles(event.dataTransfer.files);
  };

  const openPicker = () => {
    if (!disabled) inputRef.current?.click();
  };

  return (
    <div
      className="upload-zone"
      data-drag={dragging}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={title ?? 'Choose an audio file from your device'}
      style={disabled ? { opacity: 0.55, cursor: 'not-allowed' } : compact ? { padding: '26px 18px' } : undefined}
      onClick={openPicker}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openPicker();
        }
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        if (!disabled) setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        multiple={multiple}
        hidden
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = '';
        }}
      />

      <span
        style={{
          width: compact ? 48 : 60,
          height: compact ? 48 : 60,
          display: 'grid',
          placeItems: 'center',
          borderRadius: 18,
          background: 'var(--brand-soft)',
          color: 'var(--brand)',
        }}
      >
        {multiple ? <FileAudio size={compact ? 21 : 26} aria-hidden="true" /> : <UploadCloud size={compact ? 21 : 26} aria-hidden="true" />}
      </span>

      <span style={{ fontSize: compact ? 15 : 16.5, fontWeight: 700, letterSpacing: '-0.02em' }}>
        {title ?? (multiple ? 'Drag & drop your audio files here' : 'Choose your audio file')}
      </span>

      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        {hint ?? `Supports MP3, WAV, FLAC, M4A, OGG, AAC (up to ${formatBytes(MAX_FILE_BYTES)} each)`}
      </span>

      <span className="btn btn-primary" style={{ marginTop: 6, pointerEvents: 'none' }}>
        <FolderOpen size={16} aria-hidden="true" />
        {buttonLabel ?? (multiple ? 'Add Audio Files' : 'Choose File')}
      </span>

      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 4,
          fontSize: 11.5,
          color: 'var(--text-dim)',
        }}
      >
        <ShieldCheck size={13} aria-hidden="true" />
        Your files are handled securely.
      </span>
    </div>
  );
}
