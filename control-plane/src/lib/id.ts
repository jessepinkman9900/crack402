import type { Random } from "./random";
import { realRandom } from "./random";

export function generateSandboxId(random: Random = realRandom): string {
  return random.id("sbx_");
}

export function generateExecId(random: Random = realRandom): string {
  return random.id("exec_");
}

export function generateSnapshotId(random: Random = realRandom): string {
  return random.id("snap_");
}

export function generateNodeId(random: Random = realRandom): string {
  return random.id("node_");
}

export function generateCommandId(random: Random = realRandom): string {
  return random.id("cmd_");
}

export function generateWebhookId(random: Random = realRandom): string {
  return random.id("wh_");
}

export function generateTenantId(random: Random = realRandom): string {
  return random.id("ten_");
}

export function generateApiKeyToken(random: Random = realRandom): string {
  return random.id("sk_");
}
