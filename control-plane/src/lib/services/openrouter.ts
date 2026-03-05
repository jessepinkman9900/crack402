import type { OpenRouterAdapter } from "./types";
import type { Bindings } from "../../types";

/**
 * Retry helper with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
  shouldRetry: (error: any) => boolean = () => true
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry if we shouldn't or if we've exhausted retries
      if (!shouldRetry(error) || attempt === maxRetries) {
        throw error;
      }

      // Exponential backoff: 1s, 2s, 4s
      const delayMs = baseDelayMs * Math.pow(2, attempt);
      console.log(`[OpenRouter] Retry attempt ${attempt + 1}/${maxRetries} after ${delayMs}ms`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

/**
 * Determine if an error is retryable (network/5xx errors) vs permanent (4xx errors)
 */
function isRetryableError(error: any): boolean {
  const errorMessage = error?.message || String(error);

  // Network errors and timeouts are retryable
  if (errorMessage.includes('fetch failed') ||
      errorMessage.includes('network') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('ECONNRESET') ||
      errorMessage.includes('ETIMEDOUT')) {
    return true;
  }

  // 5xx server errors are retryable
  if (errorMessage.match(/failed \(5\d{2}\)/)) {
    return true;
  }

  // 4xx client errors (except 408 timeout, 429 rate limit) are NOT retryable
  if (errorMessage.match(/failed \((408|429)\)/)) {
    return true;
  }

  if (errorMessage.match(/failed \(4\d{2}\)/)) {
    return false;
  }

  // JSON parsing errors might be transient
  if (errorMessage.includes('not valid JSON')) {
    return true;
  }

  // Default to not retrying for unknown errors
  return false;
}

/**
 * Real OpenRouter adapter.
 * Calls the OpenRouter API to provision/revoke keys.
 */
export function createOpenRouterAdapter(env: Bindings): OpenRouterAdapter {
  const apiKey = env.OPENROUTER_MANGEMENT_API_KEY;
  const baseUrl = "https://openrouter.ai/api/v1";

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  return {
    async provisionKey(opts) {
      return retryWithBackoff(
        async () => {
          const body: Record<string, any> = {
            name: opts.name,
            label: opts.label
          };

          // Add monthly spend limit if provided (in dollars)
          if (opts.monthlyLimit !== undefined) {
            body.limit = opts.monthlyLimit;
          }

          const res = await fetch(`${baseUrl}/keys`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          });

          if (!res.ok) {
            const errorBody = await res.text();
            throw new Error(
              `OpenRouter provisionKey failed (${res.status}): ${errorBody}`
            );
          }

          // Parse JSON response with proper error handling
          let data: any;
          const rawBody = await res.text();
          try {
            data = JSON.parse(rawBody);
          } catch (parseError) {
            const headersObj: Record<string, string> = {};
            res.headers.forEach((value, key) => {
              headersObj[key] = value;
            });
            console.error('[OpenRouter] Failed to parse provisionKey response:', {
              status: res.status,
              headers: headersObj,
              rawBody: rawBody.substring(0, 500), // Log first 500 chars
              parseError: parseError instanceof Error ? parseError.message : String(parseError)
            });
            throw new Error(
              `OpenRouter provisionKey response is not valid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`
            );
          }

          // Validate response structure
          const keyId = data.data?.hash ?? data.hash;
          const key = data.data?.key ?? data.key;

          if (!keyId || !key) {
            console.error('[OpenRouter] Invalid provisionKey response structure:', {
              hasData: !!data.data,
              hasHash: !!(data.data?.hash ?? data.hash),
              hasKey: !!(data.data?.key ?? data.key),
              keys: Object.keys(data)
            });
            throw new Error(
              `OpenRouter provisionKey response missing required fields (hash or key)`
            );
          }

          return {
            id: keyId,
            key: key,
            name: opts.name,
            limit: opts.monthlyLimit,
          };
        },
        3, // max 3 retries
        1000, // 1s base delay
        isRetryableError
      );
    },

    async revokeKey(keyId) {
      return retryWithBackoff(
        async () => {
          const res = await fetch(`${baseUrl}/keys/${keyId}`, {
            method: "DELETE",
            headers,
          });

          // Success or key already deleted (404) - both are acceptable
          if (res.ok || res.status === 404) {
            return;
          }

          // For any other error, capture full response details
          const errorBody = await res.text();

          // Try to parse as JSON for better error messages, but handle parse failures
          let parsedError: any = null;
          try {
            parsedError = JSON.parse(errorBody);
          } catch {
            // If it's not JSON, we'll just use the raw text
          }

          const headersObj: Record<string, string> = {};
          res.headers.forEach((value, key) => {
            headersObj[key] = value;
          });

          console.error('[OpenRouter] Failed to revoke key:', {
            keyId,
            status: res.status,
            statusText: res.statusText,
            headers: headersObj,
            rawBody: errorBody.substring(0, 500), // Log first 500 chars
            parsedError
          });

          throw new Error(
            `OpenRouter revokeKey failed (${res.status}): ${errorBody}`
          );
        },
        3, // max 3 retries
        1000, // 1s base delay
        isRetryableError
      );
    },
  };
}
