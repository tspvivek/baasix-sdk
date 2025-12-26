import type { HttpClient } from "../client";

export interface MigrationsModuleConfig {
  client: HttpClient;
}

export interface MigrationStatus {
  lastBatch: number;
  totalMigrations: number;
  pendingCount: number;
  completedCount: number;
  hasPending: boolean;
}

export interface Migration {
  id: string;
  name: string;
  batch: number;
  migratedAt: string;
}

export interface PendingMigration {
  name: string;
  path?: string;
}

export interface MigrationResult {
  success: boolean;
  migrationsRun: string[];
  errors?: string[];
}

export interface RollbackResult {
  success: boolean;
  migrationsRolledBack: string[];
  errors?: string[];
}

/**
 * Migrations module for managing database schema migrations.
 * Admin access required for all operations.
 * 
 * @example
 * ```typescript
 * // Check migration status
 * const status = await baasix.migrations.status();
 * 
 * // Run pending migrations
 * if (status.hasPending) {
 *   await baasix.migrations.run();
 * }
 * ```
 */
export class MigrationsModule {
  private client: HttpClient;

  constructor(config: MigrationsModuleConfig) {
    this.client = config.client;
  }

  /**
   * Get migration status
   * 
   * @example
   * ```typescript
   * const status = await baasix.migrations.status();
   * console.log(`Pending migrations: ${status.pendingCount}`);
   * ```
   */
  async status(): Promise<MigrationStatus> {
    const response = await this.client.get<{ data: MigrationStatus }>(
      "/migrations/status"
    );
    return response.data;
  }

  /**
   * Get all completed migrations
   * 
   * @example
   * ```typescript
   * const migrations = await baasix.migrations.list();
   * ```
   */
  async list(): Promise<Migration[]> {
    const response = await this.client.get<{ data: Migration[] }>("/migrations");
    return response.data;
  }

  /**
   * Get pending migrations
   * 
   * @example
   * ```typescript
   * const pending = await baasix.migrations.pending();
   * ```
   */
  async pending(): Promise<PendingMigration[]> {
    const response = await this.client.get<{ data: PendingMigration[] }>(
      "/migrations/pending"
    );
    return response.data;
  }

  /**
   * Check if there are pending migrations
   * 
   * @example
   * ```typescript
   * const needsMigration = await baasix.migrations.hasPending();
   * ```
   */
  async hasPending(): Promise<boolean> {
    const response = await this.client.get<{ data: { hasPending: boolean } }>(
      "/migrations/check"
    );
    return response.data.hasPending;
  }

  /**
   * Get a specific migration by name
   * 
   * @example
   * ```typescript
   * const migration = await baasix.migrations.get('20231201_create_users');
   * ```
   */
  async get(name: string): Promise<Migration | null> {
    try {
      const response = await this.client.get<{ data: Migration }>(
        `/migrations/${encodeURIComponent(name)}`
      );
      return response.data;
    } catch {
      return null;
    }
  }

  /**
   * Run pending migrations
   * 
   * @example
   * ```typescript
   * const result = await baasix.migrations.run();
   * console.log(`Ran ${result.migrationsRun.length} migrations`);
   * ```
   */
  async run(): Promise<MigrationResult> {
    const response = await this.client.post<{ data: MigrationResult }>(
      "/migrations/run",
      {}
    );
    return response.data;
  }

  /**
   * Rollback a specific migration
   * 
   * @example
   * ```typescript
   * const result = await baasix.migrations.rollback('20231201_create_users');
   * ```
   */
  async rollback(name: string): Promise<RollbackResult> {
    const response = await this.client.post<{ data: RollbackResult }>(
      "/migrations/rollback",
      { name }
    );
    return response.data;
  }

  /**
   * Rollback the last batch of migrations
   * 
   * @example
   * ```typescript
   * const result = await baasix.migrations.rollbackLast();
   * ```
   */
  async rollbackLast(): Promise<RollbackResult> {
    const response = await this.client.post<{ data: RollbackResult }>(
      "/migrations/rollback-last",
      {}
    );
    return response.data;
  }

  /**
   * Create a new migration file
   * 
   * @example
   * ```typescript
   * const migrationName = await baasix.migrations.create('add_status_column');
   * ```
   */
  async create(name: string): Promise<string> {
    const response = await this.client.post<{ data: { name: string } }>(
      "/migrations/create",
      { name }
    );
    return response.data.name;
  }

  /**
   * Mark a migration as complete (without running it)
   * 
   * @example
   * ```typescript
   * await baasix.migrations.markComplete('20231201_create_users');
   * ```
   */
  async markComplete(name: string): Promise<void> {
    await this.client.post("/migrations/mark-complete", { name });
  }

  /**
   * Mark all pending migrations as complete
   * 
   * @example
   * ```typescript
   * await baasix.migrations.markAllComplete();
   * ```
   */
  async markAllComplete(): Promise<void> {
    await this.client.post("/migrations/mark-all-complete", {});
  }
}
