import type { NavigationGuardWithThis } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useClientStore } from '@/stores/client';

export const authGuard: NavigationGuardWithThis<undefined> = async () => {
  const authStore = useAuthStore();
  const clientStore = useClientStore();

  if (!authStore.initialized) {
    const authenticated = await authStore.checkSession();
    if (!authenticated) {
      authStore.redirectToLogin();
      return false;
    }
    // Load clients after authentication
    await clientStore.loadClients();
  } else if (!authStore.isAuthenticated) {
    authStore.redirectToLogin();
    return false;
  }

  return true;
};
