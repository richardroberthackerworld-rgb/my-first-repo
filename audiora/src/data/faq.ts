/**
 * Support questions.
 *
 * Kept in its own data file for two readers: the Support page renders it, and
 * scripts/prerender.mjs parses it to emit FAQPage structured data into the
 * delivered HTML. Google will not show an FAQ rich result for markup that
 * describes questions the page does not actually display, so there must only
 * ever be this one copy.
 *
 * Answers must stay true as the product changes — an FAQ that contradicts the
 * app is worse than no FAQ.
 */

export interface Faq {
  q: string;
  a: string;
}

export const FAQS: Faq[] = [
  {
    q: 'Why is the first run slower?',
    a: 'The first time you use one of the AI tools there is some one-off setup, which depends on your internet connection. Once that is done, everything after it starts straight away.',
  },
  {
    q: 'Which formats can I use?',
    a: 'MP3, WAV, FLAC, M4A, OGG and AAC all work, both as input and as export options. Whatever format you pick in Export Settings is genuinely what gets produced.',
  },
  {
    q: 'What is the difference between Standard and High quality?',
    a: 'Standard splits a track into four stems — vocals, drums, bass and everything else — and is quick. High quality adds separate guitar and piano stems and gives a cleaner split, but takes longer to set up and to run.',
  },
  {
    q: 'Is there a file size limit?',
    a: '7 Audio accepts files up to 500 MB. Very long files on an older phone may run short of memory before they run short of time, so a laptop is the better choice for full albums.',
  },
  {
    q: 'Do I need an account?',
    a: 'Not to start. The noise remover, cutter, joiner, pitch shifter and converter are free and need no account at all. The two AI separation tools use credits: you get 10 free to try without signing in, and 20 free every day once you sign in with Gmail.',
  },
  {
    q: 'What uses credits, and what do they cost?',
    a: 'Only the Vocal Remover and Stem Splitter use credits — 10 and 20 respectively for every 5 minutes of audio, rounded up. A run that fails or is cancelled costs nothing, and re-exporting a result you already have in a different format is free.',
  },
  {
    q: 'The separation left some vocal bleed. Why?',
    a: 'No separation is perfect. Dense mixes, heavy reverb and low-bitrate sources are the hardest cases. Starting from the highest-quality file you have makes the biggest difference, and the High quality option usually helps too.',
  },
];
