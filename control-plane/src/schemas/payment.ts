import "./_setup";
import { z } from "zod/v4";

export const PaymentOptionSchema = z.object({
  amount: z.string().openapi({ description: "Payment amount", example: "0.01" }),
  asset: z.string().openapi({ description: "Payment asset identifier", example: "USDC" }),
  network: z.string().openapi({ description: "Blockchain network", example: "base" }),
  recipient: z.string().openapi({ description: "Recipient wallet address", example: "0x1234...abcd" }),
  description: z.string().optional().openapi({ description: "Human-readable payment description", example: "Sandbox provisioning (2 vCPU, 2GB RAM, 1 hour)" }),
}).openapi("PaymentOption");

export const PaymentRequiredSchema = z.object({
  error: z.literal("payment_required").openapi({ description: "Error code", example: "payment_required" }),
  message: z.string().openapi({ description: "Human-readable message", example: "Payment is required to provision this sandbox." }),
  payment_options: z.array(PaymentOptionSchema).openapi({ description: "Available payment options" }),
  x402_spec_url: z.string().optional().openapi({ description: "Link to x402 specification", example: "https://www.x402.org/spec" }),
}).openapi("PaymentRequired");

export type PaymentRequired = z.infer<typeof PaymentRequiredSchema>;

export function paymentRequired(
  options: Array<{
    amount: string;
    asset: string;
    network: string;
    recipient: string;
    description?: string;
  }>
): PaymentRequired {
  return {
    error: "payment_required",
    message: "Payment is required to provision this sandbox.",
    payment_options: options,
    x402_spec_url: "https://www.x402.org/spec",
  };
}
