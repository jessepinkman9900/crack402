import { Hono } from "hono";
import type { Env } from "../types";

/**
 * Cloud routes (public — no auth required for region listing)
 *
 * GET /v1/cloud/regions?provider=hetzner|aws — List available regions
 */
const cloud = new Hono<Env>();

// Static region data for Hetzner
const HETZNER_REGIONS = [
  { id: "fsn1", name: "Falkenstein", provider: "hetzner", flag: "DE" },
  { id: "nbg1", name: "Nuremberg", provider: "hetzner", flag: "DE" },
  { id: "hel1", name: "Helsinki", provider: "hetzner", flag: "FI" },
  { id: "ash", name: "Ashburn", provider: "hetzner", flag: "US" },
  { id: "hil", name: "Hillsboro", provider: "hetzner", flag: "US" },
  { id: "sin", name: "Singapore", provider: "hetzner", flag: "SG" },
];

// Static region data for AWS (common regions with t4g support)
const AWS_REGIONS = [
  { id: "us-east-1", name: "US East (N. Virginia)", provider: "aws", flag: "US" },
  { id: "us-east-2", name: "US East (Ohio)", provider: "aws", flag: "US" },
  { id: "us-west-2", name: "US West (Oregon)", provider: "aws", flag: "US" },
  { id: "eu-west-1", name: "EU (Ireland)", provider: "aws", flag: "IE" },
  { id: "eu-central-1", name: "EU (Frankfurt)", provider: "aws", flag: "DE" },
  { id: "ap-southeast-1", name: "Asia Pacific (Singapore)", provider: "aws", flag: "SG" },
];

const SUPPORTED_PROVIDERS = ["hetzner", "aws"] as const;

const REGIONS_BY_PROVIDER: Record<string, typeof HETZNER_REGIONS | typeof AWS_REGIONS> = {
  hetzner: HETZNER_REGIONS,
  aws: AWS_REGIONS,
};

cloud.get("/regions", (c) => {
  const provider = c.req.query("provider");

  if (!provider) {
    return c.json(
      {
        error: "Missing required query param: provider",
        supported: SUPPORTED_PROVIDERS,
      },
      400
    );
  }

  const regions = REGIONS_BY_PROVIDER[provider];
  if (!regions) {
    return c.json(
      {
        error: `Unsupported provider: "${provider}"`,
        supported: SUPPORTED_PROVIDERS,
      },
      400
    );
  }

  return c.json({ provider, regions });
});

export default cloud;
