/**
 * Writes a real HTML file for every route, after `vite build`.
 *
 *   node scripts/prerender.mjs [origin]
 *
 * WHY THIS EXISTS
 *
 * 7 Audio is a single-page app: without this, every URL on the site serves the
 * same index.html, with the same <title> and the same description. React fixes
 * the head once it runs — but the things that matter most here do not run it:
 *
 *   · WhatsApp, Slack, Discord, LinkedIn and X read the HTML as delivered.
 *     Every shared link would otherwise preview identically.
 *   · Crawlers that do render JavaScript still index the delivered HTML first,
 *     and re-render later, if at all.
 *
 * So each route gets dist/<path>/index.html — the same app bundle, with the
 * head already correct and the JSON-LD already present. Apache serves those
 * files directly (the SPA rewrite only fires for paths with no file on disk),
 * and React hydrates over the top exactly as before.
 *
 * The body is deliberately NOT pre-rendered. The app is interactive from the
 * first paint and there is no server runtime here; a stale HTML snapshot of
 * the UI would only go out of date.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dist = join(root, 'dist');
const origin = (process.argv[2] ?? 'https://7audio.7by.in').replace(/\/$/, '');

if (!existsSync(dist)) {
  console.error('prerender: dist/ does not exist. Run the build first.');
  process.exit(1);
}

/* ------------------------------------------------- read the route table --- */

/*
 * src/config/seo.ts is TypeScript, and this script runs in plain Node. Rather
 * than pull in a compiler, the data is read out of the source with the same
 * discipline make-sitemap.mjs already uses: parse it, and fail loudly if the
 * shape is not what we expect, so a refactor cannot silently produce an empty
 * sitemap or a site with no titles.
 */
const seoSource = readFileSync(join(root, 'src/config/seo.ts'), 'utf8');

function parseRoutes(source) {
  const start = source.indexOf('export const ROUTE_SEO');
  if (start === -1) throw new Error('ROUTE_SEO not found in src/config/seo.ts');

  const routes = [];
  // Each entry starts with its path; title/description/flags follow it.
  const blocks = source.slice(start).split(/\n  \{\n/).slice(1);

  for (const block of blocks) {
    const path = block.match(/path: '([^']+)'/)?.[1];
    if (!path) continue;
    const title = block.match(/title:\s*\n?\s*'((?:[^'\\]|\\.)*)'/)?.[1] ?? block.match(/title: '((?:[^'\\]|\\.)*)'/)?.[1];
    const description =
      block.match(/description:\s*\n\s*'((?:[^'\\]|\\.)*)'/)?.[1] ?? block.match(/description: '((?:[^'\\]|\\.)*)'/)?.[1];
    const priority = block.match(/priority: '([^']+)'/)?.[1] ?? '0.5';
    const changefreq = block.match(/changefreq: '([^']+)'/)?.[1] ?? 'monthly';
    const noindex = /noindex: true/.test(block);

    if (!title || !description) throw new Error(`prerender: route ${path} is missing a title or description`);
    routes.push({ path, title: unescapeSingle(title), description: unescapeSingle(description), priority, changefreq, noindex });
  }

  if (routes.length < 10) throw new Error(`prerender: only parsed ${routes.length} routes — the table format changed`);
  return routes;
}

function unescapeSingle(value) {
  return value.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

const routes = parseRoutes(seoSource);

/* ------------------------------------------------------------ blog posts -- */

/*
 * Articles are one JSON file each in src/data/blog/. Reading the files
 * directly means the Article markup and the sitemap describe exactly what is
 * published — no parsing of TypeScript source, and nothing to keep in step by
 * hand when a post is added.
 */
function readPosts(rootDir) {
  const dir = join(rootDir, 'src/data/blog');
  const posts = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')));

  for (const post of posts) {
    if (!post.slug || !post.title || !post.excerpt || !Array.isArray(post.body)) {
      throw new Error(`blog: ${post.slug ?? '(no slug)'} is missing a required field`);
    }
  }
  if (posts.length === 0) throw new Error('blog: no articles found in src/data/blog');

  const seen = new Set();
  for (const post of posts) {
    if (seen.has(post.slug)) throw new Error(`blog: duplicate slug ${post.slug}`);
    seen.add(post.slug);
  }

  return posts.sort((a, b) => (a.date < b.date ? 1 : -1));
}

const posts = readPosts(root);

/* ------------------------------------------------------------------ faq --- */

/*
 * Support's questions come from src/data/faq.ts — the same list the page
 * renders. Google only shows an FAQ rich result when the markup matches
 * what a visitor can actually see, so these must never be written twice.
 */
const faqSource = readFileSync(join(root, 'src/data/faq.ts'), 'utf8');
const faqs = [];
{
  const re = /\{\s*\n\s*q: '((?:[^'\\]|\\.)*)',\s*\n\s*a:\s*\n?\s*'((?:[^'\\]|\\.)*)',?\s*\n\s*\}/g;
  let m;
  while ((m = re.exec(faqSource))) faqs.push({ q: unescapeSingle(m[1]), a: unescapeSingle(m[2]) });
}
if (faqs.length === 0) throw new Error('prerender: no FAQs parsed from src/data/faq.ts');

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map(({ q, a }) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: { '@type': 'Answer', text: a },
  })),
};

/* --------------------------------------------------------- tool content --- */

/*
 * The landing copy below each tool. It is JSON precisely so this script can
 * read the exact bytes the page renders — HowTo and FAQPage markup is only
 * eligible for a rich result when it describes what a visitor can actually
 * see, so the two must come from one file.
 */
const toolContent = JSON.parse(readFileSync(join(root, 'src/data/tool-content.json'), 'utf8'));

function landingSchemaFor(path) {
  const id = path.replace('/tools/', '');
  const content = toolContent[id];
  if (!content) throw new Error(`prerender: no landing content for ${path}`);

  return [
    {
      '@context': 'https://schema.org',
      '@type': 'HowTo',
      name: content.howToName,
      description: content.lede,
      totalTime: 'PT2M',
      step: content.steps.map((step, index) => ({
        '@type': 'HowToStep',
        position: index + 1,
        name: step.name,
        text: step.text,
      })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: content.faqs.map(({ q, a }) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    },
  ];
}

/* -------------------------------------------------------------- helpers --- */

const SITE_NAME = '7 Audio';
const OG_IMAGE = `${origin}/brand/og-image.jpg`;

const escapeHtml = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fullTitle = (title) => (title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`);

function headFor({ path, title, description, noindex, type = 'website', schema = [] }) {
  const canonical = `${origin}${path === '/' ? '/' : path}`;
  const t = escapeHtml(fullTitle(title));
  const d = escapeHtml(description);

  const tags = [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}" />`,
    `<meta name="robots" content="${noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large'}" />`,
    `<link rel="canonical" href="${canonical}" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
    `<meta name="twitter:image" content="${OG_IMAGE}" />`,
  ];

  for (const block of schema) {
    // JSON-LD sits in a script tag, so a closing tag inside a string would end
    // it early. Escaping the slash is the standard defence.
    tags.push(
      `<script type="application/ld+json">${JSON.stringify(block).replace(/</g, '\\u003c')}</script>`,
    );
  }

  return tags.map((tag) => `    ${tag}`).join('\n');
}

/* Sitewide blocks, repeated on every page so any entry point identifies the site. */
const organization = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: SITE_NAME,
  url: origin,
  logo: `${origin}/brand/icon-512.png`,
  description: 'AI audio tools for creators: vocal removal, stem splitting, noise removal and format conversion.',
};

const website = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: SITE_NAME,
  url: origin,
  publisher: { '@type': 'Organization', name: SITE_NAME, url: origin },
};

function toolSchemaFor(path, title, description) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: `${title.split('—')[0].trim()} — ${SITE_NAME}`,
    description,
    url: `${origin}${path}`,
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
    publisher: { '@type': 'Organization', name: SITE_NAME, url: origin },
  };
}

function breadcrumbsFor(path) {
  if (path === '/') return null;
  const parts = path.split('/').filter(Boolean);
  const items = [{ '@type': 'ListItem', position: 1, name: 'Home', item: origin }];
  let sofar = '';
  parts.forEach((part, index) => {
    sofar += `/${part}`;
    items.push({
      '@type': 'ListItem',
      position: index + 2,
      name: part
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' '),
      item: `${origin}${sofar}`,
    });
  });
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items };
}

/* --------------------------------------------------------------- write --- */

const template = readFileSync(join(dist, 'index.html'), 'utf8');

// Everything the template already carries for these concerns is replaced, so
// nothing is stated twice with two different values.
const STRIP = [
  /^\s*<title>.*?<\/title>\s*$/gm,
  /^\s*<meta name="description".*?\/>\s*$/gm,
];

function pageFrom(head) {
  let html = template;
  for (const pattern of STRIP) html = html.replace(pattern, '');
  return html.replace('</head>', `${head}\n  </head>`);
}

function writePage(path, html) {
  const target = path === '/' ? join(dist, 'index.html') : join(dist, path.slice(1), 'index.html');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, html, 'utf8');
}

let written = 0;

for (const route of routes) {
  const schema = [organization, website];
  const crumbs = breadcrumbsFor(route.path);
  if (crumbs) schema.push(crumbs);
  if (route.path.startsWith('/tools/')) {
    schema.push(toolSchemaFor(route.path, route.title, route.description));
    schema.push(...landingSchemaFor(route.path));
  }
  if (route.path === '/support') schema.push(faqSchema);
  writePage(route.path, pageFrom(headFor({ ...route, schema })));
  written++;
}

for (const post of posts) {
  const path = `/blog/${post.slug}`;
  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.excerpt,
    url: `${origin}${path}`,
    datePublished: post.date,
    dateModified: post.date,
    author: { '@type': 'Organization', name: SITE_NAME, url: origin },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      logo: { '@type': 'ImageObject', url: `${origin}/brand/icon-512.png` },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${origin}${path}` },
  };

  writePage(
    path,
    pageFrom(
      headFor({
        path,
        title: post.title,
        description: post.excerpt || post.title,
        noindex: false,
        type: 'article',
        schema: [organization, website, breadcrumbsFor(path), article],
      }),
    ),
  );
  written++;
}

console.log(`prerender: ${written} pages (${routes.length} routes + ${posts.length} posts) at ${origin}`);
