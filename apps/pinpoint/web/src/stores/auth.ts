import { defineStore } from "pinia";
import { ref, computed } from "vue";

export interface User {
	id: string;
	email: string;
	name: string;
}

export const useAuthStore = defineStore("auth", () => {
	const user = ref<User | null>(null);
	const loading = ref(false);
	const initialized = ref(false);

	const isAuthenticated = computed(() => user.value !== null);

	const displayName = computed(() => {
		if (!user.value) return "";
		return user.value.name || user.value.email;
	});

	const userInitials = computed(() => {
		const name = displayName.value;
		if (!name) return "?";
		const parts = name.split(" ").filter(Boolean);
		if (parts.length >= 2) {
			return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
		}
		return name.substring(0, 2).toUpperCase();
	});

	async function checkSession(): Promise<boolean> {
		loading.value = true;
		try {
			const response = await fetch("/auth/me", { credentials: "include" });
			if (response.ok) {
				user.value = (await response.json()) as User;
				initialized.value = true;
				return true;
			}
			user.value = null;
			initialized.value = true;
			return false;
		} catch {
			user.value = null;
			initialized.value = true;
			return false;
		} finally {
			loading.value = false;
		}
	}

	function redirectToLogin(): void {
		window.location.href = "/auth/login";
	}

	function logout(): void {
		user.value = null;
		window.location.href = "/auth/logout";
	}

	function clearAuth(): void {
		user.value = null;
	}

	return {
		user,
		loading,
		initialized,
		isAuthenticated,
		displayName,
		userInitials,
		checkSession,
		redirectToLogin,
		logout,
		clearAuth,
	};
});
