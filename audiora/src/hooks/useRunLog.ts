import { useCallback } from 'react';
import type { AudioResult } from '@/types/audio';
import type { ToolDef } from '@/config/tools';
import { recordActivity } from '@/services/workspace';

/**
 * Record a finished job in the local workspace history.
 * Fire-and-forget: history is a convenience and must never block a real result.
 */
export function useRunLog(tool: ToolDef) {
  return useCallback(
    (fileName: string, duration: number, results: AudioResult[]) => {
      void recordActivity({
        toolId: tool.id,
        toolName: tool.name,
        fileName: fileName.slice(0, 120),
        duration,
        outputSize: results.reduce((sum, result) => sum + result.size, 0),
        outputs: results.length,
      });
    },
    [tool],
  );
}
