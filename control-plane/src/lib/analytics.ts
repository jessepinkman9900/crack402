/**
 * Typed write helpers for Analytics Engine datasets.
 * All writes are fire-and-forget (no await).
 */

export type SandboxLifecyclePoint = {
  tenantId: string;
  sandboxId: string;
  fromStatus: string;
  toStatus: string;
  event: string;
  baseImage: string;
  nodeId: string;
  region: string;
  networkPolicy: string;
  vcpu: number;
  memoryMb: number;
  durationMs: number;
};

export function writeSandboxLifecyclePoint(
  dataset: AnalyticsEngineDataset,
  data: SandboxLifecyclePoint
): void {
  dataset.writeDataPoint({
    indexes: [data.tenantId],
    blobs: [
      data.sandboxId,      // blob1
      data.fromStatus,     // blob2
      data.toStatus,       // blob3
      data.event,          // blob4
      data.baseImage,      // blob5
      data.nodeId,         // blob6
      data.region,         // blob7
      data.networkPolicy,  // blob8
    ],
    doubles: [
      data.vcpu,                                       // double1
      data.memoryMb,                                   // double2
      data.durationMs,                                 // double3
      data.toStatus === "error" ? 1.0 : 0.0,          // double4
      data.toStatus === "destroyed" ? 1.0 : 0.0,      // double5
    ],
  });
}

export type ExecResultPoint = {
  tenantId: string;
  execId: string;
  sandboxId: string;
  execType: string;
  status: string;
  nodeId: string;
  durationMs: number;
  exitCode: number;
  stdoutBytes: number;
  stderrBytes: number;
};

export function writeExecResultPoint(
  dataset: AnalyticsEngineDataset,
  data: ExecResultPoint
): void {
  const success = data.status === "completed" && data.exitCode === 0 ? 1.0 : 0.0;
  const failed = data.status === "failed" ? 1.0 : 0.0;
  const timedOut = data.status === "timed_out" ? 1.0 : 0.0;

  dataset.writeDataPoint({
    indexes: [data.tenantId],
    blobs: [
      data.execId,    // blob1
      data.sandboxId, // blob2
      data.execType,  // blob3
      data.status,    // blob4
      data.nodeId,    // blob5
    ],
    doubles: [
      data.durationMs,   // double1
      data.exitCode,     // double2
      success,           // double3
      failed,            // double4
      timedOut,          // double5
      data.stdoutBytes,  // double6
      data.stderrBytes,  // double7
    ],
  });
}

export type BillingUsagePoint = {
  tenantId: string;
  sandboxId: string;
  finalStatus: string;
  region: string;
  baseImage: string;
  nodeId: string;
  vcpu: number;
  memoryMb: number;
  uptimeMs: number;
  costMicroUsd: number;
};

export function writeBillingUsagePoint(
  dataset: AnalyticsEngineDataset,
  data: BillingUsagePoint
): void {
  const vcpuSeconds = (data.vcpu * data.uptimeMs) / 1000;
  const memoryGbSeconds = ((data.memoryMb / 1024) * data.uptimeMs) / 1000;

  dataset.writeDataPoint({
    indexes: [data.tenantId],
    blobs: [
      data.sandboxId,   // blob1
      data.finalStatus, // blob2
      data.region,      // blob3
      data.baseImage,   // blob4
      data.nodeId,      // blob5
    ],
    doubles: [
      data.vcpu,            // double1
      data.memoryMb,        // double2
      data.uptimeMs,        // double3
      vcpuSeconds,          // double4
      memoryGbSeconds,      // double5
      data.costMicroUsd,    // double6
    ],
  });
}
