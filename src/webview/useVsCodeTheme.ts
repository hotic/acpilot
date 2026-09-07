import { useEffect, useState } from 'react';

// VS Code hangs theme classes on body (vscode-dark / vscode-light / vscode-high-contrast*); follow it
export function useVsCodeTheme(): 'dark' | 'light' {
  const read = () => (document.body.classList.contains('vscode-light') || document.body.classList.contains('vscode-high-contrast-light') ? 'light' : 'dark');
  const [theme, setTheme] = useState<'dark' | 'light'>(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(read()));
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return theme;
}
