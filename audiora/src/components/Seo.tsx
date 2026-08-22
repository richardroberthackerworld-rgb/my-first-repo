import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  DEFAULT_OG_IMAGE,
  SITE_NAME,
  SITE_ORIGIN,
  TWITTER_HANDLE,
  breadcrumbSchema,
  canonicalFor,
  fullTitle,
  organizationSchema,
  seoFor,
  websiteSchema,
} from '@/config/seo';

/**
 * ==========================================================================
 * Keeps the document head correct as the app navigates.
 *
 * The head is also written into every page at BUILD time by
 * scripts/prerender.mjs, because crawlers and chat-app link previews do not
 * run JavaScript. This component exists for the other half of the problem:
 * once React takes over, a client-side navigation has to update the same
 * tags, or the tab title and canonical stay stuck on whatever page was
 * loaded first.
 *
 * Every tag it writes is marked data-seo, so the next navigation can replace
 * exactly its own tags and leave everything else in the head alone.
 * ==========================================================================
 */

interface SeoProps {
  /** Overrides the route table — used by pages with dynamic content. */
  title?: string;
  description?: string;
  /** Absolute or root-relative. */
  image?: string;
  /** 'website' for pages, 'article' for blog posts. */
  type?: 'website' | 'article';
  noindex?: boolean;
  /** Extra JSON-LD blocks for this page. */
  schema?: Record<string, unknown>[];
}

const MANAGED = 'data-seo';

/*
 * Tags this component owns completely.
 *
 * Two sources write these: index.html carries a default set, and the
 * pre-render step writes a per-route set into every built page. Once React is
 * running it has to own them outright — appending a second
 * <meta name="description"> leaves the FIRST one in the document, and that is
 * the one a crawler reads. So anything matching these selectors that this
 * component did not write is removed before its own tags go in.
 *
 * Everything else in the head — viewport, theme-color, icons, the manifest,
 * the font links — is untouched.
 */
const OWNED = [
  'meta[name="description"]',
  'meta[name="robots"]',
  'link[rel="canonical"]',
  'meta[property^="og:"]',
  'meta[name^="twitter:"]',
  'script[type="application/ld+json"]',
].join(', ');

function clearManaged() {
  document.head.querySelectorAll(OWNED).forEach((node) => node.remove());
  document.head.querySelectorAll(`[${MANAGED}]`).forEach((node) => node.remove());
}

function meta(attr: 'name' | 'property', key: string, content: string) {
  const tag = document.createElement('meta');
  tag.setAttribute(attr, key);
  tag.setAttribute('content', content);
  tag.setAttribute(MANAGED, '');
  document.head.appendChild(tag);
}

function link(rel: string, href: string) {
  const tag = document.createElement('link');
  tag.setAttribute('rel', rel);
  tag.setAttribute('href', href);
  tag.setAttribute(MANAGED, '');
  document.head.appendChild(tag);
}

function jsonLd(data: Record<string, unknown>) {
  const tag = document.createElement('script');
  tag.type = 'application/ld+json';
  tag.setAttribute(MANAGED, '');
  tag.textContent = JSON.stringify(data);
  document.head.appendChild(tag);
}

function absolute(url: string): string {
  return url.startsWith('http') ? url : `${SITE_ORIGIN}${url}`;
}

export function Seo({ title, description, image, type = 'website', noindex, schema }: SeoProps) {
  const { pathname } = useLocation();

  useEffect(() => {
    const route = seoFor(pathname);

    const pageTitle = fullTitle(title ?? route?.title ?? SITE_NAME);
    const pageDescription =
      description ??
      route?.description ??
      'AI audio tools for creators: remove vocals, split stems, clean up noise, cut, join, pitch-shift and convert.';
    const canonical = canonicalFor(pathname);
    const ogImage = absolute(image ?? DEFAULT_OG_IMAGE);
    const hidden = noindex ?? route?.noindex ?? false;

    document.title = pageTitle;
    clearManaged();

    meta('name', 'description', pageDescription);
    meta('name', 'robots', hidden ? 'noindex, nofollow' : 'index, follow, max-image-preview:large');
    link('canonical', canonical);

    /* Open Graph — used by Facebook, WhatsApp, LinkedIn, Slack, Discord. */
    meta('property', 'og:site_name', SITE_NAME);
    meta('property', 'og:type', type);
    meta('property', 'og:title', pageTitle);
    meta('property', 'og:description', pageDescription);
    meta('property', 'og:url', canonical);
    meta('property', 'og:image', ogImage);
    meta('property', 'og:image:width', '1200');
    meta('property', 'og:image:height', '630');
    meta('property', 'og:locale', 'en_US');

    /* Twitter/X reads its own tags and falls back to OG for the rest. */
    meta('name', 'twitter:card', 'summary_large_image');
    meta('name', 'twitter:title', pageTitle);
    meta('name', 'twitter:description', pageDescription);
    meta('name', 'twitter:image', ogImage);
    if (TWITTER_HANDLE) meta('name', 'twitter:site', TWITTER_HANDLE);

    /* Sitewide identity, on every page. */
    jsonLd(organizationSchema());
    jsonLd(websiteSchema());

    if (route?.breadcrumbs?.length) jsonLd(breadcrumbSchema(route.breadcrumbs));
    route?.schema?.forEach(jsonLd);
    schema?.forEach(jsonLd);

    // On unmount, drop only this component's own tags. Stripping the owned
    // set here would leave the document with no description at all.
    return () => {
      document.head.querySelectorAll(`[${MANAGED}]`).forEach((node) => node.remove());
    };
  }, [pathname, title, description, image, type, noindex, schema]);

  return null;
}
