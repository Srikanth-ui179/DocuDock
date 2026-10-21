'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (newTheme: Theme) => void;
}

export const THEME_STORAGE_KEY = 'docudock_theme';

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  toggleTheme: () => {},
  setTheme: () => {},
});

/**
 * Directly updates DOM attributes on document.documentElement:
 * - Toggles 'dark' and 'light' classes
 * - Sets 'data-theme' attribute to 'dark' or 'light'
 * - Sets CSS style 'colorScheme' to 'dark' or 'light'
 */
export function applyThemeToDocument(targetTheme: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (targetTheme === 'light') {
    root.classList.remove('dark');
    root.classList.add('light');
    root.setAttribute('data-theme', 'light');
    root.style.colorScheme = 'light';
  } else {
    root.classList.remove('light');
    root.classList.add('dark');
    root.setAttribute('data-theme', 'dark');
    root.style.colorScheme = 'dark';
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Always initialize to 'dark' for the initial server and client render
  // to produce identical markup and prevent hydration mismatches.
  const [theme, setThemeState] = useState<Theme>('dark');

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(prev => (prev === newTheme ? prev : newTheme));
    applyThemeToDocument(newTheme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, newTheme);
    } catch {
      // Storage access might fail in restricted iframe environments
    }
  }, []);

  const toggleTheme = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
  }, [theme, setTheme]);

  // Safely restore persisted theme after hydration without causing a hydration mismatch
  // and listen for cross-tab storage changes.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') {
        if (saved !== 'dark') {
          queueMicrotask(() => {
            setThemeState(saved);
          });
        }
        applyThemeToDocument(saved);
      } else {
        applyThemeToDocument('dark');
      }
    } catch {
      applyThemeToDocument('dark');
    }

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
        setThemeState(e.newValue);
        applyThemeToDocument(e.newValue);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
