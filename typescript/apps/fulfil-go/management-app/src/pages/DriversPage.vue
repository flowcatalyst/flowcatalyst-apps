<script setup lang="ts">
/**
 * Placeholder — driver identity lands with the execution-app migration onto
 * the claim marketplace. DECIDED (Andrew, 2026-07-13): drivers log in like
 * PICKERS — the local PIN-primary plane (staff code + PIN, sessions bound
 * to their operating context), not platform OIDC. This page will mirror the
 * Pickers page (seed / create / suspend / reassign) once that lands.
 * Live transport operations are on the Transport orders page.
 */
import PageHeader from '../components/PageHeader.vue';
</script>

<template>
  <div class="max-w-3xl p-6">
    <PageHeader title="Drivers" />
    <UAlert
      title="Driver identity is the next transport build"
      description="Decided: drivers sign in like pickers — staff code + PIN against a local driver
        registry, with sessions bound to their operating context (the picker-identity pattern).
        Management (seed / create / suspend / reassign) will live here when the execution app
        moves onto the claim marketplace. Live transport work is under Transport orders."
      variant="soft"
    />
  </div>
</template>
