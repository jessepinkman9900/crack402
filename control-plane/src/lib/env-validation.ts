import type { Bindings, CloudProvider, HetznerBindings, AWSBindings } from '../types';

/**
 * Validates environment variables and ensures all required variables are present
 * for the selected cloud provider.
 *
 * This function is called at startup to prevent runtime errors due to missing
 * or invalid environment configuration.
 *
 * @param env - Raw environment object
 * @returns Validated and typed Bindings object
 * @throws Error if validation fails with clear error message
 */
export function validateEnvironment(env: any): Bindings {
  // Validate CLOUD_PROVIDER is set and valid
  const cloudProvider = env.CLOUD_PROVIDER as CloudProvider;

  if (!cloudProvider) {
    throw new Error(
      'CLOUD_PROVIDER environment variable is required. Must be set to either "hetzner" or "aws".'
    );
  }

  if (!['hetzner', 'aws'].includes(cloudProvider)) {
    throw new Error(
      `Invalid CLOUD_PROVIDER: "${cloudProvider}". Must be either "hetzner" or "aws".`
    );
  }

  // Validate base environment variables (required for all providers)
  const baseVars: Array<keyof typeof env> = [
    'DB',
    'BOT_PROVISIONING_WORKFLOW',
    'FRONTEND_URL',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'BETTER_AUTH_SECRET',
    'WORKFLOW_SECRET',
    'OPENROUTER_MANGEMENT_API_KEY',
    'OPENROUTER_WEBHOOK_SECRET'
  ];

  const missingBaseVars: string[] = [];
  for (const varName of baseVars) {
    if (!env[varName]) {
      missingBaseVars.push(varName);
    }
  }

  if (missingBaseVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingBaseVars.join(', ')}`
    );
  }

  // Validate provider-specific environment variables
  if (cloudProvider === 'aws') {
    return validateAWSEnvironment(env);
  } else if (cloudProvider === 'hetzner') {
    return validateHetznerEnvironment(env);
  }

  // Should never reach here due to earlier validation, but TypeScript requires it
  throw new Error(`Unsupported cloud provider: ${cloudProvider}`);
}

/**
 * Validates AWS-specific environment variables
 */
function validateAWSEnvironment(env: any): AWSBindings {
  const awsVars = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION'];
  const missingAwsVars: string[] = [];

  for (const varName of awsVars) {
    if (!env[varName]) {
      missingAwsVars.push(varName);
    }
  }

  if (missingAwsVars.length > 0) {
    throw new Error(
      `Missing required AWS environment variables (required when CLOUD_PROVIDER=aws): ${missingAwsVars.join(', ')}\n` +
      `\nPlease set the following environment variables:\n` +
      `  - AWS_ACCESS_KEY_ID: Your AWS access key ID\n` +
      `  - AWS_SECRET_ACCESS_KEY: Your AWS secret access key\n` +
      `  - AWS_REGION: AWS region (e.g., "us-east-1")`
    );
  }

  // Validate AWS region format
  const region = env.AWS_REGION as string;
  if (!/^[a-z]{2}-[a-z]+-\d{1}$/.test(region)) {
    console.warn(
      `AWS_REGION "${region}" doesn't match standard AWS region format (e.g., "us-east-1"). ` +
      `Continuing anyway, but this may cause issues.`
    );
  }

  // Validate access key format (basic check)
  const accessKeyId = env.AWS_ACCESS_KEY_ID as string;
  if (!accessKeyId.startsWith('AKIA') && !accessKeyId.startsWith('ASIA')) {
    console.warn(
      `AWS_ACCESS_KEY_ID doesn't start with "AKIA" or "ASIA". ` +
      `This may not be a valid AWS access key. Continuing anyway...`
    );
  }

  console.log(`[env-validation] ✓ AWS environment validated successfully (region: ${region})`);

  return env as AWSBindings;
}

/**
 * Validates Hetzner-specific environment variables
 */
function validateHetznerEnvironment(env: any): HetznerBindings {
  if (!env.HETZNER_MANGEMENT_API_KEY) {
    throw new Error(
      `Missing required Hetzner environment variable (required when CLOUD_PROVIDER=hetzner): HETZNER_MANGEMENT_API_KEY\n` +
      `\nPlease set the following environment variable:\n` +
      `  - HETZNER_MANGEMENT_API_KEY: Your Hetzner Cloud API key`
    );
  }

  console.log(`[env-validation] ✓ Hetzner environment validated successfully`);

  return env as HetznerBindings;
}

/**
 * Gets the default server type for the current cloud provider
 */
export function getDefaultServerType(env: Bindings): string {
  // If explicitly set, use that
  if (env.SERVER_TYPE) {
    return env.SERVER_TYPE;
  }

  // Otherwise, use provider-specific defaults
  if (env.CLOUD_PROVIDER === 'aws') {
    return 't4g.nano';
  } else if (env.CLOUD_PROVIDER === 'hetzner') {
    return 'cx23';
  }

  return 'cx23'; // Fallback to Hetzner default
}
