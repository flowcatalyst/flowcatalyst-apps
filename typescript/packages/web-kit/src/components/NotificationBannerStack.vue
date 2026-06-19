<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { onNotification, type Notification } from '../utils/errorBus';

const banners = ref<Notification[]>([]);
const timers = new Map<number, ReturnType<typeof setTimeout>>();

let unsubscribe: (() => void) | null = null;

function dismiss(id: number) {
  const idx = banners.value.findIndex((b) => b.id === id);
  if (idx !== -1) banners.value.splice(idx, 1);
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
}

function iconFor(severity: Notification['severity']): string {
  switch (severity) {
    case 'success':
      return 'pi pi-check-circle';
    case 'info':
      return 'pi pi-info-circle';
    case 'warn':
      return 'pi pi-exclamation-triangle';
    case 'error':
      return 'pi pi-times-circle';
  }
}

onMounted(() => {
  unsubscribe = onNotification((notification: Notification) => {
    banners.value.push(notification);
    if (notification.life !== undefined) {
      const handle = setTimeout(() => dismiss(notification.id), notification.life);
      timers.set(notification.id, handle);
    }
  });
});

onUnmounted(() => {
  unsubscribe?.();
  timers.forEach(clearTimeout);
  timers.clear();
});
</script>

<template>
  <div class="notification-banner-stack" role="region" aria-label="Notifications">
    <transition-group name="banner">
      <div
        v-for="banner in banners"
        :key="banner.id"
        :class="['notification-banner', `notification-banner--${banner.severity}`]"
        role="alert"
      >
        <i :class="['notification-banner__icon', iconFor(banner.severity)]" aria-hidden="true" />
        <div class="notification-banner__body">
          <div class="notification-banner__summary">{{ banner.summary }}</div>
          <div v-if="banner.detail" class="notification-banner__detail">{{ banner.detail }}</div>
        </div>
        <button
          type="button"
          class="notification-banner__close"
          aria-label="Dismiss notification"
          @click="dismiss(banner.id)"
        >
          <i class="pi pi-times" aria-hidden="true" />
        </button>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.notification-banner-stack {
  position: fixed;
  top: 1rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1100;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: min(640px, calc(100vw - 2rem));
  pointer-events: none;
}

.notification-banner {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-radius: 6px;
  border: 1px solid var(--banner-border, #d4d4d8);
  background: var(--banner-bg, #fafafa);
  color: var(--banner-fg, #18181b);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  font-size: 0.9rem;
  line-height: 1.4;
}

.notification-banner__icon {
  font-size: 1.1rem;
  margin-top: 0.1rem;
  flex-shrink: 0;
}

.notification-banner__body {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.notification-banner__summary {
  font-weight: 600;
}

.notification-banner__detail {
  margin-top: 0.15rem;
  white-space: pre-wrap;
}

.notification-banner__close {
  background: transparent;
  border: none;
  color: inherit;
  opacity: 0.7;
  cursor: pointer;
  padding: 0.15rem 0.35rem;
  border-radius: 4px;
  flex-shrink: 0;
}

.notification-banner__close:hover {
  opacity: 1;
  background: rgba(0, 0, 0, 0.05);
}

.notification-banner--success {
  --banner-bg: #ecfdf5;
  --banner-border: #6ee7b7;
  --banner-fg: #065f46;
}

.notification-banner--info {
  --banner-bg: #eff6ff;
  --banner-border: #93c5fd;
  --banner-fg: #1e40af;
}

.notification-banner--warn {
  --banner-bg: #fffbeb;
  --banner-border: #fcd34d;
  --banner-fg: #92400e;
}

.notification-banner--error {
  --banner-bg: #fef2f2;
  --banner-border: #fca5a5;
  --banner-fg: #991b1b;
}

.banner-enter-active,
.banner-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
.banner-enter-from,
.banner-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
