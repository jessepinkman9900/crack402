import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";
import type { Bindings } from "../types";
import { getServices } from "../lib/services";
import { getDefaultServerType } from "../lib/env-validation";
import { generateCloudInit, generateChannelConfig } from "../lib/provisioning/cloud-init";
import { createDb, bots, sshKeys } from "../db";
import { eq } from "drizzle-orm";
import type { BotType } from "../lib/provisioning/bot-types";

/**
 * Bot Provisioning Workflow
 *
 * Orchestrates the 3-step provisioning process:
 * 1. Create OpenRouter API key with monthly limit
 * 2. Create cloud VM (AWS, Hetzner, etc.) with cloud-init script
 * 3. Wait for VM setup to complete
 *
 * Features:
 * - Cloud-agnostic provisioning (works with any cloud provider)
 * - Automatic retry (1 attempt)
 * - Cleanup on failure
 * - Status tracking via database
 * - Durable execution with Workflow
 */

export interface ProvisioningParams {
  botId: string;
  userId: string;
  botName: string;
  region?: string; // Optional, will use cheapest region if not specified
  serverType?: string; // Optional, will use default for cloud provider
  botType: BotType; // 'standard' or 'gateway'
  channelType?: string; // Required for 'standard' type
  channelToken?: string; // Required for 'standard' type
  gatewayHost?: string; // Required for 'gateway' type
  gatewayPort?: number; // Required for 'gateway' type
  gatewayNewPairing?: boolean; // Required for 'gateway' type
  monthlyLimit: number;
  sshKeyId?: string; // Optional SSH key for debugging access
}

type ProvisioningStatus =
  | "pending_openrouter"
  | "pending_vm"
  | "pending_setup"
  | "ready"
  | "failed";

const OPENROUTER_RETRY_LIMIT = 1;
const VM_RETRY_LIMIT = 1;
const SETUP_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const VM_POLL_INTERVAL_MS = 30 * 1000; // 30 seconds

export class BotProvisioningWorkflow extends WorkflowEntrypoint<Bindings> {
  async run(event: WorkflowEvent<ProvisioningParams>, step: WorkflowStep) {
    const { botId, userId, botName, botType, monthlyLimit, sshKeyId } = event.payload;
    const serverType = event.payload.serverType || getDefaultServerType(this.env);

    console.log(`[workflow] Starting provisioning for bot ${botId} (type: ${botType}, serverType: ${serverType})`);

    // Validate bot type configuration
    if (botType === 'standard') {
      if (!event.payload.channelType || !event.payload.channelToken) {
        throw new Error("channelType and channelToken are required for standard bot type");
      }
    } else if (botType === 'gateway') {
      if (!event.payload.gatewayHost || !event.payload.gatewayPort) {
        throw new Error("gatewayHost and gatewayPort are required for gateway bot type");
      }
    }

    // Fetch SSH key if provided
    let sshPublicKey: string | undefined;
    if (sshKeyId) {
      const key = await step.do("fetch-ssh-key", async () => {
        const db = createDb(this.env.DB);
        const [sshKey] = await db.select().from(sshKeys).where(eq(sshKeys.id, sshKeyId)).limit(1);

        if (!sshKey) {
          throw new Error(`SSH key ${sshKeyId} not found`);
        }

        if (sshKey.userId !== userId) {
          throw new Error(`SSH key ${sshKeyId} does not belong to user ${userId}`);
        }

        console.log(`[workflow] Using SSH key ${sshKeyId} (${sshKey.name}) for bot ${botId}`);
        return sshKey.publicKey;
      });

      sshPublicKey = key;
    }

    // Step 1: Update status to pending_openrouter
    await step.do("update-status-openrouter", async () => {
      await this.updateProvisioningStatus(botId, "pending_openrouter", null);
    });

    // Step 2: Create OpenRouter key
    let openrouterKey: { id: string; key: string } | null = null;

    try {
      openrouterKey = await step.do(
        "create-openrouter-key",
        { retries: { limit: OPENROUTER_RETRY_LIMIT, delay: "5 seconds" } },
        async () => {
          const services = getServices(this.env);
          const key = await services.openrouter.provisionKey({
            name: `bot-${botName}-${botId.slice(0, 8)}`,
            label: `ZeroClaw bot for user ${userId}`,
            monthlyLimit,
          });

          console.log(`[workflow] Created OpenRouter key ${key.id} for bot ${botId}`);
          return key;
        }
      );
    } catch (err) {
      console.error(`[workflow] OpenRouter key creation failed for bot ${botId}:`, err);
      await this.updateProvisioningStatus(botId, "failed", `OpenRouter key creation failed: ${err}`);
      throw err;
    }

    // Step 3: Update status and store key
    await step.do("store-openrouter-key", async () => {
      await this.updateProvisioningStatus(botId, "pending_vm", null, {
        openrouterKeyId: openrouterKey!.id,
        openrouterKey: openrouterKey!.key,
      });
    });

    // Step 4: Generate cloud-init script based on bot type
    let cloudInitScript: string;

    if (botType === 'standard') {
      const channelConfig = generateChannelConfig(
        event.payload.channelType!,
        botName,
        event.payload.channelToken!
      );

      cloudInitScript = generateCloudInit({
        openrouterKey: openrouterKey.key,
        botType: 'standard',
        channelType: event.payload.channelType!,
        channelConfig,
        botName,
        sshPublicKey,
      });
    } else {
      cloudInitScript = generateCloudInit({
        openrouterKey: openrouterKey.key,
        botType: 'gateway',
        gatewayHost: event.payload.gatewayHost!,
        gatewayPort: event.payload.gatewayPort!,
        gatewayNewPairing: event.payload.gatewayNewPairing ?? false,
        botName,
        sshPublicKey,
      });
    }

    // Step 5: Determine region (use cheapest if not specified)
    let targetRegion = event.payload.region;
    let pricePerHour = 0;

    if (!targetRegion) {
      const regionPricing = await step.do("get-cheapest-region", async () => {
        const services = getServices(this.env);
        return await services.cloudProvider.getCheapestRegion(serverType);
      });
      targetRegion = regionPricing.region;
      pricePerHour = regionPricing.priceHourly;
      console.log(`[workflow] Using cheapest region: ${targetRegion} ($${pricePerHour}/hr)`);
    }

    // Step 6: Create cloud VM (AWS, Hetzner, etc.)
    let server: { id: string; publicIp: string | null; provider: string } | null = null;

    try {
      server = await step.do(
        "create-cloud-vm",
        { retries: { limit: VM_RETRY_LIMIT, delay: "10 seconds" } },
        async () => {
          const services = getServices(this.env);
          const vm = await services.cloudProvider.createServer({
            name: `zeroclaw-${botName}-${botId.slice(0, 8)}`,
            region: targetRegion!,
            serverType,
            image: services.cloudProvider.getProviderName() === 'hetzner' ? 'ubuntu-24.04' : undefined,
            cloudInit: cloudInitScript,
          });

          console.log(`[workflow] Created ${vm.provider} VM ${vm.id} for bot ${botId}`);
          return vm;
        }
      );
    } catch (err) {
      console.error(`[workflow] VM creation failed for bot ${botId}:`, err);

      // Cleanup: revoke OpenRouter key
      if (openrouterKey) {
        try {
          const services = getServices(this.env);
          await services.openrouter.revokeKey(openrouterKey.id);
          console.log(`[workflow] Revoked OpenRouter key ${openrouterKey.id}`);
        } catch (cleanupErr) {
          console.error(`[workflow] Failed to revoke OpenRouter key ${openrouterKey.id}:`, cleanupErr);
        }
      }

      await this.updateProvisioningStatus(botId, "failed", `VM creation failed: ${err}`);
      throw err;
    }

    // Step 7: Update status with VM info
    await step.do("store-vm-info", async () => {
      const updateData: Record<string, any> = {
        provider: server!.provider,
        region: targetRegion!,
        serverType,
        serverId: server!.id,
        ipAddress: server!.publicIp,
        pricePerHour: pricePerHour > 0 ? Math.round(pricePerHour * 1_000_000) : undefined,
      };

      if (botType === 'standard') {
        const channelConfig = generateChannelConfig(
          event.payload.channelType!,
          botName,
          event.payload.channelToken!
        );
        updateData.channelConfig = JSON.stringify(channelConfig);
      } else {
        updateData.gatewayConfig = JSON.stringify({
          host: event.payload.gatewayHost,
          port: event.payload.gatewayPort,
          newPairing: event.payload.gatewayNewPairing ?? false,
        });
      }

      if (sshKeyId) {
        updateData.sshKeyId = sshKeyId;
      }

      await this.updateProvisioningStatus(botId, "pending_setup", null, updateData);
    });

    // Step 8: Wait for VM to be ready
    // Note: Cloud-init script runs automatically, we just verify the VM is running
    await step.do(
      "wait-for-vm",
      { timeout: SETUP_TIMEOUT_MS },
      async () => {
        const services = getServices(this.env);
        const startTime = Date.now();

        while (Date.now() - startTime < SETUP_TIMEOUT_MS) {
          const vm = await services.cloudProvider.getServer(server!.id);

          if (!vm) {
            throw new Error(`VM ${server!.id} not found`);
          }

          if (vm.status === "running") {
            console.log(`[workflow] VM ${server!.id} is running`);
            return { status: "running", ip: vm.publicIp };
          }

          if (vm.status === "off" || vm.status === "deleting") {
            throw new Error(`VM ${server!.id} is in ${vm.status} state`);
          }

          // Wait before polling again
          await new Promise(resolve => setTimeout(resolve, VM_POLL_INTERVAL_MS));
        }

        throw new Error(`VM ${server!.id} did not become ready within timeout`);
      }
    );

    // Step 9: Mark as ready
    await step.do("mark-ready", async () => {
      await this.updateProvisioningStatus(botId, "ready", null);
      console.log(`[workflow] Bot ${botId} provisioning complete`);
    });

    return { success: true, botId, serverId: server.id };
  }

  /**
   * Update bot provisioning status in database using Drizzle ORM
   */
  private async updateProvisioningStatus(
    botId: string,
    status: ProvisioningStatus,
    error: string | null,
    extra: Record<string, any> = {}
  ): Promise<void> {
    const db = createDb(this.env.DB);
    const now = Date.now();

    const updateData: Record<string, any> = {
      provisioningStatus: status,
      provisioningError: error,
      updatedAt: now,
    };

    if (extra.openrouterKeyId) {
      updateData.openrouterKeyId = extra.openrouterKeyId;
    }

    if (extra.openrouterKey) {
      updateData.openrouterKey = extra.openrouterKey;
    }

    if (extra.serverId) {
      updateData.serverId = extra.serverId;
    }

    if (extra.ipAddress) {
      updateData.ipAddress = extra.ipAddress;
    }

    if (extra.channelConfig) {
      updateData.channelConfig = extra.channelConfig;
    }

    if (extra.gatewayConfig) {
      updateData.gatewayConfig = extra.gatewayConfig;
    }

    if (extra.sshKeyId) {
      updateData.sshKeyId = extra.sshKeyId;
    }

    if (extra.provider) {
      updateData.provider = extra.provider;
    }

    if (extra.region) {
      updateData.region = extra.region;
    }

    if (extra.serverType) {
      updateData.serverType = extra.serverType;
    }

    if (extra.pricePerHour !== undefined) {
      updateData.pricePerHour = extra.pricePerHour;
    }

    if (status === "pending_openrouter") {
      updateData.provisioningStartedAt = now;
      updateData.status = "provisioning";
    }

    if (status === "ready") {
      updateData.status = "running";
    }

    if (status === "failed") {
      updateData.status = "stopped";
    }

    if (status === "ready" || status === "failed") {
      updateData.provisioningCompletedAt = now;
    }

    await db.update(bots).set(updateData).where(eq(bots.id, botId));
  }
}

/**
 * Cleanup function to revoke OpenRouter key and delete VM
 * Called when bot is deleted or provisioning fails
 */
export async function cleanupBotResources(
  env: Bindings,
  botId: string,
  serverId?: string,
  openrouterKeyId?: string
): Promise<void> {
  const errors: string[] = [];

  if (serverId) {
    try {
      const services = getServices(env);
      await services.cloudProvider.deleteServer(serverId);
      console.log(`[cleanup] Deleted VM ${serverId} for bot ${botId}`);
    } catch (err) {
      errors.push(`Failed to delete VM: ${err}`);
    }
  }

  if (openrouterKeyId) {
    try {
      const services = getServices(env);
      await services.openrouter.revokeKey(openrouterKeyId);
      console.log(`[cleanup] Revoked OpenRouter key ${openrouterKeyId} for bot ${botId}`);
    } catch (err) {
      errors.push(`Failed to revoke OpenRouter key: ${err}`);
    }
  }

  if (errors.length > 0) {
    console.error(`[cleanup] Errors during cleanup for bot ${botId}:`, errors);
  }
}
