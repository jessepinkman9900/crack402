/**
 * Quick integration test for AWS SDK v3 adapter
 * Run this with: curl http://localhost:8789/v1/cloud/test-aws
 */

import { Hono } from "hono";
import type { Env } from "../types";
import { getServices } from "../lib/services";

const testRoutes = new Hono<Env>();

/**
 * Test AWS adapter - list available server types
 * This is a safe, read-only operation that doesn't create any resources
 */
testRoutes.get("/test-aws", async (c) => {
  try {
    console.log('[test-aws] Starting AWS adapter test...');

    const services = getServices(c.env);
    const cloudProvider = services.cloudProvider;

    console.log(`[test-aws] Provider: ${cloudProvider.getProviderName()}`);

    // Test 1: List available server types (static data, should always work)
    const serverTypes = await cloudProvider.listAvailableServerTypes();
    console.log(`[test-aws] Found ${serverTypes.length} server types`);

    // Test 2: Get cheapest region (static data, should always work)
    const cheapest = await cloudProvider.getCheapestRegion('t4g.nano');
    console.log(`[test-aws] Cheapest region: ${cheapest.region} ($${cheapest.priceHourly}/hr)`);

    return c.json({
      success: true,
      provider: cloudProvider.getProviderName(),
      tests: {
        listServerTypes: {
          status: 'passed',
          count: serverTypes.length,
          types: serverTypes.map(t => t.name)
        },
        getCheapestRegion: {
          status: 'passed',
          region: cheapest.region,
          priceHourly: cheapest.priceHourly
        }
      },
      message: 'AWS adapter is working correctly! ✅'
    });
  } catch (error) {
    console.error('[test-aws] Error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    }, 500);
  }
});

/**
 * Test AWS SDK - actually call AWS API (DescribeSecurityGroups)
 * This verifies credentials work and AWS SDK is functioning
 */
testRoutes.get("/test-aws-api", async (c) => {
  try {
    console.log('[test-aws-api] Testing actual AWS API call...');

    const services = getServices(c.env);
    const cloudProvider = services.cloudProvider;

    if (cloudProvider.getProviderName() !== 'aws') {
      return c.json({
        success: false,
        error: 'Cloud provider is not AWS',
        currentProvider: cloudProvider.getProviderName()
      }, 400);
    }

    // This will make an actual AWS API call to list security groups
    // It's a read-only operation that's safe to run
    console.log('[test-aws-api] Calling AWS DescribeSecurityGroups via adapter...');

    // We'll test by trying to get a non-existent server
    // This will make a DescribeInstances call to AWS
    const testResult = await cloudProvider.getServer('i-doesnotexist');

    return c.json({
      success: true,
      provider: cloudProvider.getProviderName(),
      test: {
        operation: 'getServer (DescribeInstances)',
        result: testResult === null ? 'correctly returned null for non-existent instance' : 'unexpected result',
        status: testResult === null ? 'passed' : 'failed'
      },
      message: testResult === null
        ? 'AWS SDK v3 is working correctly! Successfully called AWS API. ✅'
        : 'Unexpected result from AWS API'
    });
  } catch (error) {
    console.error('[test-aws-api] Error:', error);

    // Check if it's an auth error
    const isAuthError = error instanceof Error && (
      error.message.includes('AuthFailure') ||
      error.message.includes('credentials') ||
      error.message.includes('Signature')
    );

    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      errorType: isAuthError ? 'authentication' : 'unknown',
      suggestion: isAuthError
        ? 'Check AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .dev.vars'
        : 'Check console logs for details'
    }, 500);
  }
});

/**
 * Test AWS SDK - specifically test security group operations
 * This tests the exact operation that was failing with "Node is not defined"
 */
testRoutes.get("/test-aws-security-group", async (c) => {
  try {
    console.log('[test-aws-sg] Testing AWS SDK security group operations...');

    const services = getServices(c.env);
    const cloudProvider = services.cloudProvider;

    if (cloudProvider.getProviderName() !== 'aws') {
      return c.json({
        success: false,
        error: 'Cloud provider is not AWS',
        currentProvider: cloudProvider.getProviderName()
      }, 400);
    }

    // Import AWS SDK directly to test the specific operation
    const { EC2Client, DescribeSecurityGroupsCommand } = await import('@aws-sdk/client-ec2');

    const client = new EC2Client({
      region: c.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: c.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: c.env.AWS_SECRET_ACCESS_KEY
      }
    });

    // This is the exact operation that was failing with "Node is not defined"
    console.log('[test-aws-sg] Calling DescribeSecurityGroupsCommand...');
    const command = new DescribeSecurityGroupsCommand({
      Filters: [
        { Name: 'group-name', Values: ['zeroclaw-security-group'] }
      ]
    });

    const result = await client.send(command);

    console.log('[test-aws-sg] ✅ SUCCESS! Security group command executed');
    console.log(`[test-aws-sg] Found ${result.SecurityGroups?.length || 0} security groups`);

    return c.json({
      success: true,
      provider: cloudProvider.getProviderName(),
      test: {
        operation: 'DescribeSecurityGroups',
        status: 'passed',
        securityGroupsFound: result.SecurityGroups?.length || 0,
        groupId: result.SecurityGroups?.[0]?.GroupId || null
      },
      message: 'AWS SDK v3 security group operations working correctly! The "Node is not defined" issue is FIXED. ✅'
    });
  } catch (error) {
    console.error('[test-aws-sg] Error:', error);

    // Check if it's the "Node is not defined" error
    const isNodeError = error instanceof Error && error.message.includes('Node is not defined');

    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      errorType: isNodeError ? 'polyfill-missing' : 'unknown',
      suggestion: isNodeError
        ? 'The Node polyfill is missing or not working correctly'
        : 'Check console logs for details',
      stack: error instanceof Error ? error.stack : undefined
    }, 500);
  }
});

export default testRoutes;
