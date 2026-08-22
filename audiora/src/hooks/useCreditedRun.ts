import { useCallback, useState } from 'react';
import { useSession } from '@/services/session';
import { costFor } from '@/config/credits';

/**
 * Wraps a credit-charging tool run.
 *
 * Order of operations, and why:
 *
 *   1. Check the balance BEFORE processing. Starting work the user cannot pay
 *      for and then refusing to hand it over would be the worst outcome.
 *   2. Process.
 *   3. Charge only on SUCCESS. A failed or cancelled run costs nothing, which
 *      is what §13 asks for and what a user would expect.
 *
 * Charging after the fact means a race between two tabs can occasionally let
 * one run through at the last credit. The server still refuses to go negative,
 * so the balance stays correct — the user simply gets the benefit of the doubt
 * once. That is the right way round for a paying customer.
 */
export function useCreditedRun(toolId: string) {
  const session = useSession();
  const [blocked, setBlocked] = useState<string | null>(null);
  const [gateOpen, setGateOpen] = useState(false);

  const closeGate = useCallback(() => setGateOpen(false), []);

  /**
   * Run `task` if the user can pay for it. Returns the task's value, or null
   * when it was refused or failed.
   */
  const run = useCallback(
    async <T,>(durationSeconds: number, task: () => Promise<T | null>): Promise<T | null> => {
      const cost = costFor(toolId, durationSeconds);

      if (cost > 0 && !session.canAfford(cost)) {
        setBlocked(null);
        setGateOpen(true);
        return null;
      }

      const result = await task();
      if (result === null || result === undefined) return null;

      if (cost > 0) {
        const spent = await session.spend(cost);
        if (!spent.ok) {
          // Work is already done and delivered; surface the balance issue
          // without taking the result away.
          setBlocked(spent.error ?? null);
          setGateOpen(true);
        }
      }
      return result;
    },
    [session, toolId],
  );

  return { run, gateOpen, closeGate, blocked, credits: session.credits };
}
