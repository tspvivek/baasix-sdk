import type { HttpClient } from "../client";
import type { Aggregate, Filter, ReportConfig, ReportResult } from "../types";

export interface ReportsModuleConfig {
  client: HttpClient;
}

/**
 * Reports module for generating analytics and reports.
 *
 * @example
 * ```typescript
 * // Generate sales report grouped by category
 * const report = await baasix.reports.generate('orders', {
 *   aggregate: {
 *     totalSales: { function: 'sum', field: 'total' },
 *     orderCount: { function: 'count', field: 'id' },
 *     avgOrderValue: { function: 'avg', field: 'total' }
 *   },
 *   groupBy: 'category',
 *   filter: { status: { eq: 'completed' } },
 *   dateRange: {
 *     start: '2025-01-01',
 *     end: '2025-12-31',
 *     field: 'createdAt'
 *   }
 * });
 * ```
 */
export class ReportsModule {
  private client: HttpClient;

  constructor(config: ReportsModuleConfig) {
    this.client = config.client;
  }

  /**
   * Generate a report for a collection
   *
   * @example
   * ```typescript
   * // Sales by month
   * const report = await baasix.reports.generate('orders', {
   *   aggregate: {
   *     revenue: { function: 'sum', field: 'total' },
   *     orders: { function: 'count', field: 'id' }
   *   },
   *   groupBy: 'month',
   *   dateRange: {
   *     start: '2025-01-01',
   *     end: '2025-12-31'
   *   }
   * });
   * ```
   */
  async generate(
    collection: string,
    config: Omit<ReportConfig, "collection">
  ): Promise<ReportResult> {
    const response = await this.client.post<ReportResult>(
      `/reports/${collection}`,
      config
    );
    return response;
  }

  /**
   * Get collection statistics
   *
   * @example
   * ```typescript
   * const stats = await baasix.reports.getStats('products');
   * console.log(stats.totalCount, stats.recentCount);
   * ```
   */
  async getStats(
    collection: string,
    options?: {
      timeframe?: "24h" | "7d" | "30d" | "90d" | "1y";
    }
  ): Promise<{
    totalCount: number;
    recentCount: number;
    deletedCount?: number;
    byDate?: Record<string, number>;
  }> {
    const response = await this.client.get<{
      data: {
        totalCount: number;
        recentCount: number;
        deletedCount?: number;
        byDate?: Record<string, number>;
      };
    }>(`/reports/${collection}/stats`, {
      params: options as Record<string, unknown>,
    });
    return response.data;
  }

  /**
   * Generate an aggregation query
   *
   * @example
   * ```typescript
   * const results = await baasix.reports.aggregate('orders', {
   *   aggregate: {
   *     total: { function: 'sum', field: 'amount' },
   *     count: { function: 'count', field: 'id' },
   *     min: { function: 'min', field: 'amount' },
   *     max: { function: 'max', field: 'amount' },
   *     avg: { function: 'avg', field: 'amount' }
   *   },
   *   groupBy: ['status', 'paymentMethod'],
   *   filter: { createdAt: { gte: '$NOW-DAYS_30' } }
   * });
   * ```
   */
  async aggregate(
    collection: string,
    options: {
      aggregate: Aggregate;
      groupBy?: string[];
      filter?: Filter;
    }
  ): Promise<Record<string, unknown>[]> {
    const response = await this.client.get<{ data: Record<string, unknown>[] }>(
      `/items/${collection}`,
      {
        params: {
          aggregate: options.aggregate,
          groupBy: options.groupBy,
          filter: options.filter,
          limit: -1,
        },
      }
    );
    return response.data;
  }

  /**
   * Count items matching a filter
   *
   * @example
   * ```typescript
   * const activeUsers = await baasix.reports.count('users', {
   *   status: { eq: 'active' }
   * });
   * ```
   */
  async count(collection: string, filter?: Filter): Promise<number> {
    const response = await this.client.get<{ data: unknown[]; totalCount: number }>(
      `/items/${collection}`,
      {
        params: {
          filter,
          limit: 0,
        },
      }
    );
    return response.totalCount || 0;
  }

  /**
   * Get distinct values for a field
   *
   * @example
   * ```typescript
   * const categories = await baasix.reports.distinct('products', 'category');
   * ```
   */
  async distinct(
    collection: string,
    field: string,
    filter?: Filter
  ): Promise<unknown[]> {
    const response = await this.client.get<{ data: Record<string, unknown>[] }>(
      `/items/${collection}`,
      {
        params: {
          filter,
          fields: [field],
          groupBy: [field],
          limit: -1,
        },
      }
    );
    return response.data.map((item) => item[field]);
  }
}

// Re-export types
export type { Aggregate, Filter, ReportConfig, ReportResult };
