import type { TabItem } from '@fulfil-go/mobile-kit';

export const TABS: readonly TabItem[] = [
  { label: 'Work', icon: '🚚', route: '/offers' },
  { label: 'Settings', icon: '⚙️', route: '/settings' },
];

/** Lucide icons rendered via the shell's tab-icon slot (emoji stays the mobile-kit fallback). */
export const TAB_ICONS: Record<string, string> = {
  '/offers': 'i-lucide-truck',
  '/settings': 'i-lucide-settings',
};
