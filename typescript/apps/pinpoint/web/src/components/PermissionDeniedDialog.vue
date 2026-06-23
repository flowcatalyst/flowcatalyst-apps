<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { onApiError } from '@/api/client';

// Global "Access Denied" modal. Any API call that returns 403 (the principal
// is authenticated but lacks the required permission) opens this dialog via
// the api-client error bus. Mirrors the FlowCatalyst ForbiddenPage styling,
// but as a modal so the user stays where they are.
const visible = ref(false);
const message = ref('');

let unsubscribe: (() => void) | null = null;

onMounted(() => {
  unsubscribe = onApiError((status, msg) => {
    if (status !== 403) return;
    message.value = msg || 'You do not have permission to perform this action.';
    visible.value = true;
  });
});

onUnmounted(() => {
  unsubscribe?.();
});
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    dismissable-mask
    :draggable="false"
    :show-header="false"
    :style="{ width: '26rem' }"
    content-class="perm-denied__content"
  >
    <div class="perm-denied">
      <div class="perm-denied__icon"><i class="pi pi-lock" /></div>
      <h2 class="perm-denied__title">Access Denied</h2>
      <p class="perm-denied__message">{{ message }}</p>
      <p class="perm-denied__hint">
        Contact your administrator if you believe this is an error.
      </p>
      <Button label="OK" class="perm-denied__button" @click="visible = false" />
    </div>
  </Dialog>
</template>

<style scoped>
.perm-denied {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 28px 24px 8px;
}

.perm-denied__icon {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: #fee2e2;
  color: #dc2626;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.4rem;
  margin-bottom: 18px;
}

.perm-denied__title {
  font-size: 1.3rem;
  font-weight: 700;
  margin: 0 0 8px;
}

.perm-denied__message {
  color: var(--p-text-muted-color, #64748b);
  font-size: 0.92rem;
  line-height: 1.5;
  margin: 0 0 4px;
}

.perm-denied__hint {
  color: var(--p-text-muted-color, #94a3b8);
  font-size: 0.8rem;
  margin: 0 0 20px;
}

.perm-denied__button {
  min-width: 96px;
}
</style>
