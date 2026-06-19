import type { NavGroup } from '@flowcatalyst-apps/web-kit';

export type { NavItem, NavGroup } from '@flowcatalyst-apps/web-kit';

export const NAVIGATION_CONFIG: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      {
        label: 'Dashboard',
        icon: 'pi pi-home',
        route: '/dashboard',
      },
    ],
  },
  {
    label: 'Locations',
    items: [
      {
        label: 'Clients',
        icon: 'pi pi-building',
        route: '/clients',
      },
      {
        label: 'Locations',
        icon: 'pi pi-map-marker',
        route: '/locations',
      },
      {
        label: 'Master Locations',
        icon: 'pi pi-database',
        route: '/master-locations',
      },
      {
        label: 'Unvalidated',
        icon: 'pi pi-exclamation-circle',
        route: '/master-locations/unvalidated',
      },
      {
        label: 'Layers',
        icon: 'pi pi-clone',
        route: '/layers',
      },
      {
        label: 'Map View',
        icon: 'pi pi-map',
        route: '/layers/map',
      },
      {
        label: 'Spatial Lookup',
        icon: 'pi pi-search',
        route: '/spatial-lookup',
      },
    ],
  },
  {
    label: 'Configuration',
    items: [
      {
        label: 'Matching Config',
        icon: 'pi pi-sliders-h',
        route: '/matching-config',
      },
      {
        label: 'Partitions',
        icon: 'pi pi-th-large',
        route: '/partitions',
      },
    ],
  },
];
