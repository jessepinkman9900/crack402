import { createMiddleware } from "hono/factory";
import type { Env } from "../types";
import { paymentRequired } from "../schemas/payment";

/**
 * x402 payment middleware.
 * If the request has no payment proof and the server requires payment,
 * returns 402 with payment options.
 * If X-Payment-Signature is present, verifies the proof.
 */
export const paymentMiddleware = createMiddleware<Env>(async (c, next) => {
  // Skip payment in dev mode
  if (c.env.MOCK_EXTERNAL_SERVICES === "true") {
    return next();
  }

  const paymentSignature = c.req.header("X-Payment-Signature");
  const body = await c.req.json();

  // Check if request includes payment info
  if (body.payment?.method === "api_key_billing" || body.payment?.method === "prepaid_credits") {
    // Billing via API key or prepaid — allow through
    return next();
  }

  if (body.payment?.x402_signature || paymentSignature) {
    // Has payment proof — verify it
    const sig = paymentSignature || body.payment?.x402_signature;
    const valid = await verifyPaymentProof(sig);
    if (!valid) {
      return c.json({ error: "unauthorized", message: "Invalid payment signature." }, 401);
    }
    return next();
  }

  // No payment — return 402
  const recipient = c.env.PAYMENT_RECIPIENT || "0x0000000000000000000000000000000000000000";
  const network = c.env.PAYMENT_NETWORK || "base";
  const asset = c.env.PAYMENT_ASSET || "USDC";

  const vcpu = body.vcpu || 2;
  const hours = (body.timeout_seconds || 3600) / 3600;
  const amount = (vcpu * 0.01 * hours).toFixed(4);

  c.header("X-Payment-Amount", amount);
  c.header("X-Payment-Asset", asset);
  c.header("X-Payment-Network", network);
  c.header("X-Payment-Recipient", recipient);

  return c.json(
    paymentRequired([
      {
        amount,
        asset,
        network,
        recipient,
        description: `${vcpu} vCPU, ${body.memory_mb || 2048}MB RAM, ${hours}h sandbox`,
      },
    ]),
    402
  );
});

async function verifyPaymentProof(_signature: string): Promise<boolean> {
  // TODO: Implement actual x402 signature verification via viem
  // For now, accept any non-empty signature
  return _signature.length > 0;
}
