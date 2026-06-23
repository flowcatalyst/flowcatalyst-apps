import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export interface User {
  id: string;
  email: string;
  name: string;
}

interface MeResponse extends User {
  permissions?: string[];
}

function redirectToLogin(): void {
  window.location.href = '/auth/login';
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const permissions = ref<ReadonlySet<string>>(new Set());
  const loading = ref(false);
  const initialized = ref(false);

  const isAuthenticated = computed(() => user.value !== null);

  /**
   * True when the principal holds the given permission(s). Anchors carry the
   * full catalog, so this is also true for super-admins. Pass an array to
   * require ALL of them. Use to hide actions/forms the user can't perform.
   */
  function can(permission: string | string[]): boolean {
    const needed = Array.isArray(permission) ? permission : [permission];
    return needed.every((p) => permissions.value.has(p));
  }

  const displayName = computed(() => {
    if (!user.value) return '';
    return user.value.name || user.value.email;
  });

  const userInitials = computed(() => {
    const name = displayName.value;
    if (!name) return '?';
    const parts = name.split(' ').filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  });

  /**
   * Probe the current session.
   *
   *  - `authenticated`   — `/auth/me` returned the principal.
   *  - `unauthenticated` — `/auth/me` returned 401: there is no session or it
   *                        has expired (the server already attempted an
   *                        in-band refresh). This is the ONLY result that
   *                        should redirect to login.
   *  - `error`           — server (5xx) or network failure. Session state is
   *                        unknown; we must NOT redirect to login (that loops
   *                        on a transient outage). Auth state is left
   *                        untouched and `initialized` stays false so the next
   *                        navigation retries the probe.
   */
  async function checkSession(): Promise<'authenticated' | 'unauthenticated' | 'error'> {
    loading.value = true;
    try {
      const response = await fetch('/auth/me', { credentials: 'include' });
      if (response.ok) {
        const me = (await response.json()) as MeResponse;
        user.value = { id: me.id, email: me.email, name: me.name };
        permissions.value = new Set(me.permissions ?? []);
        initialized.value = true;
        return 'authenticated';
      }
      if (response.status === 401) {
        user.value = null;
        initialized.value = true;
        return 'unauthenticated';
      }
      // Unexpected status (5xx, etc.) — don't claim the user is logged out.
      return 'error';
    } catch {
      // Network failure — session state unknown; don't bounce to login.
      return 'error';
    } finally {
      loading.value = false;
    }
  }

  function logout(): void {
    user.value = null;
    window.location.href = '/auth/logout';
  }

  function clearAuth(): void {
    user.value = null;
    permissions.value = new Set();
  }

  return {
    user,
    permissions,
    loading,
    initialized,
    isAuthenticated,
    displayName,
    userInitials,
    can,
    checkSession,
    redirectToLogin,
    logout,
    clearAuth,
  };
});
