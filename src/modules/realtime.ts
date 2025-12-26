import type { HttpClient } from "../client";
import type { StorageAdapter } from "../storage/types";
import { STORAGE_KEYS } from "../storage/types";
import type { BaseItem } from "../types";

// Socket.io-client types (minimal subset for SDK)
interface SocketOptions {
  auth?: { token?: string };
  query?: Record<string, string>;
  path?: string;
  transports?: string[];
  reconnection?: boolean;
  reconnectionAttempts?: number;
  reconnectionDelay?: number;
  timeout?: number;
}

interface Socket {
  connected: boolean;
  id?: string;
  on(event: string, callback: (...args: any[]) => void): void;
  off(event: string, callback?: (...args: any[]) => void): void;
  emit(event: string, ...args: any[]): void;
  connect(): void;
  disconnect(): void;
}

type SocketIOClient = (url: string, options?: SocketOptions) => Socket;

export interface RealtimeConfig {
  client: HttpClient;
  storage: StorageAdapter;
  socketUrl?: string;
  socketPath?: string;
}

export type SubscriptionEvent = "create" | "update" | "delete";

export interface SubscriptionPayload<T = any> {
  action: SubscriptionEvent;
  collection: string;
  data: T;
  timestamp: string;
}

export interface WorkflowExecutionUpdate {
  executionId: string | number;
  status?: string;
  nodeId?: string;
  nodeName?: string;
  message?: string;
  progress?: number;
  result?: any;
  error?: string;
  timestamp: string;
}

export interface SubscriptionCallback<T = any> {
  (payload: SubscriptionPayload<T>): void;
}

interface Subscription {
  collection: string;
  callbacks: Map<string, SubscriptionCallback>;
}

/**
 * Realtime module for WebSocket-based real-time subscriptions.
 * 
 * Requires socket.io-client to be installed separately:
 * ```bash
 * npm install socket.io-client
 * ```
 * 
 * @example
 * ```typescript
 * import { io } from 'socket.io-client';
 * 
 * // Initialize realtime with socket.io client
 * baasix.realtime.setSocketClient(io);
 * 
 * // Connect to realtime server
 * await baasix.realtime.connect();
 * 
 * // Subscribe to collection changes
 * const unsubscribe = baasix.realtime.subscribe('products', (payload) => {
 *   console.log(`Product ${payload.action}:`, payload.data);
 * });
 * 
 * // Disconnect when done
 * baasix.realtime.disconnect();
 * ```
 */
export class RealtimeModule {
  private client: HttpClient;
  private storage: StorageAdapter;
  private socket: Socket | null = null;
  private socketClient: SocketIOClient | null = null;
  private socketUrl: string;
  private socketPath: string;
  private subscriptions: Map<string, Subscription> = new Map();
  private workflowCallbacks: Map<string, Set<(data: WorkflowExecutionUpdate) => void>> = new Map();
  private connectionCallbacks: Set<(connected: boolean) => void> = new Set();
  private reconnecting: boolean = false;
  private connectionPromise: Promise<void> | null = null;

  constructor(config: RealtimeConfig) {
    this.client = config.client;
    this.storage = config.storage;
    this.socketUrl = config.socketUrl || "";
    this.socketPath = config.socketPath || "/socket";
  }

  /**
   * Set the socket.io client instance
   * This allows the SDK to work without bundling socket.io-client
   * 
   * @example
   * ```typescript
   * import { io } from 'socket.io-client';
   * baasix.realtime.setSocketClient(io);
   * ```
   */
  setSocketClient(socketIO: SocketIOClient): void {
    this.socketClient = socketIO;
  }

  /**
   * Set the WebSocket server URL
   * By default, uses the same URL as the API
   */
  setSocketUrl(url: string): void {
    this.socketUrl = url;
  }

  /**
   * Check if socket.io client is available
   */
  private ensureSocketClient(): void {
    if (!this.socketClient) {
      throw new Error(
        "Socket.io client not set. Please call baasix.realtime.setSocketClient(io) with socket.io-client."
      );
    }
  }

  /**
   * Get the authentication token for socket connection
   */
  private async getAuthToken(): Promise<string | null> {
    return await this.storage.get(STORAGE_KEYS.ACCESS_TOKEN);
  }

  /**
   * Connect to the realtime server
   * 
   * @example
   * ```typescript
   * await baasix.realtime.connect();
   * console.log('Connected to realtime server');
   * ```
   */
  async connect(): Promise<void> {
    // Return existing connection promise if already connecting
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    // Already connected
    if (this.socket?.connected) {
      return Promise.resolve();
    }

    this.ensureSocketClient();

    this.connectionPromise = new Promise(async (resolve, reject) => {
      try {
        const token = await this.getAuthToken();
        const baseUrl = this.socketUrl || this.client.getBaseUrl();

        this.socket = this.socketClient!(baseUrl, {
          auth: { token: token || undefined },
          path: this.socketPath,
          transports: ["websocket", "polling"],
          reconnection: true,
          reconnectionAttempts: 10,
          reconnectionDelay: 1000,
          timeout: 20000,
        });

        // Connection events
        this.socket.on("connect", () => {
          console.log("[Baasix Realtime] Connected");
          this.reconnecting = false;
          this.notifyConnectionChange(true);
          resolve();
        });

        this.socket.on("disconnect", (reason: string) => {
          console.log("[Baasix Realtime] Disconnected:", reason);
          this.notifyConnectionChange(false);
        });

        this.socket.on("connect_error", (error: Error) => {
          console.error("[Baasix Realtime] Connection error:", error.message);
          if (!this.reconnecting) {
            reject(error);
          }
        });

        this.socket.on("reconnect", () => {
          console.log("[Baasix Realtime] Reconnected");
          this.reconnecting = false;
          // Re-subscribe to all collections
          this.resubscribeAll();
          this.notifyConnectionChange(true);
        });

        this.socket.on("reconnect_attempt", () => {
          this.reconnecting = true;
        });

        // Initial connected event from server
        this.socket.on("connected", (data: { userId: string; tenant: any }) => {
          console.log("[Baasix Realtime] Authenticated as user:", data.userId);
        });

        // Workflow execution events
        this.socket.on("workflow:execution:update", (data: WorkflowExecutionUpdate) => {
          this.handleWorkflowUpdate(data);
        });

        this.socket.on("workflow:execution:complete", (data: WorkflowExecutionUpdate) => {
          this.handleWorkflowUpdate({ ...data, status: "complete" });
        });

        this.socket.connect();
      } catch (error) {
        this.connectionPromise = null;
        reject(error);
      }
    });

    try {
      await this.connectionPromise;
    } finally {
      this.connectionPromise = null;
    }
  }

  /**
   * Disconnect from the realtime server
   * 
   * @example
   * ```typescript
   * baasix.realtime.disconnect();
   * ```
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.subscriptions.clear();
    this.workflowCallbacks.clear();
  }

  /**
   * Check if connected to the realtime server
   */
  get isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  /**
   * Subscribe to connection state changes
   * 
   * @example
   * ```typescript
   * const unsubscribe = baasix.realtime.onConnectionChange((connected) => {
   *   console.log('Connection state:', connected ? 'online' : 'offline');
   * });
   * ```
   */
  onConnectionChange(callback: (connected: boolean) => void): () => void {
    this.connectionCallbacks.add(callback);
    return () => {
      this.connectionCallbacks.delete(callback);
    };
  }

  private notifyConnectionChange(connected: boolean): void {
    this.connectionCallbacks.forEach((callback) => callback(connected));
  }

  /**
   * Subscribe to a collection for real-time updates
   * 
   * @example
   * ```typescript
   * // Subscribe to all changes
   * const unsubscribe = baasix.realtime.subscribe('products', (payload) => {
   *   console.log(`${payload.action}:`, payload.data);
   * });
   * 
   * // Subscribe to specific events
   * const unsubscribe = baasix.realtime.subscribe('orders', (payload) => {
   *   if (payload.action === 'create') {
   *     console.log('New order:', payload.data);
   *   }
   * });
   * 
   * // Unsubscribe when done
   * unsubscribe();
   * ```
   */
  subscribe<T extends BaseItem = BaseItem>(
    collection: string,
    callback: SubscriptionCallback<T>
  ): () => void {
    if (!this.socket?.connected) {
      console.warn("[Baasix Realtime] Not connected. Call connect() first.");
    }

    // Generate unique callback ID
    const callbackId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Get or create subscription
    let subscription = this.subscriptions.get(collection);
    if (!subscription) {
      subscription = {
        collection,
        callbacks: new Map(),
      };
      this.subscriptions.set(collection, subscription);

      // Subscribe on server
      this.subscribeOnServer(collection);

      // Set up event listeners for this collection
      this.setupCollectionListeners(collection);
    }

    // Add callback
    subscription.callbacks.set(callbackId, callback as SubscriptionCallback);

    // Return unsubscribe function
    return () => {
      const sub = this.subscriptions.get(collection);
      if (sub) {
        sub.callbacks.delete(callbackId);

        // If no more callbacks, unsubscribe from server
        if (sub.callbacks.size === 0) {
          this.unsubscribeOnServer(collection);
          this.removeCollectionListeners(collection);
          this.subscriptions.delete(collection);
        }
      }
    };
  }

  /**
   * Subscribe to specific events on a collection
   * 
   * @example
   * ```typescript
   * // Only listen for creates
   * const unsubscribe = baasix.realtime.on('products', 'create', (data) => {
   *   console.log('New product:', data);
   * });
   * ```
   */
  on<T extends BaseItem = BaseItem>(
    collection: string,
    event: SubscriptionEvent,
    callback: (data: T) => void
  ): () => void {
    return this.subscribe<T>(collection, (payload) => {
      if (payload.action === event) {
        callback(payload.data);
      }
    });
  }

  /**
   * Listen to all changes across all subscribed collections
   * 
   * @example
   * ```typescript
   * const unsubscribe = baasix.realtime.onAny((collection, payload) => {
   *   console.log(`${collection}:${payload.action}`, payload.data);
   * });
   * ```
   */
  onAny(callback: (collection: string, payload: SubscriptionPayload) => void): () => void {
    const unsubscribers: (() => void)[] = [];

    this.subscriptions.forEach((_, collection) => {
      const unsub = this.subscribe(collection, (payload) => {
        callback(collection, payload);
      });
      unsubscribers.push(unsub);
    });

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }

  private subscribeOnServer(collection: string): void {
    if (this.socket?.connected) {
      this.socket.emit("subscribe", { collection }, (response: any) => {
        if (response.status === "error") {
          console.error(`[Baasix Realtime] Failed to subscribe to ${collection}:`, response.message);
        }
      });
    }
  }

  private unsubscribeOnServer(collection: string): void {
    if (this.socket?.connected) {
      this.socket.emit("unsubscribe", { collection });
    }
  }

  private setupCollectionListeners(collection: string): void {
    if (!this.socket) return;

    const events: SubscriptionEvent[] = ["create", "update", "delete"];
    events.forEach((event) => {
      const eventName = `${collection}:${event}`;
      this.socket!.on(eventName, (payload: SubscriptionPayload) => {
        this.handleCollectionEvent(collection, payload);
      });
    });
  }

  private removeCollectionListeners(collection: string): void {
    if (!this.socket) return;

    const events: SubscriptionEvent[] = ["create", "update", "delete"];
    events.forEach((event) => {
      const eventName = `${collection}:${event}`;
      this.socket!.off(eventName);
    });
  }

  private handleCollectionEvent(collection: string, payload: SubscriptionPayload): void {
    const subscription = this.subscriptions.get(collection);
    if (subscription) {
      subscription.callbacks.forEach((callback) => {
        try {
          callback(payload);
        } catch (error) {
          console.error(`[Baasix Realtime] Error in subscription callback:`, error);
        }
      });
    }
  }

  private resubscribeAll(): void {
    this.subscriptions.forEach((_, collection) => {
      this.subscribeOnServer(collection);
      this.setupCollectionListeners(collection);
    });
  }

  // ===================
  // Workflow Realtime
  // ===================

  /**
   * Join a workflow execution room to receive real-time updates
   * 
   * @example
   * ```typescript
   * const unsubscribe = baasix.realtime.subscribeToExecution(executionId, (update) => {
   *   console.log('Execution update:', update);
   *   if (update.status === 'complete') {
   *     console.log('Workflow finished!');
   *   }
   * });
   * ```
   */
  subscribeToExecution(
    executionId: string | number,
    callback: (data: WorkflowExecutionUpdate) => void
  ): () => void {
    const id = String(executionId);

    // Join execution room
    if (this.socket?.connected) {
      this.socket.emit("workflow:execution:join", { executionId: id });
    }

    // Add callback
    let callbacks = this.workflowCallbacks.get(id);
    if (!callbacks) {
      callbacks = new Set();
      this.workflowCallbacks.set(id, callbacks);
    }
    callbacks.add(callback);

    // Return unsubscribe function
    return () => {
      const cbs = this.workflowCallbacks.get(id);
      if (cbs) {
        cbs.delete(callback);
        if (cbs.size === 0) {
          this.workflowCallbacks.delete(id);
        }
      }
    };
  }

  private handleWorkflowUpdate(data: WorkflowExecutionUpdate): void {
    const id = String(data.executionId);
    const callbacks = this.workflowCallbacks.get(id);
    if (callbacks) {
      callbacks.forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          console.error(`[Baasix Realtime] Error in workflow callback:`, error);
        }
      });
    }
  }

  // ===================
  // Channel (Room) API - Supabase-style
  // ===================

  /**
   * Create a channel for a collection (Supabase-style API)
   * 
   * @example
   * ```typescript
   * const channel = baasix.realtime
   *   .channel('products')
   *   .on('INSERT', (payload) => console.log('New:', payload))
   *   .on('UPDATE', (payload) => console.log('Updated:', payload))
   *   .on('DELETE', (payload) => console.log('Deleted:', payload))
   *   .subscribe();
   * 
   * // Later
   * channel.unsubscribe();
   * ```
   */
  channel(collection: string): RealtimeChannel {
    return new RealtimeChannel(this, collection);
  }
}

/**
 * Chainable channel for Supabase-style subscription API
 */
export class RealtimeChannel {
  private realtime: RealtimeModule;
  private collection: string;
  private handlers: Map<SubscriptionEvent, ((data: any) => void)[]> = new Map();
  private unsubscribeFn: (() => void) | null = null;

  constructor(realtime: RealtimeModule, collection: string) {
    this.realtime = realtime;
    this.collection = collection;
  }

  /**
   * Add an event handler (chainable)
   * 
   * @param event - 'INSERT', 'UPDATE', 'DELETE', or '*' for all
   * @param callback - Handler function
   */
  on(event: "INSERT" | "UPDATE" | "DELETE" | "*", callback: (payload: any) => void): this {
    const mappedEvent = this.mapEvent(event);
    
    if (mappedEvent === "*") {
      // Add to all events
      (["create", "update", "delete"] as SubscriptionEvent[]).forEach((e) => {
        this.addHandler(e, callback);
      });
    } else {
      this.addHandler(mappedEvent, callback);
    }

    return this;
  }

  private mapEvent(event: string): SubscriptionEvent | "*" {
    switch (event.toUpperCase()) {
      case "INSERT":
        return "create";
      case "UPDATE":
        return "update";
      case "DELETE":
        return "delete";
      default:
        return "*";
    }
  }

  private addHandler(event: SubscriptionEvent, callback: (data: any) => void): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event)!.push(callback);
  }

  /**
   * Start the subscription
   */
  subscribe(): this {
    this.unsubscribeFn = this.realtime.subscribe(this.collection, (payload) => {
      const handlers = this.handlers.get(payload.action);
      if (handlers) {
        handlers.forEach((handler) => {
          try {
            handler(payload);
          } catch (error) {
            console.error("[Baasix Channel] Handler error:", error);
          }
        });
      }
    });

    return this;
  }

  /**
   * Stop the subscription
   */
  unsubscribe(): void {
    if (this.unsubscribeFn) {
      this.unsubscribeFn();
      this.unsubscribeFn = null;
    }
    this.handlers.clear();
  }
}

export type { Socket, SocketIOClient };
