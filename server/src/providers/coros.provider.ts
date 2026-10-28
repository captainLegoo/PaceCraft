import { getAuthStatus, disconnectAuth } from "../coros/auth-service.ts";
import { syncAll } from "../coros/sync.ts";
import type { ProviderSyncOptions, ProviderSyncResult, WatchProvider } from "./types.ts";

export class CorosProvider implements WatchProvider {
  readonly id = "coros";
  readonly brand = "coros" as const;
  readonly name = "高驰 (COROS)";
  readonly icon = "🏃";

  isConnected(): boolean {
    const status = getAuthStatus();
    return Boolean(status.connected);
  }

  getAuthStatus() {
    return getAuthStatus();
  }

  async connect(credentials: any): Promise<any> {
    // 高驰走标准 OAuth 重定向交互，无需手动入参
    return getAuthStatus();
  }

  async disconnect(): Promise<{ ok: boolean }> {
    return await disconnectAuth();
  }

  async sync(options?: ProviderSyncOptions): Promise<ProviderSyncResult> {
    const days = options?.days ?? 365; // 默认完整回溯 1 年
    const res = await syncAll({
      days,
      withLaps: true,
      onProgress: (p) => {
        options?.onProgress?.({
          percent: p.percent,
          message: p.message,
          current: p.current,
          total: p.total,
        });
      },
    });

    return {
      providerId: this.id,
      brand: this.brand,
      syncedCount: res.activities,
      newActivities: res.activities,
      lapRows: res.lapRows,
      errors: res.errors,
    };
  }
}
