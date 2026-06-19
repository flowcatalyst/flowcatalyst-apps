<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { apiFetch } from '@/api/client';
import { toast } from '@flowcatalyst-apps/web-kit';
import { getErrorMessage } from '@flowcatalyst-apps/web-kit';

const router = useRouter();
const saving = ref(false);

const form = ref({
  name: '',
});

async function handleSubmit() {
  saving.value = true;
  try {
    const result = await apiFetch<{ id: string }>('/clients', {
      method: 'POST',
      body: JSON.stringify(form.value),
    });
    toast.success('Client Created', `Client "${form.value.name}" has been created.`);
    await router.push(`/clients/${result.id}`);
  } catch (e) {
    toast.error('Failed to create client', getErrorMessage(e, 'Unknown error'));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="page-container" style="max-width: 600px">
    <div class="page-header">
      <div>
        <h1 class="page-title">New Client</h1>
        <p class="page-subtitle">Create a new client account</p>
      </div>
    </div>

    <div class="fc-card">
      <form @submit.prevent="handleSubmit">
        <div style="margin-bottom: 16px">
          <label for="name" style="display: block; margin-bottom: 6px; font-weight: 500"
            >Name</label
          >
          <InputText
            id="name"
            v-model="form.name"
            placeholder="Enter client name"
            class="w-full"
            required
          />
        </div>

        <div style="display: flex; gap: 8px; justify-content: flex-end">
          <Button label="Cancel" severity="secondary" @click="router.back()" />
          <Button label="Create Client" type="submit" :loading="saving" />
        </div>
      </form>
    </div>
  </div>
</template>
