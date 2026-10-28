import type { ProviderSyncOptions, ProviderSyncResult, WatchProvider } from "./types.ts";

export class ProviderRegistry {
  private providers: Map<string, WatchProvider> = new Map();

  register(provider: WatchProvider) {
    this.providers.set(provider.id, provider);
  }

  get(id: string): WatchProvider | undefined {
    return this.providers.get(id);
  }

  getAll(): WatchProvider[] {
    return Array.from(this.providers.values());
  }

  async getActive(): Promise<WatchProvider[]> {
    const all = this.getAll();
    const active: WatchProvider[] = [];
    for (const p of all) {
      if (await p.isConnected()) {
        active.push(p);
      }
    }
    return active;
  }

  async syncOne(id: string, options?: ProviderSyncOptions): Promise<ProviderSyncResult> {
    const provider = this.get(id);
    if (!provider) throw new Error(`未找到手表数据源适配器: ${id}`);
    const connected = await provider.isConnected();
    if (!connected) throw new Error(`${provider.name} 尚未连接`);
    return await provider.sync(options);
  }

  async syncAll(options?: ProviderSyncOptions): Promise<ProviderSyncResult[]> {
    const active = await this.getActive();
    if (active.length === 0) {
      throw new Error("当前未连接任何运动手表设备");
    }

    const results: ProviderSyncResult[] = [];
    const totalProviders = active.length;

    for (let i = 0; i < totalProviders; i++) {
      const provider = active[i];
      options?.onProgress?.({
        percent: Math.round((i / totalProviders) * 100),
        message: `正在同步 ${provider.name} (${i + 1}/${totalProviders})...`,
      });

      try {
        const res = await provider.sync({
          ...options,
          onProgress: (p) => {
            const scaledPercent = Math.round((i / totalProviders) * 100 + (p.percent / totalProviders));
            options?.onProgress?.({
              ...p,
              percent: scaledPercent,
              message: `${provider.name}: ${p.message}`,
            });
          },
        });
        results.push(res);
      } catch (err) {
        console.error(`同步 ${provider.name} 失败:`, err);
        results.push({
          providerId: provider.id,
          brand: provider.brand,
          syncedCount: 0,
          newActivities: 0,
          errors: [(err as Error).message],
        });
      }
    }

    return results;
  }
}

export const registry = new ProviderRegistry();
