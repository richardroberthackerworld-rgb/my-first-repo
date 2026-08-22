import type { LucideIcon } from 'lucide-react';
import { Activity, AudioLines, Link2, Mic, Music2, RefreshCw, Scissors, Sparkles } from 'lucide-react';

export type ToolBadge = 'ai' | 'free' | 'soon';

export interface ToolDef {
  id: string;
  name: string;
  /** Route path, or null for the placeholder tile. */
  path: string | null;
  short: string;
  description: string;
  icon: LucideIcon;
  /** CSS custom property holding this tool's accent colour. */
  accent: string;
  badge: ToolBadge;
  /** Short subtitle for the "How it works" dialog. */
  tagline: string;
}

export const TOOLS: ToolDef[] = [
  {
    id: 'vocal-remover',
    name: 'Vocal Remover',
    path: '/tools/vocal-remover',
    short: 'Remove vocals from any song and get clean instrumental tracks in seconds.',
    description: 'Split any song into a clean instrumental and an isolated vocal track.',
    icon: Mic,
    accent: 'var(--a-violet)',
    badge: 'ai',
    tagline: 'Upload, process, download.',
  },
  {
    id: 'stem-splitter',
    name: 'Stem Splitter',
    path: '/tools/stem-splitter',
    short: 'Split songs into vocals, drums, bass and more with AI precision.',
    description: 'Break any track into separate studio-grade stems — up to six of them.',
    icon: AudioLines,
    accent: 'var(--a-green)',
    badge: 'ai',
    tagline: 'Upload, process, download.',
  },
  {
    id: 'noise-remover',
    name: 'Noise Remover',
    path: '/tools/noise-remover',
    short: 'Remove background noise, hiss and hum for crystal clear audio.',
    description: 'Clean up hiss, hum and background noise while keeping voices clear.',
    icon: Activity,
    accent: 'var(--a-orange)',
    badge: 'free',
    tagline: 'Upload, process, download.',
  },
  {
    id: 'audio-cutter',
    name: 'Audio Cutter',
    path: '/tools/audio-cutter',
    short: 'Trim, crop and cut audio files with precision. Batch cut multiple parts.',
    description: 'Mark as many sections as you need, preview each one and export them together.',
    icon: Scissors,
    accent: 'var(--a-pink)',
    badge: 'free',
    tagline: 'Trim with precision.',
  },
  {
    id: 'song-joiner',
    name: 'Song Joiner',
    path: '/tools/song-joiner',
    short: 'Merge multiple tracks into one seamless audio file with ease.',
    description: 'Reorder your files, set a smooth crossfade and export one continuous track.',
    icon: Link2,
    accent: 'var(--a-blue)',
    badge: 'free',
    tagline: 'Merge into one track.',
  },
  {
    id: 'pitch-shifter',
    name: 'Pitch Shifter',
    path: '/tools/pitch-shifter',
    short: 'Change the pitch of your songs up or down with live preview.',
    description: 'Shift up to twelve semitones either way, with the length left untouched.',
    icon: Music2,
    accent: 'var(--a-purple)',
    badge: 'free',
    tagline: 'Hear the change as you drag.',
  },
  {
    id: 'audio-converter',
    name: 'Audio Converter',
    path: '/tools/audio-converter',
    short: 'Convert audio between MP3, WAV, FLAC, M4A, OGG and AAC.',
    description: 'Batch convert your files, choose sample rate and channels, and tidy up levels.',
    icon: RefreshCw,
    accent: 'var(--a-teal)',
    badge: 'free',
    tagline: 'Convert between six formats.',
  },
  {
    id: 'more',
    name: 'More Coming Soon',
    path: null,
    short: "We're adding new tools regularly to supercharge your workflow.",
    description: 'New 7 Audio tools are in the works.',
    icon: Sparkles,
    accent: 'var(--a-violet)',
    badge: 'soon',
    tagline: '',
  },
];

export const REAL_TOOLS = TOOLS.filter((t) => t.path !== null);

export function toolById(id: string): ToolDef | undefined {
  return TOOLS.find((t) => t.id === id);
}

/**
 * Tool ids that also answer at the site root — /vocal-remover as well as
 * /tools/vocal-remover. Both the router and public/.htaccess redirect them
 * to the canonical /tools/ path, so there is never a second indexable copy
 * of a tool page competing with the first.
 */
export const TOOL_SHORT_PATHS: string[] = TOOLS.filter((tool) => tool.path).map((tool) => tool.id);
