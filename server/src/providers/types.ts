export interface ProviderSyncOptions {
  days?: number;
  limit?: number;
  onProgress?: (progress: {
    percent: number;
    message: string;
    current?: number;
    total?: number;
    startedAt?: number;
  }) => void;
}

export interface ProviderSyncResult {
  providerId: string;
  brand: string;
  syncedCount: number;
  newActivities: number;
  fitDownloaded?: number;
  lapRows?: number;
  errors?: string[];
}

export interface WatchProvider {
  readonly id: string; // e.g. "coros", "garmin_cn", "garmin_global"
  readonly brand: "coros" | "garmin" | "suunto" | "other";
  readonly name: string;
  readonly icon: string;

  /** 是否已完成授权绑定 */
  isConnected(): Promise<boolean> | boolean;

  /** 获取当前授权状态 */
  getAuthStatus(): Promise<any> | any;

  /** 执行授权连接 */
  connect(credentials: any): Promise<any>;

  /** 解除授权绑定 */
  disconnect(): Promise<{ ok: boolean }>;

  /** 执行全量/增量同步 */
  sync(options?: ProviderSyncOptions): Promise<ProviderSyncResult>;
}
