/**
 * ==========================================================================
 * CREDIT COSTS — what each run costs the user.
 *
 * Only the AI separation tools cost credits. Everything badged "Free Tool" in
 * the UI stays free, so the badge is never a lie.
 *
 * Cost is charged per started block of audio, so a 6-minute track costs the
 * same as a 10-minute one. Rounding up is stated plainly in the UI.
 * ==========================================================================
 */

export interface CreditCost {
  /** Credits per started block. */
  perBlock: number;
  /** Length of a block, in seconds. */
  blockSeconds: number;
}

export const CREDIT_COSTS: Record<string, CreditCost> = {
  'vocal-remover': { perBlock: 10, blockSeconds: 300 },
  'stem-splitter': { perBlock: 20, blockSeconds: 300 },
};

/** Tools that never charge. Kept explicit so the UI and billing agree. */
export const FREE_TOOLS = ['noise-remover', 'audio-cutter', 'song-joiner', 'pitch-shifter', 'audio-converter'];

export function isFreeTool(toolId: string): boolean {
  return FREE_TOOLS.includes(toolId) || !CREDIT_COSTS[toolId];
}

/** Credits a run of `toolId` on `durationSeconds` of audio will cost. */
export function costFor(toolId: string, durationSeconds: number): number {
  const cost = CREDIT_COSTS[toolId];
  if (!cost) return 0;
  const blocks = Math.max(1, Math.ceil((durationSeconds || 0) / cost.blockSeconds));
  return blocks * cost.perBlock;
}

/** "10 credits" / "20 credits per 5 minutes" — for explaining the price up front. */
export function describeCost(toolId: string): string | null {
  const cost = CREDIT_COSTS[toolId];
  if (!cost) return null;
  const minutes = Math.round(cost.blockSeconds / 60);
  return `${cost.perBlock} credits per ${minutes} minutes of audio`;
}

/** Free credits a signed-out visitor gets. Mirrors GUEST_CREDITS on the server. */
export const GUEST_ALLOWANCE = 10;

/** Free credits a signed-in account gets each day. Mirrors DAILY_FREE. */
export const DAILY_ALLOWANCE = 20;
