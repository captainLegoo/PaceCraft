export type GarminRegion = "global" | "cn";

export type GarminTokenSet = {
  apiKey: string;
  accessToken: string;
  expiresAt: number; // epoch seconds
  region: GarminRegion;
  garminGuid?: string;
  userFullName?: string;
  ownerDisplayName?: string;
};

export type GarminTokensMap = {
  cn?: GarminTokenSet;
  global?: GarminTokenSet;
};

export type GarminAuthStatus = {
  connected: boolean;
  region: GarminRegion | null;
  userFullName: string | null;
  garminGuid: string | null;
  expiresAt: number | null;
  expired: boolean;
};

export type GarminMultiAuthStatus = {
  connected: boolean; // 只要 cn 或 global 任一已连接即为 true
  cn: GarminAuthStatus;
  global: GarminAuthStatus;
};

export type GarminActivitySummary = {
  activityId: number;
  activityName: string;
  startTimeLocal: string; // "2021-09-20 19:09:21"
  startTimeGMT: string;
  activityType: {
    typeId: number;
    typeKey: string;
    parentTypeId?: number;
  };
  distance: number; // meters
  duration: number; // seconds
  elapsedDuration?: number;
  movingDuration?: number;
  elevationGain?: number;
  elevationLoss?: number;
  averageSpeed?: number; // m/s
  maxSpeed?: number;
  startLatitude?: number;
  startLongitude?: number;
  endLatitude?: number;
  endLongitude?: number;
  calories?: number;
  averageHR?: number;
  maxHR?: number;
  averageRunningCadenceInStepsPerMinute?: number;
  maxRunningCadenceInStepsPerMinute?: number;
  steps?: number;
  beginTimestamp: number; // epoch ms
  sportTypeId?: number;
  aerobicTrainingEffect?: number;
  avgStrideLength?: number; // cm
  locationName?: string;
  lapCount?: number;
  ownerFullName?: string;
  ownerDisplayName?: string;
};
