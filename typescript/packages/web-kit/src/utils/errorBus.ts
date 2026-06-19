/**
 * Event bus for global notifications.
 *
 * Non-Vue code (API interceptors, error handlers) emits notifications here; the
 * `NotificationBannerStack` component subscribes and renders them.
 *
 * Behaviour spec:
 * - success: 3s auto-dismiss, dismissable via ×
 * - info:    5s auto-dismiss, dismissable
 * - warn:    sticky, dismissable
 * - error:   sticky, dismissable
 */

export type NotificationSeverity = 'success' | 'info' | 'warn' | 'error';

export interface Notification {
  id: number;
  severity: NotificationSeverity;
  summary: string;
  detail?: string;
  /** Auto-dismiss after this many ms. Omitted/undefined means sticky. */
  life?: number;
}

type NotificationHandler = (notification: Notification) => void;

const handlers: Set<NotificationHandler> = new Set();
let nextId = 1;

/** Subscribe to notifications. Returns an unsubscribe function. */
export function onNotification(handler: NotificationHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/** Emit a notification to all subscribers. */
export function notify(notification: Omit<Notification, 'id'>): void {
  const full: Notification = { ...notification, id: nextId++ };
  handlers.forEach((handler) => handler(full));
}

/** Convenience methods for common notification types. */
export const toast = {
  success(summary: string, detail?: string) {
    notify({ severity: 'success', summary, life: 3000, ...(detail !== undefined && { detail }) });
  },
  info(summary: string, detail?: string) {
    notify({ severity: 'info', summary, life: 5000, ...(detail !== undefined && { detail }) });
  },
  warn(summary: string, detail?: string) {
    // Sticky — user must dismiss
    notify({ severity: 'warn', summary, ...(detail !== undefined && { detail }) });
  },
  error(summary: string, detail?: string) {
    // Sticky — user must dismiss
    notify({ severity: 'error', summary, ...(detail !== undefined && { detail }) });
  },
};
