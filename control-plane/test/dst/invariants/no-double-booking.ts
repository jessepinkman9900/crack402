import type { InvariantFn } from "../framework/invariant-checker";

/**
 * The GlobalSchedulerDO must never allocate more resources than a node actually has.
 */
export const noDoubleBooking: InvariantFn = (world) => {
  // Check each node in the scheduler
  // We can't easily call async methods synchronously, so we check using
  // the SimSandbox data which should mirror scheduler state
  for (const [nodeId, node] of world.nodes) {
    const sandboxesOnNode = Array.from(world.sandboxes.values())
      .filter((s) => s.nodeId === nodeId && !s.destroyed);

    let totalVcpu = 0;
    let totalMem = 0;
    for (const sbx of sandboxesOnNode) {
      const stateData = sbx.storage.getAllData().get("state") as any;
      if (stateData) {
        totalVcpu += stateData.vcpu || 0;
        totalMem += stateData.memoryMb || 0;
      }
    }

    if (totalVcpu > node.totalVcpu) {
      return {
        invariant: "no-double-booking",
        message: `Node ${nodeId} has ${totalVcpu} vCPU allocated but only has ${node.totalVcpu} total`,
        details: { nodeId, allocatedVcpu: totalVcpu, totalVcpu: node.totalVcpu },
      };
    }

    if (totalMem > node.totalMemoryMb) {
      return {
        invariant: "no-double-booking",
        message: `Node ${nodeId} has ${totalMem}MB allocated but only has ${node.totalMemoryMb}MB total`,
        details: { nodeId, allocatedMem: totalMem, totalMem: node.totalMemoryMb },
      };
    }
  }
  return null;
};
