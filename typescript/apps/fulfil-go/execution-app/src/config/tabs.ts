import type { TabItem } from '@fulfil-go/mobile-kit';

export const TABS: readonly TabItem[] = [
  { label: 'Jobs', icon: '📦', route: '/jobs' },
  { label: 'Settings', icon: '⚙️', route: '/settings' },
];

/** Lucide icons rendered via the shell's tab-icon slot (emoji stays the mobile-kit fallback). */
export const TAB_ICONS: Record<string, string> = {
  '/jobs': 'i-lucide-package',
  '/settings': 'i-lucide-settings',
};
