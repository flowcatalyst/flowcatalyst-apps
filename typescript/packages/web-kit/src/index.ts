// Layout shell
export { default as MainLayout } from './components/layout/MainLayout.vue';
export { default as AppHeader } from './components/layout/AppHeader.vue';
export { default as AppSidebar } from './components/layout/AppSidebar.vue';
export { default as NotificationBannerStack } from './components/NotificationBannerStack.vue';

// Form widgets
export { default as FcInput } from './form/FcInput.vue';
export { default as FcButton } from './form/FcButton.vue';

// Composables
export { useLocalState } from './composables/useLocalState';
export { useListState } from './composables/useListState';
export { useFormField } from './composables/useFormField';

// Notification bus
export { notify, onNotification, toast } from './utils/errorBus';
export type { Notification, NotificationSeverity } from './utils/errorBus';

// Error helpers
export { getErrorMessage } from './utils/errors';

// Navigation contract (data is app-owned)
export type { NavItem, NavGroup } from './config/navigation';

// PrimeVue + theme setup
export { installWebKit } from './setup';
export type { WebKitOptions } from './setup';
