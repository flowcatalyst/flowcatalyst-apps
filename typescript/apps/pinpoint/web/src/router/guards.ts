import type { NavigationGuardWithThis } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useClientStore } from '@/stores/client';
import { notifyPermissionDenied } from '@/api/client';

export const authGuard: NavigationGuardWithThis<undefined> = async () => {
  const authStore = useAuthStore();
  const clientStore = useClientStore();

  if (!authStore.initialized) {
    const result = await authStore.checkSession();
    if (result === 'unauthenticated') {
      authStore.redirectToLogin();
      return false;
    }
    if (result === 'error') {
      // Couldn't verify the session (server/network error). Don't bounce to
      // login — that loops on a transient outage, and `initialized` stays
      // false so the next navigation retries. Let the route render; data
      // calls surface their own errors.
      return true;
    }
    // authenticated — load clients before entering.
    await clientStore.loadClients();
  } else if (!authStore.isAuthenticated) {
    authStore.redirectToLogin();
    return false;
  }

  return true;
};

/**
 * Per-route permission guard for pages that are pure mutations (the create
 * forms). The parent `authGuard` runs first and populates permissions, so by
 * the time this child guard runs `authStore.can(...)` is reliable. On a deny
 * it pops the global Access Denied modal and bounces to the dashboard rather
 * than rendering a form whose submit would only 403.
 */
export function requirePermission(permission: string): NavigationGuardWithThis<undefined> {
  return () => {
    const authStore = useAuthStore();
    if (authStore.can(permission)) return true;
    notifyPermissionDenied();
    return { name: 'dashboard' };
  };
}
