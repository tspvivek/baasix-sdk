import type { HttpClient } from "../client";
import type {
  Notification,
  PaginatedResponse,
  SendNotificationData,
} from "../types";

export interface NotificationsModuleConfig {
  client: HttpClient;
}

/**
 * Notifications module for managing user notifications.
 *
 * @example
 * ```typescript
 * // Get user notifications
 * const { data } = await baasix.notifications.find();
 *
 * // Mark as seen
 * await baasix.notifications.markAsSeen('notification-id');
 *
 * // Send notification (admin)
 * await baasix.notifications.send({
 *   title: 'New Message',
 *   message: 'You have a new message',
 *   userIds: ['user-uuid']
 * });
 * ```
 */
export class NotificationsModule {
  private client: HttpClient;

  constructor(config: NotificationsModuleConfig) {
    this.client = config.client;
  }

  /**
   * List notifications for the current user
   *
   * @example
   * ```typescript
   * const { data } = await baasix.notifications.find({
   *   limit: 20,
   *   filter: { seen: { eq: false } }
   * });
   * ```
   */
  async find(params?: {
    limit?: number;
    page?: number;
    seen?: boolean;
  }): Promise<PaginatedResponse<Notification>> {
    return this.client.get<PaginatedResponse<Notification>>("/notifications", {
      params: params as Record<string, unknown>,
    });
  }

  /**
   * Get a single notification by ID
   */
  async findOne(id: string): Promise<Notification> {
    const response = await this.client.get<{ data: Notification }>(
      `/notifications/${id}`
    );
    return response.data;
  }

  /**
   * Mark a notification as seen
   *
   * @example
   * ```typescript
   * await baasix.notifications.markAsSeen('notification-uuid');
   * ```
   */
  async markAsSeen(id: string): Promise<void> {
    await this.client.patch(`/notifications/${id}/seen`, { seen: true });
  }

  /**
   * Mark multiple notifications as seen
   *
   * @example
   * ```typescript
   * await baasix.notifications.markManySeen(['id1', 'id2', 'id3']);
   * ```
   */
  async markManySeen(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => this.markAsSeen(id)));
  }

  /**
   * Mark all notifications as seen
   *
   * @example
   * ```typescript
   * await baasix.notifications.markAllSeen();
   * ```
   */
  async markAllSeen(): Promise<void> {
    await this.client.post("/notifications/seen-all");
  }

  /**
   * Get unread notification count
   *
   * @example
   * ```typescript
   * const count = await baasix.notifications.getUnreadCount();
   * ```
   */
  async getUnreadCount(): Promise<number> {
    const response = await this.client.get<{ data: { count: number } }>(
      "/notifications/unread-count"
    );
    return response.data.count;
  }

  /**
   * Delete a notification
   *
   * @example
   * ```typescript
   * await baasix.notifications.delete('notification-uuid');
   * ```
   */
  async delete(id: string): Promise<void> {
    await this.client.delete(`/notifications/${id}`);
  }

  /**
   * Send a notification to users (requires admin permissions)
   *
   * @example
   * ```typescript
   * await baasix.notifications.send({
   *   type: 'alert',
   *   title: 'System Update',
   *   message: 'The system will be down for maintenance',
   *   data: { link: '/updates' },
   *   userIds: ['user1-uuid', 'user2-uuid']
   * });
   * ```
   */
  async send(data: SendNotificationData): Promise<void> {
    await this.client.post("/notifications/send", data);
  }
}

// Re-export types
export type { Notification, SendNotificationData };
