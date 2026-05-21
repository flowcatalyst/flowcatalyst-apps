<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useToast } from "primevue/usetoast";
import { onNotification, type Notification } from "@/utils/errorBus";

const primeToast = useToast();

let unsubscribe: (() => void) | null = null;

onMounted(() => {
	unsubscribe = onNotification((notification: Notification) => {
		primeToast.add({
			severity: notification.severity,
			summary: notification.summary,
			detail: notification.detail,
			life: notification.life ?? 5000,
		});
	});
});

onUnmounted(() => {
	unsubscribe?.();
});
</script>

<template>
  <!-- Bridges errorBus to PrimeVue Toast -->
</template>
