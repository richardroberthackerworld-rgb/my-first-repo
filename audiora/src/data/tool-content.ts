/**
 * Typed access to src/data/tool-content.json.
 *
 * The content lives in JSON rather than in this file so that
 * scripts/prerender.mjs can read exactly the same bytes without needing a
 * TypeScript compiler — the HowTo and FAQPage markup it writes into the
 * delivered HTML then cannot drift from what the page renders.
 */

import raw from './tool-content.json';

export interface HowToStep {
  name: string;
  text: string;
}

export interface ToolFaq {
  q: string;
  a: string;
}

export interface ToolContent {
  /** Opening paragraph — the one a search result may quote. */
  lede: string;
  /** Second paragraph, for the reader who kept going. */
  body: string;
  /** Heading for the steps, and the name in the HowTo markup. */
  howToName: string;
  steps: HowToStep[];
  useCases: { title: string; body: string }[];
  /** Label/value rows: formats, limits, price. */
  specs: [string, string][];
  faqs: ToolFaq[];
  /** Tool ids to link on to. */
  related: string[];
}

const CONTENT = raw as unknown as Record<string, ToolContent>;

export function contentFor(toolId: string): ToolContent | undefined {
  return CONTENT[toolId];
}
