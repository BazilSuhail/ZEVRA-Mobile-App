// src/hooks/use-theme.ts
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Uniwind, useUniwind } from 'uniwind';

const THEME_STORAGE_KEY = '@zevra/theme';

export type ThemeName = 'light' | 'dark' | 'system';

export function useTheme() {
  const { theme, hasAdaptiveThemes } = useUniwind();
  const [isReady, setIsReady] = useState(false);
  const [savedTheme, setSavedTheme] = useState<ThemeName | null>(null);

  // Load saved theme on mount — dark-first like the web app (zevra-client)
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          Uniwind.setTheme(stored);
          setSavedTheme(stored);
        } else {
          // First launch: default to dark (web app is dark-first)
          Uniwind.setTheme('dark');
          setSavedTheme('dark');
        }
      } catch (e) {
        console.warn('Failed to load theme', e);
        Uniwind.setTheme('dark');
        setSavedTheme('dark');
      } finally {
        setIsReady(true);
      }
    })();
  }, []);

  // The actual theme in use (accounts for 'system' resolving to light/dark)
  const activeTheme: 'light' | 'dark' = hasAdaptiveThemes
    ? (theme === 'dark' ? 'dark' : 'light')
    : (theme as 'light' | 'dark');

  const setTheme = async (next: ThemeName) => {
    Uniwind.setTheme(next);
    setSavedTheme(next);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (e) {
      console.warn('Failed to save theme', e);
    }
  };

  const toggleTheme = () => {
    setTheme(activeTheme === 'dark' ? 'light' : 'dark');
  };

  return { theme, activeTheme, savedTheme, isReady, setTheme, toggleTheme };
}