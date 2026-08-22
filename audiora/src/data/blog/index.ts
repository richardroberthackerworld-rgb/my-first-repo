/**
 * ==========================================================================
 * The blog.
 *
 * One JSON file per article, in this folder. JSON rather than TypeScript for
 * the same reason the tool content is: scripts/prerender.mjs and
 * scripts/make-sitemap.mjs read these files directly, so the Article markup
 * and the sitemap cannot drift from what is published.
 *
 * READING TIME IS COMPUTED, NOT DECLARED. The old data claimed a six-minute
 * read on a 380-word post. Counting the words that are actually there means
 * the figure is right by construction and cannot rot as an article is edited.
 * ==========================================================================
 */

export interface BlogBlock {
  type: 'p' | 'h2' | 'h3' | 'ul' | 'ol' | 'quote' | 'code';
  text?: string;
  items?: string[];
}

/** What a .json file in this folder holds. */
export interface BlogSource {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  date: string;
  accent: string;
  /** Optional: overrides the generated meta description. */
  metaDescription?: string;
  body: BlogBlock[];
}

export interface BlogPost extends BlogSource {
  readingMinutes: number;
  words: number;
}

/*
 * Vite resolves this at build time, so every file in the folder is bundled
 * and there is no manifest to forget to update when an article is added.
 * `eager` keeps POSTS a plain array rather than a promise.
 */
const modules = import.meta.glob<{ default: BlogSource }>('./*.json', { eager: true });

/** Words a reader actually reads: paragraphs, headings and list items. */
function countWords(body: BlogBlock[]): number {
  const text = body
    .map((block) => {
      if (block.type === 'code') return ''; // nobody reads code at 220wpm
      return [block.text ?? '', ...(block.items ?? [])].join(' ');
    })
    .join(' ')
    .trim();
  return text ? text.split(/\s+/).length : 0;
}

/** 220 words a minute is the usual figure for online prose. */
function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / 220));
}

export const POSTS: BlogPost[] = Object.values(modules)
  .map((module) => module.default)
  .map((source) => {
    const words = countWords(source.body);
    return { ...source, words, readingMinutes: readingMinutes(words) };
  })
  // Newest first.
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

export function postBySlug(slug: string): BlogPost | undefined {
  return POSTS.find((post) => post.slug === slug);
}

export const CATEGORIES = [...new Set(POSTS.map((post) => post.category))].sort();

/**
 * Articles that moved. The old URL still exists in links and search results,
 * so it redirects rather than 404s.
 */
export const BLOG_REDIRECTS: Record<string, string> = {
  // Rewritten and retitled: the old title argued against uploading audio,
  // which read oddly for a site whose accounts and credits need a server.
  'why-your-audio-should-never-be-uploaded': 'keeping-your-audio-private-online',
};

export function relatedPosts(post: BlogPost, count = 3): BlogPost[] {
  const sameCategory = POSTS.filter((p) => p.slug !== post.slug && p.category === post.category);
  const rest = POSTS.filter((p) => p.slug !== post.slug && p.category !== post.category);
  return [...sameCategory, ...rest].slice(0, count);
}
