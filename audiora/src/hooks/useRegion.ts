import { useCallback, useState } from 'react';
import { REGIONS, type Region } from '@/config/pricing';

const KEY = 'audiora:region';

/**
 * Best-effort guess at whether the visitor is in India, so rupee pricing is
 * shown there and dollar pricing everywhere else. Uses the browser's own time
 * zone and language — no network call, no IP lookup. The visitor can always
 * override it, and the override is what gets remembered.
 */
function detectRegion(): Region {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    if (/Calcutta|Kolkata/i.test(zone)) return 'IN';
  } catch {
    /* fall through */
  }
  try {
    const languages = [navigator.language, ...(navigator.languages ?? [])];
    if (languages.some((l) => /-IN\b/i.test(l ?? ''))) return 'IN';
  } catch {
    /* fall through */
  }
  return 'INTL';
}

function readStored(): Region {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'IN' || stored === 'INTL') return stored;
  } catch {
    /* storage disabled */
  }
  return detectRegion();
}

/** Selected billing region plus its currency details. */
export function useRegion() {
  const [region, setRegionState] = useState<Region>(readStored);

  const setRegion = useCallback((next: Region) => {
    setRegionState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage disabled */
    }
  }, []);

  return { region, setRegion, info: REGIONS[region] };
}
