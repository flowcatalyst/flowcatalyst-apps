<script setup lang="ts">
/**
 * Placeholder — driver management lands with the transport context. Its
 * identity plane (platform OIDC vs a local plane like picking's) is a parked
 * decision in docs/pick-context-auth.md; the UI section exists now so the
 * information architecture is stable.
 */
import PageHeader from '../components/PageHeader.vue';
</script>

<template>
  <div class="max-w-3xl p-6">
    <PageHeader title="Drivers" />
    <UAlert
      title="Transport context not built yet"
      description="Driver user management (create / inactivate / assign) will live here once the
        transport context exists. The demo job dispatch in the execution app still runs on
        platform-OIDC identities."
      variant="soft"
    />
  </div>
</template>
