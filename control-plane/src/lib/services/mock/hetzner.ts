import type { CloudProviderAdapter, CloudServer, ServerCreationOptions, RegionPricing, ServerTypeInfo } from "../types";
import * as state from "./state";

/**
 * Mock cloud provider adapter (simulates Hetzner).
 * Returns fake server objects and simulates state transitions.
 */
export const mockHetzner: CloudProviderAdapter = {
  getProviderName(): string {
    return "hetzner";
  },

  async listAvailableServerTypes(): Promise<ServerTypeInfo[]> {
    return [
      {
        name: 'cx23',
        vcpus: 2,
        memory: 4,
        storage: 40,
        priceHourly: 0.004034,
        availability: ['nbg1', 'fsn1', 'hel1']
      },
      {
        name: 'cx33',
        vcpus: 4,
        memory: 8,
        storage: 80,
        priceHourly: 0.008067,
        availability: ['nbg1', 'fsn1', 'hel1']
      }
    ];
  },

  async getCheapestRegion(_serverType): Promise<RegionPricing> {
    // cx23 in EU is ~$0.004034/hr net — realistic placeholder for billing
    return { region: "nbg1", priceHourly: 0.004034 };
  },

  async createServer(opts: ServerCreationOptions): Promise<CloudServer> {
    const id = state.nextServerId();
    const server: CloudServer = {
      id,
      name: opts.name,
      status: "initializing",
      publicIp: `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
      region: opts.region,
      serverType: opts.serverType ?? "cx23",
      provider: "hetzner"
    };
    state.setServer(server);

    // Simulate provisioning delay — mark as running after a short delay
    // In Workers, we can't use setTimeout easily, so we just set it immediately
    // The bot route handler will handle the state transition
    setTimeout(() => {
      const s = state.getServer(id);
      if (s && s.status === "initializing") {
        s.status = "running";
        state.setServer(s);
      }
    }, 0);

    return server;
  },

  async deleteServer(serverId) {
    const server = state.getServer(serverId);
    if (server) {
      server.status = "deleting";
      state.setServer(server);
      // Immediately remove from state
      state.deleteServer(serverId);
    }
  },

  async getServer(serverId): Promise<CloudServer | null> {
    return state.getServer(serverId);
  },
};
