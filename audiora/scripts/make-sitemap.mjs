/**
 * Writes public/sitemap.xml for Audiora.
 *
 *   node scripts/make-sitemap.mjs [origin]
 *
 * Only public, crawlable routes are listed. Account and per-device surfaces
 * are excluded here and in robots.txt.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const origin = (process.argv[2] ?? 'https://7audio.7by.in').replace(/\/$/, '');

/*
 * The route list is NOT kept here. src/config/seo.ts already holds every path
 * with its title, description and priority, and two hand-maintained lists
 * drift: this file used to advertise /api, a page that no longer exists.
 * Routes marked noindex are skipped, because a sitemap is a list of pages you
 * are asking Google to index.
 */
const seoSource = readFileSync(join(root, 'src/config/seo.ts'), 'utf8');

function routesFromSeo(source) {
  const start = source.indexOf('export const ROUTE_SEO');
  if (start === -1) throw new Error('ROUTE_SEO not found in src/config/seo.ts');

  const out = [];
  for (const block of source.slice(start).split(/\n  \{\n/).slice(1)) {
    const path = block.match(/path: '([^']+)'/)?.[1];
    if (!path) continue;
    if (/noindex: true/.test(block)) continue;
    out.push([
      path,
      block.match(/priority: '([^']+)'/)?.[1] ?? '0.5',
      block.match(/changefreq: '([^']+)'/)?.[1] ?? 'monthly',
    ]);
  }
  if (out.length < 10) throw new Error(`only parsed ${out.length} routes from seo.ts — the format changed`);
  return out;
}

const STATIC_ROUTES = routesFromSeo(seoSource);

// Slugs come from the article files themselves, so a new post appears in the
// sitemap the moment it is written.
const slugs = readdirSync(join(root, 'src/data/blog'))
  .filter((name) => name.endsWith('.json'))
  .map((name) => JSON.parse(readFileSync(join(root, 'src/data/blog', name), 'utf8')).slug);
if (slugs.length === 0) throw new Error('no articles found in src/data/blog');

const today = new Date().toISOString().slice(0, 10);

const urls = [
  ...STATIC_ROUTES.map(([path, priority, freq]) => ({ path, priority, freq })),
  ...slugs.map((slug) => ({ path: `/blog/${slug}`, priority: '0.6', freq: 'monthly' })),
];

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    ({ path, priority, freq }) => `  <url>
    <loc>${origin}${path}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${freq}</changefreq>
    <priority>${priority}</priority>
  </url>`,
  )
  .join('\n')}
</urlset>
`;

mkdirSync(join(root, 'public'), { recursive: true });
writeFileSync(join(root, 'public/sitemap.xml'), xml, 'utf8');
console.log(`sitemap.xml — ${urls.length} URLs at ${origin}`);
