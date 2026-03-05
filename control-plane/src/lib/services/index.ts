import type { Services, CloudProviderAdapter } from "./types";
import type { Bindings, HetznerBindings, AWSBindings } from "../../types";
import { validateEnvironment, getDefaultServerType } from "../env-validation";

import { mockHetzner } from "./mock/hetzner";
import { mockOpenRouter } from "./mock/openrouter";
import { mockPolar } from "./mock/polar";

import { createHetznerAdapter } from "./hetzner";
import { createAWSAdapter } from "./aws";
import { createOpenRouterAdapter } from "./openrouter";
import { createPolarAdapter } from "./polar";

/**
 * Returns the appropriate service adapters based on environment configuration.
 * Validates environment variables at startup and selects the correct cloud provider.
 */
export function getServices(env: any): Services {
  // Validate environment first (this will throw if invalid)
  const validatedEnv = validateEnvironment(env);

  // Determine if we should use mock services
  const useMock = validatedEnv.MOCK_EXTERNAL_SERVICES === "true";

  // Select cloud provider adapter based on CLOUD_PROVIDER env var
  let cloudProvider: CloudProviderAdapter;

  if (useMock) {
    // Use mock Hetzner for development
    cloudProvider = mockHetzner;
    console.log('[services] Using MOCK cloud provider (Hetzner mock)');
  } else {
    // Select real cloud provider based on configuration
    if (validatedEnv.CLOUD_PROVIDER === 'aws') {
      cloudProvider = createAWSAdapter(validatedEnv as AWSBindings);
      console.log(`[services] Using AWS cloud provider (region: ${validatedEnv.AWS_REGION})`);
    } else if (validatedEnv.CLOUD_PROVIDER === 'hetzner') {
      cloudProvider = createHetznerAdapter(validatedEnv as HetznerBindings);
      console.log('[services] Using Hetzner cloud provider');
    } else {
      throw new Error(`Unsupported cloud provider: ${validatedEnv.CLOUD_PROVIDER}`);
    }
  }

  const serverType = getDefaultServerType(validatedEnv);
  console.log(`[services] Default server type: ${serverType}`);

  return {
    cloudProvider,
    hetzner: useMock ? mockHetzner : (validatedEnv.CLOUD_PROVIDER === 'hetzner' ? createHetznerAdapter(validatedEnv as HetznerBindings) : undefined),
    openrouter: useMock ? mockOpenRouter : createOpenRouterAdapter(validatedEnv),
    polar: useMock ? mockPolar : createPolarAdapter(validatedEnv),
  };
}
