import { Hono } from "hono";
import type { Env } from "../types";
import { getServices } from "../lib/services";
import { getDefaultServerType } from "../lib/env-validation";
import { cleanupBotResources } from "../workflows/bot-provisioning";
import { createDb, bots, sshKeys } from "../db";
import { eq, and, desc } from "drizzle-orm";
import type { BotType } from "../lib/provisioning/bot-types";

/**
 * Bot routes
 *
 * POST   /v1/bots           — Create a bot
 * GET    /v1/bots           — List bots for the current user
 * GET    /v1/bots/:id       — Get a single bot
 * DELETE /v1/bots/:id       — Delete a bot
 * POST   /v1/bots/:id/provision — Provision bot (create OpenRouter key + VM)
 * POST   /v1/bots/:id/retry  — Retry failed provisioning
 * POST   /v1/bots/:id/stop  — Stop a bot (destroy server)
 *
 * TODO: Migrate polling to WebSocket for real-time provisioning updates (v2)
 */
const app = new Hono<Env>();

const DEFAULT_MONTHLY_LIMIT = 5; // $5 USD

// --- Create bot ---
app.post("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "User required" }, 403);

  const body = await c.req.json<{
    name?: string;
    provider?: string;
    botType?: BotType;
    version?: string;
  }>();

  if (!body.name?.trim()) {
    return c.json({ error: "Missing required field: name" }, 400);
  }
  if (!body.provider) {
    return c.json({ error: "Missing required field: provider" }, 400);
  }

  const botType = body.botType || 'standard'; // Default to standard
  if (botType !== 'standard' && botType !== 'gateway') {
    return c.json({ error: "Invalid botType. Must be 'standard' or 'gateway'" }, 400);
  }

  const version = body.version || '1.0.0'; // Default to 1.0.0

  // Get default server type from environment
  const serverType = getDefaultServerType(c.env);

  // Auto-select the cheapest available region for the VM spec
  const services = getServices(c.env);
  const { region, priceHourly } = await services.cloudProvider.getCheapestRegion(serverType);
  // Store as micro-dollars (integer) to avoid float precision issues
  const pricePerHour = Math.round(priceHourly * 1_000_000);

  const id = crypto.randomUUID();
  const now = Date.now();

  try {
    const db = createDb(c.env.DB);
    await db.insert(bots).values({
      id,
      userId: user.id,
      name: body.name.trim(),
      provider: body.provider,
      botType,
      version,
      region,
      serverType,
      pricePerHour,
      status: "stopped",
      createdAt: now,
      updatedAt: now,
    });

    return c.json(
      {
        id,
        name: body.name.trim(),
        provider: body.provider,
        botType,
        version,
        region,
        pricePerHour,
        status: "stopped",
        provisioningStatus: null,
        serverId: null,
        ipAddress: null,
        createdAt: now,
        updatedAt: now,
      },
      201
    );
  } catch (err) {
    console.error("[bots] Create failed:", err);
    return c.json({ error: "Failed to create bot" }, 500);
  }
});

// --- List bots ---
app.get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "User required" }, 403);

  try {
    const db = createDb(c.env.DB);
    const rows = await db
      .select({
        id: bots.id,
        name: bots.name,
        status: bots.status,
        provisioningStatus: bots.provisioningStatus,
        provisioningError: bots.provisioningError,
        provider: bots.provider,
        region: bots.region,
        pricePerHour: bots.pricePerHour,
        serverId: bots.serverId,
        ipAddress: bots.ipAddress,
        createdAt: bots.createdAt,
        updatedAt: bots.updatedAt,
      })
      .from(bots)
      .where(eq(bots.userId, user.id))
      .orderBy(desc(bots.createdAt));

    return c.json({ bots: rows });
  } catch (err) {
    console.error("[bots] List failed:", err);
    return c.json({ error: "Failed to list bots" }, 500);
  }
});

// --- Get single bot ---
app.get("/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "User required" }, 403);

  const botId = c.req.param("id");

  try {
    const db = createDb(c.env.DB);
    const [row] = await db
      .select({
        id: bots.id,
        name: bots.name,
        status: bots.status,
        provisioningStatus: bots.provisioningStatus,
        provisioningError: bots.provisioningError,
        provider: bots.provider,
        region: bots.region,
        pricePerHour: bots.pricePerHour,
        serverId: bots.serverId,
        ipAddress: bots.ipAddress,
        provisioningStartedAt: bots.provisioningStartedAt,
        provisioningCompletedAt: bots.provisioningCompletedAt,
        createdAt: bots.createdAt,
        updatedAt: bots.updatedAt,
      })
      .from(bots)
      .where(and(eq(bots.id, botId), eq(bots.userId, user.id)));

    if (!row) {
      return c.json({ error: "Bot not found" }, 404);
    }

    return c.json(row);
  } catch (err) {
    console.error("[bots] Get failed:", err);
    return c.json({ error: "Failed to fetch bot" }, 500);
  }
});

// --- Delete bot ---
app.delete("/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "User required" }, 403);

  const botId = c.req.param("id");

  try {
    const db = createDb(c.env.DB);

    // Check if bot exists and belongs to user
    const [existing] = await db
      .select({
        id: bots.id,
        serverId: bots.serverId,
        openrouterKeyId: bots.openrouterKeyId,
      })
      .from(bots)
      .where(and(eq(bots.id, botId), eq(bots.userId, user.id)));

    if (!existing) {
      return c.json({ error: "Bot not found" }, 404);
    }

    // Cleanup resources before deletion
    if (existing.serverId || existing.openrouterKeyId) {
      // Mark as deleting so any concurrent reads show the correct state
      await db
        .update(bots)
        .set({ status: "deleting", updatedAt: Date.now() })
        .where(eq(bots.id, botId));

      try {
        await cleanupBotResources(
          c.env,
          botId,
          existing.serverId ?? undefined,
          existing.openrouterKeyId ?? undefined
        );
      } catch (err) {
        console.error("[bots] Resource cleanup failed:", err);
      }
    }

    await db.delete(bots).where(eq(bots.id, botId));

    return c.body(null, 204);
  } catch (err) {
    console.error("[bots] Delete failed:", err);
    return c.json({ error: "Failed to delete bot" }, 500);
  }
});

// --- Provision bot (new endpoint) ---
app.post("/:id/provision", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "User required" }, 403);

  const botId = c.req.param("id");

  const body = await c.req.json<{
    // Bot type-specific fields
    channelType?: string;
    channelToken?: string;
    gatewayHost?: string;
    gatewayPort?: number;
    gatewayNewPairing?: boolean;
    // Common fields
    monthlyLimit?: number;
    sshKeyId?: string;
  }>();

  try {
    const db = createDb(c.env.DB);

    // Check bot exists and get details
    const [bot] = await db
      .select({
        id: bots.id,
        name: bots.name,
        botType: bots.botType,
        provisioningStatus: bots.provisioningStatus,
        region: bots.region,
        serverType: bots.serverType,
        retryCount: bots.retryCount,
      })
      .from(bots)
      .where(and(eq(bots.id, botId), eq(bots.userId, user.id)));

    if (!bot) {
      return c.json({ error: "Bot not found" }, 404);
    }

    const botType = bot.botType || 'standard';

    // Validate bot type-specific fields
    if (botType === 'standard') {
      if (!body.channelType) {
        return c.json({ error: "Missing required field: channelType (for standard bot)" }, 400);
      }
      if (!body.channelToken) {
        return c.json({ error: "Missing required field: channelToken (for standard bot)" }, 400);
      }
    } else if (botType === 'gateway') {
      if (!body.gatewayHost) {
        return c.json({ error: "Missing required field: gatewayHost (for gateway bot)" }, 400);
      }
      if (!body.gatewayPort) {
        return c.json({ error: "Missing required field: gatewayPort (for gateway bot)" }, 400);
      }
    }

    // Validate SSH key if provided
    if (body.sshKeyId) {
      const [sshKey] = await db
        .select({ id: sshKeys.id, userId: sshKeys.userId })
        .from(sshKeys)
        .where(eq(sshKeys.id, body.sshKeyId))
        .limit(1);

      if (!sshKey) {
        return c.json({ error: "SSH key not found" }, 404);
      }

      if (sshKey.userId !== user.id) {
        return c.json({ error: "SSH key does not belong to user" }, 403);
      }
    }

    // Check if already provisioning or running
    if (
      bot.provisioningStatus &&
      ["pending_openrouter", "pending_vm", "pending_setup"].includes(
        bot.provisioningStatus
      )
    ) {
      return c.json(
        {
          error: "Bot is already being provisioned",
          provisioningStatus: bot.provisioningStatus,
        },
        409
      );
    }

    if (bot.provisioningStatus === "ready") {
      return c.json({ error: "Bot is already provisioned" }, 409);
    }

    // Check retry limit
    const retryCount = bot.retryCount ?? 0;
    if (retryCount >= 1 && bot.provisioningStatus === "failed") {
      return c.json(
        {
          error:
            "Maximum retry attempts reached. Please delete and recreate the bot.",
        },
        429
      );
    }

    // Trigger the workflow
    const monthlyLimit = body.monthlyLimit ?? DEFAULT_MONTHLY_LIMIT;

    const workflowParams: any = {
      botId,
      userId: user.id,
      botName: bot.name,
      region: bot.region,
      serverType: bot.serverType,
      botType,
      monthlyLimit,
    };

    if (body.sshKeyId) {
      workflowParams.sshKeyId = body.sshKeyId;
    }

    if (botType === 'standard') {
      workflowParams.channelType = body.channelType;
      workflowParams.channelToken = body.channelToken;
    } else if (botType === 'gateway') {
      workflowParams.gatewayHost = body.gatewayHost;
      workflowParams.gatewayPort = body.gatewayPort;
      workflowParams.gatewayNewPairing = body.gatewayNewPairing ?? false;
    }

    await c.env.BOT_PROVISIONING_WORKFLOW.create({
      params: workflowParams,
    });

    // Update retry count if this is a retry
    if (bot.provisioningStatus === "failed") {
      const now = Date.now();
      await db
        .update(bots)
        .set({
          retryCount: retryCount + 1,
          updatedAt: now,
        })
        .where(eq(bots.id, botId));
    }

    return c.json({
      id: bot.id,
      name: bot.name,
      provisioningStatus: "pending_openrouter",
      message: "Provisioning started",
    });
  } catch (err) {
    console.error("[bots] Provision failed:", err);
    return c.json({ error: "Failed to start provisioning" }, 500);
  }
});

// --- Retry provisioning (convenience endpoint) ---
app.post("/:id/retry", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "User required" }, 403);

  const botId = c.req.param("id");

  try {
    const db = createDb(c.env.DB);

    const [bot] = await db
      .select({
        id: bots.id,
        name: bots.name,
        botType: bots.botType,
        provisioningStatus: bots.provisioningStatus,
        region: bots.region,
        serverType: bots.serverType,
        channelConfig: bots.channelConfig,
        gatewayConfig: bots.gatewayConfig,
        sshKeyId: bots.sshKeyId,
        retryCount: bots.retryCount,
      })
      .from(bots)
      .where(and(eq(bots.id, botId), eq(bots.userId, user.id)));

    if (!bot) {
      return c.json({ error: "Bot not found" }, 404);
    }

    if (bot.provisioningStatus !== "failed") {
      return c.json(
        {
          error: "Can only retry failed provisioning attempts",
          provisioningStatus: bot.provisioningStatus,
        },
        400
      );
    }

    const botType = bot.botType || 'standard';
    const body = await c.req.json<{
      channelToken?: string;
      gatewayHost?: string;
      gatewayPort?: number;
      gatewayNewPairing?: boolean;
    }>();

    const workflowParams: any = {
      botId,
      userId: user.id,
      botName: bot.name,
      region: bot.region,
      serverType: bot.serverType,
      botType,
      monthlyLimit: DEFAULT_MONTHLY_LIMIT,
    };

    if (bot.sshKeyId) {
      workflowParams.sshKeyId = bot.sshKeyId;
    }

    if (botType === 'standard') {
      // Get channel config from previous attempt or request body
      let channelType = "telegram";
      let channelToken = "";

      if (bot.channelConfig) {
        try {
          const config = JSON.parse(bot.channelConfig);
          channelToken = config.bot_token || "";
          // Detect channel type from config structure
          if (config.bot_token && !config.client_id) channelType = "telegram";
          else if (config.client_id) channelType = "discord";
        } catch (e) {
          // Use defaults
        }
      }

      // Allow overriding channel token from request
      if (body.channelToken) {
        channelToken = body.channelToken;
      }

      if (!channelToken) {
        return c.json({ error: "channelToken required for retry" }, 400);
      }

      workflowParams.channelType = channelType;
      workflowParams.channelToken = channelToken;
    } else if (botType === 'gateway') {
      // Get gateway config from previous attempt or request body
      let gatewayHost = "";
      let gatewayPort = 0;
      let gatewayNewPairing = false;

      if (bot.gatewayConfig) {
        try {
          const config = JSON.parse(bot.gatewayConfig);
          gatewayHost = config.host || "";
          gatewayPort = config.port || 0;
          gatewayNewPairing = config.newPairing || false;
        } catch (e) {
          // Use defaults
        }
      }

      // Allow overriding from request
      if (body.gatewayHost) gatewayHost = body.gatewayHost;
      if (body.gatewayPort) gatewayPort = body.gatewayPort;
      if (body.gatewayNewPairing !== undefined) gatewayNewPairing = body.gatewayNewPairing;

      if (!gatewayHost || !gatewayPort) {
        return c.json({ error: "gatewayHost and gatewayPort required for retry" }, 400);
      }

      workflowParams.gatewayHost = gatewayHost;
      workflowParams.gatewayPort = gatewayPort;
      workflowParams.gatewayNewPairing = gatewayNewPairing;
    }

    // Clear error and retry
    const now = Date.now();
    await db
      .update(bots)
      .set({
        provisioningStatus: null,
        provisioningError: null,
        updatedAt: now,
      })
      .where(eq(bots.id, botId));

    // Re-trigger provision
    await c.env.BOT_PROVISIONING_WORKFLOW.create({
      params: workflowParams,
    });

    return c.json({
      id: bot.id,
      name: bot.name,
      provisioningStatus: "pending_openrouter",
      message: "Provisioning retry started",
    });
  } catch (err) {
    console.error("[bots] Retry failed:", err);
    return c.json({ error: "Failed to retry provisioning" }, 500);
  }
});

// --- Stop bot (destroy server) ---
app.post("/:id/stop", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "User required" }, 403);

  const botId = c.req.param("id");

  try {
    const db = createDb(c.env.DB);

    const [bot] = await db
      .select({
        id: bots.id,
        name: bots.name,
        provisioningStatus: bots.provisioningStatus,
        serverId: bots.serverId,
        openrouterKeyId: bots.openrouterKeyId,
        provider: bots.provider,
        region: bots.region,
      })
      .from(bots)
      .where(and(eq(bots.id, botId), eq(bots.userId, user.id)));

    if (!bot) {
      return c.json({ error: "Bot not found" }, 404);
    }

    if (bot.provisioningStatus !== "ready") {
      return c.json({ error: "Bot is not provisioned" }, 409);
    }

    // Mark as deleting before cleanup so UI can show intermediate state
    const now = Date.now();
    await db
      .update(bots)
      .set({ status: "deleting", updatedAt: now })
      .where(eq(bots.id, botId));

    // Cleanup resources
    if (bot.serverId || bot.openrouterKeyId) {
      try {
        await cleanupBotResources(
          c.env,
          botId,
          bot.serverId ?? undefined,
          bot.openrouterKeyId ?? undefined
        );
      } catch (err) {
        console.error("[bots] Resource cleanup failed during stop:", err);
      }
    }

    const now2 = Date.now();
    await db
      .update(bots)
      .set({
        status: "stopped",
        provisioningStatus: null,
        serverId: null,
        ipAddress: null,
        openrouterKeyId: null,
        openrouterKey: null,
        channelConfig: null,
        gatewayConfig: null,
        sshKeyId: null,
        provisioningError: null,
        provisioningStartedAt: null,
        provisioningCompletedAt: null,
        retryCount: 0,
        updatedAt: now2,
      })
      .where(eq(bots.id, botId));

    return c.json({
      id: bot.id,
      name: bot.name,
      status: "stopped",
      provisioningStatus: null,
      provider: bot.provider,
      region: bot.region,
      serverId: null,
      ipAddress: null,
      updatedAt: now2,
    });
  } catch (err) {
    console.error("[bots] Stop failed:", err);
    return c.json({ error: "Failed to stop bot" }, 500);
  }
});

export default app;
