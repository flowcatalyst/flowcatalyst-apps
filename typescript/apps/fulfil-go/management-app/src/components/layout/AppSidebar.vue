<script setup lang="ts">
import { ref, watch } from 'vue';
import { NAVIGATION } from '../../config/navigation.js';
import SidebarProfile from './SidebarProfile.vue';

/**
 * Collapsible navy sidebar — the FlowCatalyst management chrome (260px ↔
 * 72px, icons persist, labels hide, active item gets the right-edge accent
 * bar). Collapse state persists per browser.
 */
const COLLAPSE_KEY = 'fulfilgo.mgmt.sidebar-collapsed';
const collapsed = ref(localStorage.getItem(COLLAPSE_KEY) === '1');
watch(collapsed, (value) => localStorage.setItem(COLLAPSE_KEY, value ? '1' : '0'));
</script>

<template>
  <aside
    class="fc-sidebar flex shrink-0 flex-col overflow-hidden text-white transition-[width] duration-300"
    :class="collapsed ? 'w-[72px]' : 'w-[260px]'"
  >
    <div
      class="flex min-h-16 items-center border-b border-white/10"
      :class="collapsed ? 'flex-col justify-center gap-1.5 py-3' : 'gap-2.5 px-4'"
    >
      <UIcon name="i-lucide-zap" class="size-6 shrink-0 text-brand-300" />
      <div v-if="!collapsed" class="min-w-0 flex-1">
        <p class="truncate text-[15px] font-semibold leading-tight">FulfilGo</p>
        <p class="text-[11px] leading-tight text-white/50">Management</p>
      </div>
      <button
        type="button"
        class="flex size-7 shrink-0 items-center justify-center rounded-md bg-white/10 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
        :title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        @click="collapsed = !collapsed"
      >
        <UIcon
          :name="collapsed ? 'i-lucide-chevron-right' : 'i-lucide-chevron-left'"
          class="size-4"
        />
      </button>
    </div>

    <nav class="fc-sidebar-nav flex-1 overflow-y-auto overflow-x-hidden py-4">
      <div v-for="group in NAVIGATION" :key="group.label" class="mb-6 last:mb-0">
        <p
          v-if="!collapsed"
          class="mb-1 px-5 text-[11px] font-semibold uppercase tracking-wider text-white/40"
        >
          {{ group.label }}
        </p>
        <router-link
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          class="fc-nav-item flex items-center gap-3 py-2.5 text-sm text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white"
          :class="collapsed ? 'justify-center px-3' : 'px-5'"
          active-class="fc-nav-item-active"
          :title="collapsed ? item.label : undefined"
        >
          <UIcon :name="item.icon" class="size-[18px] shrink-0" />
          <span v-if="!collapsed" class="truncate">{{ item.label }}</span>
        </router-link>
      </div>
    </nav>

    <div class="border-t border-white/10 p-2">
      <SidebarProfile :collapsed="collapsed" />
    </div>
  </aside>
</template>
