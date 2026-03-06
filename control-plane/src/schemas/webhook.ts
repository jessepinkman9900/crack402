import "./_setup";
import { z } from "zod/v4";

export const CreateWebhookSchema = z.object({
  url: z.url().openapi({ description: "Webhook callback URL", example: "https://example.com/webhook" }),
  events: z.array(z.string()).openapi({ description: "Event types to subscribe to" }),
  secret: z.string().optional().openapi({ description: "Shared secret for webhook signatures" }),
}).openapi("CreateWebhookRequest");

export const WebhookSchema = z.object({
  webhook_id: z.string().openapi({ description: "Unique webhook ID", example: "wh_abc123" }),
  url: z.string().openapi({ description: "Webhook callback URL" }),
  events: z.array(z.string()).openapi({ description: "Subscribed event types" }),
  created_at: z.string().datetime().openapi({ description: "ISO 8601 creation timestamp" }),
}).openapi("Webhook");
