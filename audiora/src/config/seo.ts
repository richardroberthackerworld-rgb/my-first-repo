/**
 * ==========================================================================
 * SEO — ONE SOURCE OF TRUTH FOR EVERY ROUTE
 *
 * Titles, descriptions, canonicals and structured data all come from here.
 * Three different consumers read this file, and they must never disagree:
 *
 *   1. <Seo> at runtime, so a client-side navigation updates the head.
 *   2. scripts/prerender.mjs at build time, so a crawler or a chat app that
 *      does not run JavaScript still gets the right title, description and
 *      preview image.
 *   3. scripts/make-sitemap.mjs, so the sitemap can never list a route that
 *      does not exist or miss one that does.
 *
 * Descriptions are written to be read by a person in a search result: what
 * the page does, in plain words, inside the ~155 characters Google shows.
 * ==========================================================================
 */

export const SITE_ORIGIN = 'https://7audio.7by.in';
export const SITE_NAME = '7 Audio';
export const TITLE_SUFFIX = '7 Audio';
export const DEFAULT_OG_IMAGE = '/brand/og-image.jpg';
export const TWITTER_HANDLE = '';

export type ChangeFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RouteSeo {
  path: string;
  /** Shown in the browser tab and as the search result headline. */
  title: string;
  description: string;
  /** Sitemap only. */
  priority: string;
  changefreq: ChangeFreq;
  /** Kept out of the sitemap and marked noindex. */
  noindex?: boolean;
  /** Trail shown above the page heading, and emitted as BreadcrumbList. */
  breadcrumbs?: { label: string; path: string }[];
  /** Extra JSON-LD for this page, beyond the sitewide Organization/WebSite. */
  schema?: Record<string, unknown>[];
}

/* ------------------------------------------------------------- helpers --- */

/** "Vocal Remover" → "Vocal Remover — Free AI … | 7 Audio" is built by callers. */
export function fullTitle(title: string): string {
  return title.includes(TITLE_SUFFIX) ? title : `${title} | ${TITLE_SUFFIX}`;
}

export function canonicalFor(path: string): string {
  const clean = path === '/' ? '/' : `/${path.replace(/^\/+|\/+$/g, '')}`;
  return `${SITE_ORIGIN}${clean}`;
}

/* --------------------------------------------------------- tool schema --- */

/**
 * Each tool is a real piece of software that runs in the browser, so
 * SoftwareApplication is the honest type. `offers` states the free tier that
 * genuinely exists — no invented review counts or ratings, which would be
 * fabricated structured data.
 */
function toolSchema(name: string, description: string, path: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: `${name} — ${SITE_NAME}`,
    description,
    url: canonicalFor(path),
    applicationCategory: 'MultimediaApplication',
    applicationSubCategory: 'Audio Editing',
    operatingSystem: 'Any (web browser)',
    browserRequirements: 'Requires a modern browser with JavaScript enabled',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      description: 'Free to use, with paid plans for heavier use',
    },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_ORIGIN },
  };
}

const TOOLS_CRUMB = { label: 'Tools', path: '/tools' };

/* -------------------------------------------------------------- routes --- */

export const ROUTE_SEO: RouteSeo[] = [
  {
    path: '/',
    title: '7 Audio — Free AI Vocal Remover, Stem Splitter & Audio Tools',
    description:
      'Remove vocals, split stems, clean up noise, cut, join, pitch-shift and convert audio. Seven AI-powered tools in one place, free to start.',
    priority: '1.0',
    changefreq: 'weekly',
  },
  {
    path: '/tools',
    title: 'All Audio Tools',
    description:
      'Every 7 Audio tool in one list: vocal remover, stem splitter, noise remover, cutter, joiner, pitch shifter and format converter.',
    priority: '0.9',
    changefreq: 'weekly',
    breadcrumbs: [TOOLS_CRUMB],
  },

  /* ------------------------------------------------------------- tools -- */
  {
    path: '/tools/vocal-remover',
    title: 'Free AI Vocal Remover — Make Karaoke Tracks Online',
    description:
      'Split any song into a clean instrumental and an isolated vocal track. AI-powered, works in your browser, exports WAV or 320kbps MP3.',
    priority: '0.9',
    changefreq: 'monthly',
    breadcrumbs: [TOOLS_CRUMB, { label: 'Vocal Remover', path: '/tools/vocal-remover' }],
    schema: [
      toolSchema(
        'Vocal Remover',
        'Split any song into a clean instrumental and an isolated vocal track.',
        '/tools/vocal-remover',
      ),
    ],
  },
  {
    path: '/tools/stem-splitter',
    title: 'AI Stem Splitter — Separate Vocals, Drums & Bass',
    description:
      'Break any track into studio-grade stems: vocals, drums, bass, guitar, piano and more. Download each one separately in WAV or MP3.',
    priority: '0.9',
    changefreq: 'monthly',
    breadcrumbs: [TOOLS_CRUMB, { label: 'Stem Splitter', path: '/tools/stem-splitter' }],
    schema: [
      toolSchema(
        'Stem Splitter',
        'Break any track into separate studio-grade stems — up to six of them.',
        '/tools/stem-splitter',
      ),
    ],
  },
  {
    path: '/tools/noise-remover',
    title: 'Free Noise Remover — Clean Up Hiss, Hum & Background Noise',
    description:
      'Remove background noise, tape hiss, mains hum and wind from recordings while keeping voices clear. Free, and works in your browser.',
    priority: '0.8',
    changefreq: 'monthly',
    breadcrumbs: [TOOLS_CRUMB, { label: 'Noise Remover', path: '/tools/noise-remover' }],
    schema: [
      toolSchema(
        'Noise Remover',
        'Clean up hiss, hum and background noise while keeping voices clear.',
        '/tools/noise-remover',
      ),
    ],
  },
  {
    path: '/tools/audio-cutter',
    title: 'Free Online Audio Cutter — Trim & Crop MP3 and WAV',
    description:
      'Trim, crop and cut audio with precision. Mark as many sections as you need, preview each one and export them together. Free, no watermark.',
    priority: '0.8',
    changefreq: 'monthly',
    breadcrumbs: [TOOLS_CRUMB, { label: 'Audio Cutter', path: '/tools/audio-cutter' }],
    schema: [
      toolSchema(
        'Audio Cutter',
        'Mark as many sections as you need, preview each one and export them together.',
        '/tools/audio-cutter',
      ),
    ],
  },
  {
    path: '/tools/song-joiner',
    title: 'Free Song Joiner — Merge Audio Files Online',
    description:
      'Merge several tracks into one seamless file. Reorder your songs, set a smooth crossfade and export a single continuous track.',
    priority: '0.8',
    changefreq: 'monthly',
    breadcrumbs: [TOOLS_CRUMB, { label: 'Song Joiner', path: '/tools/song-joiner' }],
    schema: [
      toolSchema(
        'Song Joiner',
        'Reorder your files, set a smooth crossfade and export one continuous track.',
        '/tools/song-joiner',
      ),
    ],
  },
  {
    path: '/tools/pitch-shifter',
    title: 'Free Pitch Shifter — Change Key & Tempo Online',
    description:
      'Shift pitch by semitones without changing the tempo, or change the tempo without touching the pitch. Preview live before you export.',
    priority: '0.8',
    changefreq: 'monthly',
    breadcrumbs: [TOOLS_CRUMB, { label: 'Pitch Shifter', path: '/tools/pitch-shifter' }],
    schema: [
      toolSchema(
        'Pitch Shifter',
        'Shift pitch by semitones or change the tempo, with a live preview.',
        '/tools/pitch-shifter',
      ),
    ],
  },
  {
    path: '/tools/audio-converter',
    title: 'Free Audio Converter — MP3, WAV, FLAC, M4A, OGG & AAC',
    description:
      'Convert audio between MP3, WAV, FLAC, M4A, OGG and AAC. Pick the bitrate, sample rate and channels, then download the real file.',
    priority: '0.8',
    changefreq: 'monthly',
    breadcrumbs: [TOOLS_CRUMB, { label: 'Audio Converter', path: '/tools/audio-converter' }],
    schema: [
      toolSchema(
        'Audio Converter',
        'Convert audio between MP3, WAV, FLAC, M4A, OGG and AAC.',
        '/tools/audio-converter',
      ),
    ],
  },

  /* ---------------------------------------------------------- marketing -- */
  {
    path: '/features',
    title: 'Features — What 7 Audio Can Do',
    description:
      'AI separation, noise removal, precise cutting, joining, pitch shifting and six export formats. Everything 7 Audio does, in one place.',
    priority: '0.7',
    changefreq: 'monthly',
    breadcrumbs: [{ label: 'Features', path: '/features' }],
  },
  {
    path: '/pricing',
    title: 'Pricing — Plans From ₹49 a Month',
    description:
      'Simple plans for heavier use, in rupees or dollars. Every tool works free to start, and paid plans add credits for the AI separation tools.',
    priority: '0.7',
    changefreq: 'monthly',
    breadcrumbs: [{ label: 'Pricing', path: '/pricing' }],
  },
  {
    path: '/blog',
    title: 'Blog — Guides for Producers and Creators',
    description:
      'Practical guides on separating stems, cleaning up recordings, choosing export formats and getting more out of your audio.',
    priority: '0.7',
    changefreq: 'weekly',
    breadcrumbs: [{ label: 'Blog', path: '/blog' }],
  },
  {
    path: '/credits',
    title: 'How Credits Work',
    description:
      'What credits are, which tools use them, how many you get free every day, and what each plan includes.',
    priority: '0.5',
    changefreq: 'monthly',
    breadcrumbs: [{ label: 'Credits', path: '/credits' }],
  },
  {
    path: '/contact',
    title: 'Contact 7 Audio',
    description:
      'Get in touch with the 7 Audio team about a tool, a payment or a suggestion. One address, read by a person.',
    priority: '0.5',
    changefreq: 'yearly',
    breadcrumbs: [{ label: 'Contact', path: '/contact' }],
  },
  {
    path: '/support',
    title: 'Support & Contact',
    description: 'Answers to common questions about 7 Audio, and how to reach us if you need a hand.',
    priority: '0.5',
    changefreq: 'monthly',
    breadcrumbs: [{ label: 'Support', path: '/support' }],
  },

  /* -------------------------------------------------------------- legal -- */
  {
    path: '/privacy',
    title: 'Privacy Policy',
    description: 'What 7 Audio collects, what it does not, and how your files and account data are handled.',
    priority: '0.3',
    changefreq: 'yearly',
    breadcrumbs: [{ label: 'Privacy Policy', path: '/privacy' }],
  },
  {
    path: '/terms',
    title: 'Terms of Service',
    description: 'The terms you agree to when you use 7 Audio, written to be read rather than skimmed past.',
    priority: '0.3',
    changefreq: 'yearly',
    breadcrumbs: [{ label: 'Terms of Service', path: '/terms' }],
  },

  /* ------------------------------------------------- account: never index -- */
  {
    path: '/signin',
    title: 'Sign In',
    description: 'Sign in to 7 Audio with your Gmail account.',
    priority: '0.1',
    changefreq: 'yearly',
    noindex: true,
  },
  {
    path: '/dashboard',
    title: 'Dashboard',
    description: 'Your recent activity and credit balance.',
    priority: '0.1',
    changefreq: 'yearly',
    noindex: true,
  },
  {
    path: '/profile',
    title: 'Profile',
    description: 'Your account and recent activity.',
    priority: '0.1',
    changefreq: 'yearly',
    noindex: true,
  },
  {
    path: '/settings',
    title: 'Settings',
    description: 'Your preferences for this browser.',
    priority: '0.1',
    changefreq: 'yearly',
    noindex: true,
  },
];

export function seoFor(path: string): RouteSeo | undefined {
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return ROUTE_SEO.find((route) => route.path === clean);
}

/** Routes that belong in the sitemap: public, indexable, and real. */
export function indexableRoutes(): RouteSeo[] {
  return ROUTE_SEO.filter((route) => !route.noindex);
}

/* ------------------------------------------------------ sitewide schema --- */

export function organizationSchema(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_ORIGIN,
    logo: `${SITE_ORIGIN}/brand/icon-512.png`,
    description: 'AI audio tools for creators: vocal removal, stem splitting, noise removal and format conversion.',
  };
}

export function websiteSchema(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_ORIGIN,
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_ORIGIN },
  };
}

export function breadcrumbSchema(trail: { label: string; path: string }[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_ORIGIN },
      ...trail.map((crumb, index) => ({
        '@type': 'ListItem',
        position: index + 2,
        name: crumb.label,
        item: canonicalFor(crumb.path),
      })),
    ],
  };
}

export function articleSchema(post: {
  title: string;
  excerpt: string;
  slug: string;
  date: string;
  readingMinutes?: number;
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.excerpt,
    url: canonicalFor(`/blog/${post.slug}`),
    datePublished: post.date,
    dateModified: post.date,
    author: { '@type': 'Organization', name: SITE_NAME, url: SITE_ORIGIN },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      logo: { '@type': 'ImageObject', url: `${SITE_ORIGIN}/brand/icon-512.png` },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonicalFor(`/blog/${post.slug}`) },
  };
}

export function faqSchema(items: { q: string; a: string }[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}
