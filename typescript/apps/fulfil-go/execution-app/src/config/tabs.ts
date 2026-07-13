import type { TabItem } from '@fulfil-go/mobile-kit';

// The demo 'Jobs' vertical is retired from the chrome (superseded by the
// claim marketplace); its routes stay reachable until the server vertical
// is deleted.
export const TABS: readonly TabItem[] = [
  { label: 'Work', icon: '🚚', route: '/offers' },
  { label: 'Settings', icon: '⚙️', route: '/settings' },
];

/** Lucide icons rendered via the shell's tab-icon slot (emoji stays the mobile-kit fallback). */
export const TAB_ICONS: Record<string, string> = {
  '/offers': 'i-lucide-truck',
  '/jobs': 'i-lucide-package',
  '/settings': 'i-lucide-settings',
};
