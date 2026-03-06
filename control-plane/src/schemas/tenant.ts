import "./_setup";
import { z } from "zod/v4";

export const CreateTenantSchema = z.object({
  name: z.string().openapi({ description: "Tenant display name", example: "Acme Corp" }),
  max_concurrent_sandboxes: z.number().int().default(10).openapi({ description: "Max concurrent sandbox limit" }),
  max_vcpu: z.number().default(64).openapi({ description: "Max total vCPU allocation" }),
  max_memory_mb: z.number().int().default(131072).openapi({ description: "Max total memory in MB" }),
}).openapi("CreateTenantRequest");

export const UpdateTenantSchema = z.object({
  name: z.string().optional().openapi({ description: "New tenant name" }),
  status: z.string().optional().openapi({ description: "Tenant status" }),
  max_concurrent_sandboxes: z.number().int().optional().openapi({ description: "Updated sandbox limit" }),
  max_vcpu: z.number().optional().openapi({ description: "Updated vCPU limit" }),
  max_memory_mb: z.number().int().optional().openapi({ description: "Updated memory limit in MB" }),
}).openapi("UpdateTenantRequest");

export const TenantSchema = z.object({
  tenant_id: z.string().openapi({ description: "Unique tenant ID" }),
  name: z.string().openapi({ description: "Tenant name" }),
  status: z.string().openapi({ description: "Tenant status" }),
  max_concurrent_sandboxes: z.number().int().openapi({ description: "Max concurrent sandbox limit" }),
  max_vcpu: z.number().openapi({ description: "Max vCPU allocation" }),
  max_memory_mb: z.number().int().openapi({ description: "Max memory in MB" }),
  created_at: z.string().datetime().openapi({ description: "ISO 8601 creation timestamp" }),
}).openapi("Tenant");

export const CreateApiKeySchema = z.object({
  name: z.string().default("api-key").openapi({ description: "API key name", example: "production-key" }),
}).openapi("CreateApiKeyRequest");
