/** Brand copy and navigation. One place to change wording sitewide. */

/**
 * The one public address for 7 Audio.
 *
 * It matches the reply-to on every email the server sends (see
 * server/audio-mail.js), so a customer reaches the same inbox whether they
 * reply to a receipt or write from the contact page. The automated senders —
 * noreply@, welcome@, thankyou@ — are never shown to a customer as a way to
 * reach us.
 */
export const CONTACT_EMAIL = 'contact@7audio.7by.in';

export const BRAND = {
  name: '7 Audio',
  descriptor: 'Audio Tools',
  tagline: 'Audio tools, perfected.',
  /**
   * The splash screen is the only surface that carries this attribution,
   * per the brand brief. It must not appear in the product chrome.
   */
  splashCredit: { label: 'Powered by', name: '7by.in', href: 'https://7by.in' },
  /**
   * Google Play listing for the Android app. Left null on purpose — no real
   * URL exists yet, and the promo card refuses to link anywhere until this is
   * filled in. Paste the real listing URL here to make the button live.
   */
  playStoreUrl: null as string | null,
  social: {
    twitter: 'https://twitter.com/',
    youtube: 'https://youtube.com/',
    discord: 'https://discord.com/',
  },
} as const;

export interface NavItem {
  label: string;
  to: string;
  /** Renders a dropdown of the tools. */
  tools?: boolean;
}

export const MAIN_NAV: NavItem[] = [
  { label: 'Home', to: '/' },
  { label: 'Tools', to: '/tools', tools: true },
  { label: 'Features', to: '/features' },
  { label: 'Pricing', to: '/pricing' },
  { label: 'Blog', to: '/blog' },
];

export const FOOTER_COLUMNS = [
  {
    title: 'Product',
    links: [
      { label: 'Tools', to: '/tools' },
      { label: 'Pricing', to: '/pricing' },
      { label: 'Features', to: '/features' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'Blog', to: '/blog' },
      { label: 'About', to: '/features' },
      { label: 'Contact', to: '/contact' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy Policy', to: '/privacy' },
      { label: 'Terms of Service', to: '/terms' },
    ],
  },
];

export const HERO = {
  eyebrow: 'All-in-One',
  titleLead: 'All-in-One',
  titleAccent: 'AI Audio Toolkit',
  body: 'Powerful AI tools to edit, enhance and transform your audio.\nFast, private and easy to use — all in one place.',
  socialProof: 'Loved by 200K+ creators & musicians',
} as const;

export const FEATURE_STRIP = [
  { title: 'AI Powered', body: 'State-of-the-art models' },
  { title: 'Secure & Private', body: 'Your files, your privacy' },
  { title: 'Fast Processing', body: 'Results in seconds' },
] as const;
