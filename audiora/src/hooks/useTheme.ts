import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';

const KEY = 'audiora:theme';

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function readStoredTheme(): ThemeChoice {
  if (typeof localStorage === 'undefined') return 'system';
  const stored = localStorage.getItem(KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}

export function applyTheme(choice: ThemeChoice): void {
  const dark = choice === 'dark' || (choice === 'system' && systemPrefersDark());
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

/** Apply the stored theme as early as possible, before React paints. */
export function initTheme(): void {
  applyTheme(readStoredTheme());
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readStoredTheme);

  useEffect(() => {
    applyTheme(choice);
    localStorage.setItem(KEY, choice);
  }, [choice]);

  // Follow the OS while the user is on "system".
  useEffect(() => {
    if (choice !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [choice]);

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  const toggle = useCallback(() => {
    setChoice(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  }, []);

  return { choice, setChoice, toggle, isDark };
}
