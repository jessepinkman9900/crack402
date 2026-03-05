import { Hono } from "hono";
import type { Env } from "../types";

/**
 * Bot version routes
 *
 * GET /v1/bot-versions — Get supported Zeroclaw bot versions
 */
const app = new Hono<Env>();

// --- Get supported bot versions ---
app.get("/", async (c) => {
  try {
    const supportedVersionsJson = c.env.SUPPORTED_BOT_VERSIONS;

    if (!supportedVersionsJson) {
      // Fallback to default versions if not configured
const defaultVersions: typeof versions = [
        {
          version: "1.0.0",
          label: "v1.0.0 (Stable)",
          isDefault: true,
          description: "Latest stable release with core trading features"
        }
      ];

return c.json({ versions: defaultVersions, error: "SUPPORTED_BOT_VERSIONS is missing or invalid" });
    }

    const versions = JSON.parse(supportedVersionsJson);
    return c.json({ versions });
  } catch (err) {
    console.error("[bot-versions] Failed to parse supported versions:", err);

    // Fallback to default versions if SUPPORTED_BOT_VERSIONS is missing or invalid
    const defaultVersions = [
      {
        version: "1.0.0",
        label: "v1.0.0 (Stable)",
        isDefault: true,
        description: "Latest stable release with core trading features"
      }
    ];

    return c.json({ versions: defaultVersions });
  }
});

export default app;