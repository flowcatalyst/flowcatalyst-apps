<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useAuthStore } from '@/stores/auth';

const authStore = useAuthStore();

const menuOpen = ref(false);
const menuRef = ref<HTMLElement | null>(null);

function toggleMenu() {
  menuOpen.value = !menuOpen.value;
}

function closeMenu() {
  menuOpen.value = false;
}

function handleLogout() {
  closeMenu();
  authStore.logout();
}

function handleClickOutside(event: MouseEvent) {
  if (menuRef.value && !menuRef.value.contains(event.target as Node)) {
    menuOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>

<template>
  <div ref="menuRef" class="user-menu-container">
    <button class="user-menu-trigger" @click="toggleMenu">
      <div class="user-avatar">
        {{ authStore.userInitials }}
      </div>
      <div class="user-info">
        <span class="user-name">{{ authStore.displayName }}</span>
        <span class="user-email">{{ authStore.user?.email }}</span>
      </div>
      <i class="pi pi-chevron-down" :class="{ rotated: menuOpen }"></i>
    </button>

    <div v-if="menuOpen" class="user-menu-dropdown">
      <div class="menu-header">
        <div class="user-avatar large">
          {{ authStore.userInitials }}
        </div>
        <div class="user-details">
          <span class="name">{{ authStore.displayName }}</span>
          <span class="email">{{ authStore.user?.email }}</span>
        </div>
      </div>

      <div class="menu-divider"></div>

      <div class="menu-items">
        <button class="menu-item danger" @click="handleLogout">
          <i class="pi pi-sign-out"></i>
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.user-menu-container {
  position: relative;
}

.user-menu-trigger {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  background: none;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.user-menu-trigger:hover {
  background: #f8fafc;
  border-color: #e2e8f0;
}

.user-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, #0967d2 0%, #47a3f3 100%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 14px;
  flex-shrink: 0;
}

.user-avatar.large {
  width: 48px;
  height: 48px;
  font-size: 18px;
}

.user-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
}

.user-name {
  font-weight: 500;
  color: #1e293b;
  font-size: 14px;
  line-height: 1.3;
}

.user-email {
  font-size: 12px;
  color: #64748b;
  line-height: 1.3;
}

.user-menu-trigger i {
  color: #64748b;
  font-size: 12px;
  transition: transform 0.2s ease;
}

.user-menu-trigger i.rotated {
  transform: rotate(180deg);
}

.user-menu-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 280px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
  border: 1px solid #e2e8f0;
  z-index: 1000;
  animation: dropdownFadeIn 0.15s ease;
}

@keyframes dropdownFadeIn {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.menu-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
}

.user-details {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.user-details .name {
  font-weight: 600;
  color: #1e293b;
  font-size: 15px;
}

.user-details .email {
  font-size: 13px;
  color: #64748b;
}

.menu-divider {
  height: 1px;
  background: #e2e8f0;
  margin: 0;
}

.menu-items {
  padding: 8px;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  background: none;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  color: #475569;
  font-size: 14px;
  text-decoration: none;
  transition: all 0.15s ease;
  text-align: left;
}

.menu-item:hover {
  background: #f1f5f9;
  color: #1e293b;
}

.menu-item i {
  font-size: 16px;
  width: 20px;
  text-align: center;
}

.menu-item.danger {
  color: #dc2626;
}

.menu-item.danger:hover {
  background: #fef2f2;
  color: #b91c1c;
}

@media (max-width: 640px) {
  .user-info {
    display: none;
  }

  .user-menu-trigger {
    padding: 6px;
  }

  .user-menu-trigger i.pi-chevron-down {
    display: none;
  }

  .user-menu-dropdown {
    right: -16px;
  }
}
</style>
