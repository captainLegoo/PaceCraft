import { connectGarmin, disconnectGarmin, getGarminAuthStatus } from "../garmin/auth.ts";
import { syncGarminActivities } from "../garmin/sync.ts";
import type { GarminRegion } from "../garmin/types.ts";
import type { ProviderSyncOptions, ProviderSyncResult, WatchProvider } from "./types.ts";

export class GarminProvider implements WatchProvider {
  readonly id: string;
  readonly brand = "garmin" as const;
  readonly name: string;
  readonly icon: string;
  readonly region: GarminRegion;

  constructor(region: GarminRegion) {
    this.region = region;
    this.id = `garmin_${region}`;
    this.name = region === "cn" ? "佳明 (中国区)" : "佳明 (国际区)";
    this.icon = region === "cn" ? "🇨🇳" : "🌐";
  }

  isConnected(): boolean {
    const status = getGarminAuthStatus(this.region);
    return Boolean(status.connected);
  }

  getAuthStatus() {
    return getGarminAuthStatus(this.region);
  }

  async connect(credentials: { apiKey: string }): Promise<any> {
    if (!credentials?.apiKey) throw new Error("请输入 Garmin Personal API Key");
    return await connectGarmin(credentials.apiKey, this.region);
  }

  async disconnect(): Promise<{ ok: boolean }> {
    return disconnectGarmin(this.region);
  }

  async sync(options?: ProviderSyncOptions): Promise<ProviderSyncResult> {
    const limit = options?.limit ?? 365; // 默认覆盖整整 1 年
    const res = await syncGarminActivities({
      region: this.region,
      limit,
    });

    return {
      providerId: this.id,
      brand: this.brand,
      syncedCount: res.syncedCount,
      newActivities: res.newActivities,
      fitDownloaded: res.fitDownloaded,
    };
  }
}

export const garminCnProvider = new GarminProvider("cn");
export const garminGlobalProvider = new GarminProvider("global");
