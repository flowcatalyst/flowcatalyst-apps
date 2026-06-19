<script setup lang="ts">
import { FcButton, toast } from '@flowcatalyst-apps/web-kit';
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <div>
        <h1 class="page-title">Dashboard</h1>
        <p class="page-subtitle">Fulfil management console</p>
      </div>
    </div>

    <div class="fc-card">
      <p>
        Welcome to Fulfil Management. This shell is provided by
        <code>@flowcatalyst-apps/web-kit</code>.
      </p>
      <FcButton
        label="Show notification"
        icon="pi pi-bell"
        @click="toast.success('Hello from web-kit')"
      />
    </div>
  </div>
</template>
