import type { App, Plugin } from 'vue';
// PrimeVue's config module ships a broken d.ts (missing default-export re-declaration),
// so the plugin objects need a cast through unknown until upstream fixes it.
import PrimeVue from 'primevue/config';
import Nora from '@primeuix/themes/nora';
import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';
import Tooltip from 'primevue/tooltip';

export interface WebKitOptions {
  /** CSS selector PrimeVue toggles for dark mode. Defaults to `.dark-mode`. */
  darkModeSelector?: string;
}

/**
 * Registers the shared PrimeVue setup every FlowCatalyst app uses: the Nora
 * theme preset, confirmation + toast services, and the tooltip directive.
 */
export function installWebKit(app: App, options: WebKitOptions = {}): void {
  app.use(PrimeVue as unknown as Plugin, {
    theme: {
      preset: Nora,
      options: {
        darkModeSelector: options.darkModeSelector ?? '.dark-mode',
      },
    },
  });
  app.use(ConfirmationService as unknown as Plugin);
  app.use(ToastService as unknown as Plugin);
  app.directive('tooltip', Tooltip);
}
