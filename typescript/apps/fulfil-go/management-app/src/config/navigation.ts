/**
 * Nav grouped by subdomain (mirrors the context map): each operational
 * context gets a section and owns its own user management (pickers under
 * Picking, drivers under Transport); Stores is the base registry everything
 * binds to. Icons are Iconify lucide names (bundled by @nuxt/ui at build).
 */
export interface NavItem {
  label: string;
  to: string;
  icon: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAVIGATION: NavGroup[] = [
  {
    label: 'Operations',
    items: [{ label: 'Flightboard', to: '/flightboard', icon: 'i-lucide-radar' }],
  },
  {
    label: 'Fulfilment',
    items: [
      { label: 'Fulfilments', to: '/fulfilments', icon: 'i-lucide-package' },
      { label: 'Generator', to: '/generator', icon: 'i-lucide-sparkles' },
    ],
  },
  {
    label: 'Picking',
    items: [
      { label: 'Requested picks', to: '/picking/picks/requested', icon: 'i-lucide-clipboard-list' },
      { label: 'Active picks', to: '/picking/picks/active', icon: 'i-lucide-shopping-cart' },
      { label: 'Pickers', to: '/picking/pickers', icon: 'i-lucide-users' },
      {
        label: 'Pick profiles',
        to: '/picking/store-profiles',
        icon: 'i-lucide-sliders-horizontal',
      },
    ],
  },
  {
    label: 'Transport',
    items: [
      { label: 'Vehicle map', to: '/transport/map', icon: 'i-lucide-map' },
      { label: 'Transport orders', to: '/transport/orders', icon: 'i-lucide-route' },
      { label: 'Drivers', to: '/transport/drivers', icon: 'i-lucide-truck' },
      { label: 'Depots', to: '/transport/depots', icon: 'i-lucide-warehouse' },
      {
        label: 'Transport profiles',
        to: '/transport/store-profiles',
        icon: 'i-lucide-sliders-horizontal',
      },
    ],
  },
  {
    label: 'Stores',
    items: [
      { label: 'Stores', to: '/stores', icon: 'i-lucide-store' },
      { label: 'Printers', to: '/stores/printers', icon: 'i-lucide-printer' },
    ],
  },
];
