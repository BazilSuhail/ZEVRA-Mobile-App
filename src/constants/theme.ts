/**
 * Zevra design tokens — JS mirror of the CSS tokens in `src/global.css`.
 * Prefer `className` (uniwind) for styling; use these maps when a raw color
 * value is needed (Reanimated values, shadows, native APIs).
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#18181b',
    background: '#f8f7fc',
    backgroundElement: '#ffffff',
    backgroundSelected: '#f4f3f9',
    textSecondary: '#71717a',
  },
  dark: {
    text: '#fafafa',
    background: '#07050a',
    backgroundElement: '#130f23',
    backgroundSelected: '#18142a',
    textSecondary: '#a1a1aa',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/** Full Zevra token palette, keyed by theme (mirrors src/global.css). */
export const ZevraTokens = {
  dark: {
    bgPrimary: '#07050a',
    bgSecondary: '#0f0c1b',
    bgSurface: '#18142a',
    bgCard: '#130f23',
    bgInset: '#0a0812',
    bgInput: 'rgba(19, 15, 35, 0.75)',
    textPrimary: '#fafafa',
    textSecondary: '#c084fc',
    textMuted: '#a1a1aa',
    textWhite: '#ffffff',
    textBody: 'rgba(228, 228, 231, 0.8)',
    textLabel: 'rgba(192, 132, 252, 0.9)',
    brand: '#7c3aed',
    brandHover: '#6d28d9',
    brandLight: '#a78bfa',
    accent: '#6366f1',
    accentHover: '#4f46e5',
    accentLight: '#818cf8',
    purple300: '#c084fc',
    purple400: '#a855f7',
    purple500: '#a855f7',
    purple600: '#9333ea',
    indigo600: '#4f46e5',
    bubbleSent: '#7c3aed',
    bubbleReceived: '#18142a',
    border: 'rgba(63, 63, 70, 0.6)',
    borderPurple: 'rgba(168, 85, 247, 0.3)',
    borderPurpleFocus: '#a855f7',
    glowPurple: 'rgba(147, 51, 234, 0.15)',
    glowIndigo: 'rgba(79, 70, 229, 0.3)',
    dotColor: 'rgba(147, 51, 234, 0.35)',
  },
  light: {
    bgPrimary: '#f8f7fc',
    bgSecondary: '#f1f0f7',
    bgSurface: '#ffffff',
    bgCard: '#f4f3f9',
    bgInset: '#e6e4f0',
    bgInput: 'rgba(255, 255, 255, 0.85)',
    textPrimary: '#18181b',
    textSecondary: '#7c3aed',
    textMuted: '#71717a',
    textWhite: '#ffffff',
    textBody: 'rgba(63, 63, 70, 0.8)',
    textLabel: 'rgba(124, 58, 237, 0.9)',
    brand: '#7c3aed',
    brandHover: '#6d28d9',
    brandLight: '#a78bfa',
    accent: '#6366f1',
    accentHover: '#4f46e5',
    accentLight: '#818cf8',
    purple300: '#c084fc',
    purple400: '#a855f7',
    purple500: '#a855f7',
    purple600: '#9333ea',
    indigo600: '#4f46e5',
    bubbleSent: '#7c3aed',
    bubbleReceived: '#f4f4f5',
    border: 'rgba(228, 228, 231, 0.8)',
    borderPurple: 'rgba(124, 58, 237, 0.3)',
    borderPurpleFocus: '#7c3aed',
    glowPurple: 'rgba(124, 58, 237, 0.08)',
    glowIndigo: 'rgba(99, 102, 241, 0.08)',
    dotColor: 'rgba(124, 58, 237, 0.15)',
  },
} as const;

export type ZevraTheme = keyof typeof ZevraTokens;
export type ZevraToken = keyof (typeof ZevraTokens)['dark'];

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
