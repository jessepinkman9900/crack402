import type { CloudProviderAdapter, CloudServer, ServerCreationOptions, RegionPricing, ServerTypeInfo } from "./types";
import type { HetznerBindings } from "../../types";

/**
 * Real Hetzner Cloud adapter.
 * Calls the Hetzner API to manage servers.
 */
export function createHetznerAdapter(env: HetznerBindings): CloudProviderAdapter {
  const apiKey = env.HETZNER_MANGEMENT_API_KEY;
  const baseUrl = "https://api.hetzner.cloud/v1";

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  return {
    getProviderName(): string {
      return "hetzner";
    },

    async listAvailableServerTypes(): Promise<ServerTypeInfo[]> {
      try {
        const res = await fetch(`${baseUrl}/server_types`, { headers });
        if (!res.ok) {
          console.warn(`[hetzner] listAvailableServerTypes: API returned ${res.status}`);
          return [];
        }
        const data = (await res.json()) as any;
        const serverTypes: any[] = data.server_types ?? [];

        return serverTypes.map((st: any) => ({
          name: st.name,
          vcpus: st.cores,
          memory: st.memory,
          storage: st.disk,
          priceHourly: parseFloat(st.prices?.[0]?.price_hourly?.net ?? '0'),
          availability: st.prices?.map((p: any) => p.location) ?? []
        }));
      } catch (err) {
        console.error(`[hetzner] listAvailableServerTypes error:`, err);
        return [];
      }
    },

    async getCheapestRegion(serverType): Promise<RegionPricing> {
      const FALLBACK: RegionPricing = { region: "nbg1", priceHourly: 0 };
      try {
        const res = await fetch(
          `${baseUrl}/server_types?name=${encodeURIComponent(serverType)}`,
          { headers }
        );
        if (!res.ok) {
          console.warn(`[hetzner] getCheapestRegion: API returned ${res.status}, using fallback`);
          return FALLBACK;
        }
        const data = (await res.json()) as any;
        const serverTypes: any[] = data.server_types ?? [];
        if (serverTypes.length === 0) {
          console.warn(`[hetzner] getCheapestRegion: server type "${serverType}" not found, using fallback`);
          return FALLBACK;
        }
        const prices: Array<{
          location: string;
          price_hourly: { net: string; gross: string };
          price_monthly: { net: string; gross: string };
        }> = serverTypes[0].prices ?? [];
        if (prices.length === 0) return FALLBACK;

        let cheapestLocation = prices[0].location;
        let cheapestHourlyNet = parseFloat(prices[0].price_hourly.net);
        let cheapestMonthlyGross = parseFloat(prices[0].price_monthly.gross);

        for (const entry of prices.slice(1)) {
          const monthly = parseFloat(entry.price_monthly.gross);
          if (monthly < cheapestMonthlyGross) {
            cheapestMonthlyGross = monthly;
            cheapestHourlyNet = parseFloat(entry.price_hourly.net);
            cheapestLocation = entry.location;
          }
        }

        console.log(
          `[hetzner] getCheapestRegion: "${serverType}" -> "${cheapestLocation}" ` +
          `($${cheapestHourlyNet}/hr net, $${cheapestMonthlyGross}/mo gross)`
        );
        return { region: cheapestLocation, priceHourly: cheapestHourlyNet };
      } catch (err) {
        console.error(`[hetzner] getCheapestRegion error, using fallback:`, err);
        return FALLBACK;
      }
    },

    async createServer(opts: ServerCreationOptions): Promise<CloudServer> {
      const payload: Record<string, any> = {
        name: opts.name,
        server_type: opts.serverType ?? "cx23",
        image: opts.image ?? "ubuntu-24.04",
        location: opts.region,
      };

      // Add cloud-init user_data if provided
      if (opts.cloudInit) {
        payload.user_data = opts.cloudInit;
      }

      const res = await fetch(`${baseUrl}/servers`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Hetzner createServer failed (${res.status}): ${body}`);
      }

      const data = (await res.json()) as any;
      const server = data.server;

      return {
        id: String(server.id),
        name: server.name,
        status: server.status,
        publicIp: server.public_net?.ipv4?.ip ?? null,
        region: server.datacenter?.location?.name ?? opts.region,
        serverType: server.server_type?.name ?? opts.serverType ?? "cx23",
        provider: "hetzner"
      };
    },

    async deleteServer(serverId) {
      const res = await fetch(`${baseUrl}/servers/${serverId}`, {
        method: "DELETE",
        headers,
      });

      if (!res.ok && res.status !== 404) {
        const body = await res.text();
        throw new Error(`Hetzner deleteServer failed (${res.status}): ${body}`);
      }
    },

    async getServer(serverId): Promise<CloudServer | null> {
      const res = await fetch(`${baseUrl}/servers/${serverId}`, {
        method: "GET",
        headers,
      });

      if (res.status === 404) return null;

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Hetzner getServer failed (${res.status}): ${body}`);
      }

      const data = (await res.json()) as any;
      const server = data.server;

      return {
        id: String(server.id),
        name: server.name,
        status: server.status,
        publicIp: server.public_net?.ipv4?.ip ?? null,
        region: server.datacenter?.location?.name ?? "",
        serverType: server.server_type?.name ?? "",
        provider: "hetzner"
      };
    },
  };
}
