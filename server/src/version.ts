import pkg from "../../package.json";
import { execSync } from "node:child_process";

export function resolveAppVersion(): string {
  if (process.env.APP_VERSION) {
    const v = process.env.APP_VERSION.trim();
    return v.startsWith("v") ? v : `v${v}`;
  }
  try {
    const tag = execSync("git describe --tags --exact-match", {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    }).toString().trim();
    if (tag) return tag.startsWith("v") ? tag : `v${tag}`;
  } catch {}

  if (pkg.version) {
    return pkg.version.startsWith("v") ? pkg.version : `v${pkg.version}`;
  }

  try {
    const desc = execSync("git describe --tags --always", {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    }).toString().trim();
    if (desc) return desc.startsWith("v") ? desc : `v${desc}`;
  } catch {}

  return "v0.1.0";
}

export const APP_VERSION = resolveAppVersion();
