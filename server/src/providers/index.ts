import { CorosProvider } from "./coros.provider.ts";
import { garminCnProvider, garminGlobalProvider } from "./garmin.provider.ts";
import { registry } from "./registry.ts";

export * from "./types.ts";
export * from "./registry.ts";

// 注册卡槽式数据源
registry.register(new CorosProvider());
registry.register(garminCnProvider);
registry.register(garminGlobalProvider);

export { registry };
