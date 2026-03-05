import type {
  CloudProviderAdapter,
  CloudServer,
  ServerCreationOptions,
  RegionPricing,
  ServerTypeInfo
} from "./types";
import type { AWSBindings, CloudConfig } from "../../types";

// AWS SDK v3 imports
import {
  EC2Client,
  RunInstancesCommand,
  DescribeInstancesCommand,
  TerminateInstancesCommand,
  DescribeSecurityGroupsCommand,
  CreateSecurityGroupCommand,
  AuthorizeSecurityGroupIngressCommand,
  DescribeImagesCommand,
  DescribeInstanceTypesCommand,
  DescribeRegionsCommand,
  type Instance,
  type _InstanceType
} from "@aws-sdk/client-ec2";
import { PricingClient, GetProductsCommand } from "@aws-sdk/client-pricing";
import { fromEnv } from "@aws-sdk/credential-providers";

/**
 * Simple in-memory cache with TTL for API results
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

const cache = new Map<string, CacheEntry<any>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (now - entry.timestamp > entry.ttl) {
    cache.delete(key);
    return null;
  }

  return entry.data as T;
}

function setCache<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, { data, timestamp: Date.now(), ttl: ttlMs });
}

/**
 * Get the latest Amazon Linux 2023 ARM64 AMI for a region
 */
async function getLatestAmazonLinuxAMI(
  client: EC2Client,
  region: string,
  config: CloudConfig
): Promise<string> {
  const cacheKey = `ami:${region}`;
  const cached = getCached<string>(cacheKey);
  if (cached) {
    console.log(`[aws] Using cached AMI for ${region}: ${cached}`);
    return cached;
  }

  try {
    console.log(`[aws] Fetching latest Amazon Linux 2023 ARM64 AMI for ${region}`);

    const command = new DescribeImagesCommand({
      Owners: ['amazon'],
      Filters: [
        { Name: 'name', Values: ['al2023-ami-*-kernel-*-arm64'] },
        { Name: 'state', Values: ['available'] },
        { Name: 'architecture', Values: ['arm64'] },
        { Name: 'virtualization-type', Values: ['hvm'] }
      ]
    });

    const response = await client.send(command);

    if (!response.Images || response.Images.length === 0) {
      throw new Error(`No ARM64 AMIs found for region ${region}`);
    }

    // Sort by creation date (newest first)
    const sortedImages = response.Images.sort((a, b) => {
      const dateA = new Date(a.CreationDate || 0).getTime();
      const dateB = new Date(b.CreationDate || 0).getTime();
      return dateB - dateA;
    });

    const latestAmi = sortedImages[0].ImageId!;
    console.log(`[aws] Found latest AMI for ${region}: ${latestAmi} (${sortedImages[0].Name})`);

    // Cache for 1 hour (AMIs don't change frequently)
    setCache(cacheKey, latestAmi, 60 * 60 * 1000);

    return latestAmi;
  } catch (error) {
    console.error(`[aws] Failed to fetch AMI for ${region}:`, error);

    // Use configured default AMI from wrangler.toml
    console.warn(`[aws] Using configured default AMI for ${region}: ${config.aws.defaultAmi}`);
    return config.aws.defaultAmi;
  }
}

/**
 * Get available AWS regions
 */
async function getAvailableRegions(client: EC2Client, config: CloudConfig): Promise<string[]> {
  const cacheKey = 'regions:available';
  const cached = getCached<string[]>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    console.log('[aws] Fetching available regions');

    const command = new DescribeRegionsCommand({
      AllRegions: false,
      Filters: [
        { Name: 'opt-in-status', Values: ['opt-in-not-required', 'opted-in'] }
      ]
    });

    const response = await client.send(command);
    const regions = response.Regions?.map(r => r.RegionName!).filter(Boolean) || [];

    console.log(`[aws] Found ${regions.length} available regions`);

    // Cache for 24 hours (regions don't change frequently)
    setCache(cacheKey, regions, 24 * 60 * 60 * 1000);

    return regions;
  } catch (error) {
    console.error('[aws] Failed to fetch regions:', error);

    // Use configured regions from wrangler.toml
    console.warn('[aws] Using configured regions from config');
    return config.aws.regions;
  }
}

/**
 * Get instance type specifications
 */
async function getInstanceTypeSpecs(
  client: EC2Client,
  region: string
): Promise<Map<string, ServerTypeInfo>> {
  const cacheKey = `instance-types:${region}`;
  const cached = getCached<Map<string, ServerTypeInfo>>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    console.log(`[aws] Fetching t4g instance type specifications for ${region}`);

    const command = new DescribeInstanceTypesCommand({
      Filters: [
        { Name: 'instance-type', Values: ['t4g.*'] },
        { Name: 'processor-info.supported-architecture', Values: ['arm64'] }
      ]
    });

    const response = await client.send(command);
    const specsMap = new Map<string, ServerTypeInfo>();

    for (const instanceType of response.InstanceTypes || []) {
      const name = instanceType.InstanceType!;
      const vcpus = instanceType.VCpuInfo?.DefaultVCpus || 0;
      const memoryGiB = instanceType.MemoryInfo?.SizeInMiB
        ? instanceType.MemoryInfo.SizeInMiB / 1024
        : 0;
      const storage = instanceType.InstanceStorageInfo?.TotalSizeInGB || 0;

      specsMap.set(name, {
        name,
        vcpus,
        memory: memoryGiB,
        storage,
        priceHourly: 0, // Will be filled by pricing API
        availability: [] // Will be filled by pricing API
      });
    }

    console.log(`[aws] Found ${specsMap.size} t4g instance types`);

    // Cache for 24 hours
    setCache(cacheKey, specsMap, 24 * 60 * 60 * 1000);

    return specsMap;
  } catch (error) {
    console.error('[aws] Failed to fetch instance types:', error);
    throw new Error(`Failed to fetch instance type specifications: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get pricing for instance types across regions
 * Note: AWS Pricing API only works from us-east-1 region
 */
async function getInstancePricing(
  env: AWSBindings,
  instanceType: string,
  regions: string[]
): Promise<Map<string, number>> {
  const cacheKey = `pricing:${instanceType}`;
  const cached = getCached<Map<string, number>>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    console.log(`[aws] Fetching pricing for ${instanceType}`);

    // Pricing API requires us-east-1
    const pricingClient = new PricingClient({
      region: 'us-east-1',
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY
      }
    });

    const pricingMap = new Map<string, number>();

    // Query pricing for each region
    for (const region of regions) {
      try {
        const command = new GetProductsCommand({
          ServiceCode: 'AmazonEC2',
          Filters: [
            { Type: 'TERM_MATCH', Field: 'instanceType', Value: instanceType },
            { Type: 'TERM_MATCH', Field: 'regionCode', Value: region },
            { Type: 'TERM_MATCH', Field: 'tenancy', Value: 'Shared' },
            { Type: 'TERM_MATCH', Field: 'operatingSystem', Value: 'Linux' },
            { Type: 'TERM_MATCH', Field: 'preInstalledSw', Value: 'NA' },
            { Type: 'TERM_MATCH', Field: 'capacitystatus', Value: 'Used' }
          ],
          MaxResults: 1
        });

        const response = await pricingClient.send(command);

        if (response.PriceList && response.PriceList.length > 0) {
          const priceData = JSON.parse(response.PriceList[0]);
          const onDemand = priceData.terms?.OnDemand;

          if (onDemand) {
            const firstTerm = Object.values(onDemand)[0] as any;
            const priceDimensions = firstTerm?.priceDimensions;

            if (priceDimensions) {
              const firstDimension = Object.values(priceDimensions)[0] as any;
              const pricePerUnit = parseFloat(firstDimension?.pricePerUnit?.USD || '0');

              if (pricePerUnit > 0) {
                pricingMap.set(region, pricePerUnit);
              }
            }
          }
        }
      } catch (regionError) {
        console.warn(`[aws] Failed to get pricing for ${region}:`, regionError);
      }
    }

    console.log(`[aws] Found pricing for ${pricingMap.size} regions`);

    // Cache for 1 hour
    setCache(cacheKey, pricingMap, 60 * 60 * 1000);

    return pricingMap;
  } catch (error) {
    console.error('[aws] Failed to fetch pricing:', error);
    throw new Error(`Failed to fetch pricing data: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * AWS Cloud adapter using AWS SDK v3.
 * Compatible with Cloudflare Workers runtime.
 */
export function createAWSAdapter(env: AWSBindings): CloudProviderAdapter {
  const region = env.AWS_REGION;

  // Parse cloud configuration from environment
  let config: CloudConfig;
  try {
    config = JSON.parse(env.CLOUD_CONFIG);
  } catch (error) {
    throw new Error(
      `Failed to parse CLOUD_CONFIG: ${error instanceof Error ? error.message : String(error)}. ` +
      `Please ensure CLOUD_CONFIG is valid JSON without trailing commas.`
    );
  }

  // Create EC2 client with credentials from environment
  const client = new EC2Client({
    region,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY
    }
  });

  return {
    getProviderName(): string {
      return "aws";
    },

    async createServer(opts: ServerCreationOptions): Promise<CloudServer> {
      try {
        console.log(`[aws] Creating instance: ${opts.name} (${opts.serverType || config.aws.defaultInstanceType}) in ${opts.region || region}`);

        // Get or create security group
        const securityGroupId = await getOrCreateSecurityGroup(client, region);

        // Get the latest ARM64 AMI for the region dynamically
        const amiId = await getLatestAmazonLinuxAMI(client, opts.region || region, config);

        // Prepare user data (cloud-init) - use btoa for Cloudflare Workers compatibility
        const userData = opts.cloudInit ? btoa(opts.cloudInit) : undefined;

        // Run EC2 instance
        const command = new RunInstancesCommand({
          ImageId: amiId,
          InstanceType: (opts.serverType || config.aws.defaultInstanceType) as _InstanceType,
          MinCount: 1,
          MaxCount: 1,
          SecurityGroupIds: [securityGroupId],
          UserData: userData,
          TagSpecifications: [
            {
              ResourceType: 'instance',
              Tags: [
                { Key: 'Name', Value: opts.name },
                { Key: 'Project', Value: 'Zeroclaw' },
                { Key: 'ManagedBy', Value: 'zeroclaw-deploy' }
              ]
            }
          ]
        });

        const response = await client.send(command);

        if (!response.Instances || response.Instances.length === 0) {
          throw new Error('No instance returned from RunInstances');
        }

        const instance = response.Instances[0];
        console.log(`[aws] Instance created successfully: ${instance.InstanceId}`);

        return {
          id: instance.InstanceId!,
          name: opts.name,
          status: mapAWSStatusToStandard(instance.State?.Name || 'pending'),
          publicIp: instance.PublicIpAddress || null,
          region: opts.region || region,
          serverType: opts.serverType || config.aws.defaultInstanceType,
          provider: 'aws'
        };
      } catch (error) {
        console.error('[aws] Failed to create instance:', error);
        throw new Error(`AWS createServer failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    async deleteServer(serverId: string): Promise<void> {
      try {
        console.log(`[aws] Terminating instance: ${serverId}`);

        const command = new TerminateInstancesCommand({
          InstanceIds: [serverId]
        });

        await client.send(command);
        console.log(`[aws] Instance terminated successfully: ${serverId}`);
      } catch (error) {
        console.error('[aws] Failed to terminate instance:', error);

        // Don't throw on 404-equivalent errors
        if (error instanceof Error && error.message.includes('InvalidInstanceID.NotFound')) {
          console.log(`[aws] Instance ${serverId} not found, assuming already deleted`);
          return;
        }

        throw new Error(`AWS deleteServer failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    async getServer(serverId: string): Promise<CloudServer | null> {
      try {
        const command = new DescribeInstancesCommand({
          InstanceIds: [serverId]
        });

        const response = await client.send(command);

        if (!response.Reservations || response.Reservations.length === 0) {
          return null;
        }

        const instances = response.Reservations[0].Instances;
        if (!instances || instances.length === 0) {
          return null;
        }

        const instance = instances[0];

        return {
          id: instance.InstanceId!,
          name: instance.Tags?.find(tag => tag.Key === 'Name')?.Value || '',
          status: mapAWSStatusToStandard(instance.State?.Name || 'pending'),
          publicIp: instance.PublicIpAddress || null,
          region: instance.Placement?.AvailabilityZone?.slice(0, -1) || region, // Remove AZ letter
          serverType: instance.InstanceType || 't4g.nano',
          provider: 'aws'
        };
      } catch (error) {
        console.error('[aws] Failed to get instance:', error);

        // Return null for not found errors
        if (error instanceof Error && error.message.includes('InvalidInstanceID.NotFound')) {
          return null;
        }

        return null;
      }
    },

    async getCheapestRegion(serverType: string): Promise<RegionPricing> {
      try {
        console.log(`[aws] Finding cheapest region for ${serverType}`);

        // Get available regions
        const regions = await getAvailableRegions(client, config);

        // Get pricing for the instance type across regions
        const pricingMap = await getInstancePricing(env, serverType, regions);

        if (pricingMap.size === 0) {
          throw new Error('No pricing data available from API or config');
        }

        // Find cheapest region
        let cheapestRegion = config.aws.defaultRegion;
        let cheapestPrice = Number.MAX_VALUE;

        for (const [region, price] of Array.from(pricingMap.entries())) {
          if (price < cheapestPrice) {
            cheapestPrice = price;
            cheapestRegion = region;
          }
        }

        console.log(`[aws] getCheapestRegion: "${serverType}" -> "${cheapestRegion}" ($${cheapestPrice}/hr)`);
        return { region: cheapestRegion, priceHourly: cheapestPrice };
      } catch (error) {
        console.error('[aws] getCheapestRegion error:', error);
        throw error;
      }
    },

    async listAvailableServerTypes(): Promise<ServerTypeInfo[]> {
      try {
        console.log('[aws] Fetching available server types');

        // Get instance type specifications
        const specsMap = await getInstanceTypeSpecs(client, region);

        // Get available regions
        const regions = await getAvailableRegions(client, config);

        // Get pricing for t4g.nano (as reference for pricing structure)
        const pricingMap = await getInstancePricing(env, config.aws.defaultInstanceType, regions);

        // Convert map to array and enrich with pricing data
        const serverTypes: ServerTypeInfo[] = [];

        for (const [instanceType, specs] of Array.from(specsMap.entries())) {
          // Get pricing for this specific instance type if not already fetched
          let typePricingMap = pricingMap;
          if (instanceType !== config.aws.defaultInstanceType) {
            typePricingMap = await getInstancePricing(env, instanceType, regions);
          }

          // Calculate average price across regions
          const prices = Array.from(typePricingMap.values());
          const avgPrice = prices.length > 0
            ? prices.reduce((sum, p) => sum + p, 0) / prices.length
            : specs.priceHourly;

          serverTypes.push({
            ...specs,
            priceHourly: avgPrice,
            availability: Array.from(typePricingMap.keys())
          });
        }

        console.log(`[aws] Found ${serverTypes.length} available server types`);
        return serverTypes;
      } catch (error) {
        console.error('[aws] Failed to list server types:', error);
        throw error;
      }
    }
  };
}

/**
 * Maps AWS instance state to our standard status
 */
function mapAWSStatusToStandard(awsStatus: string): CloudServer['status'] {
  switch (awsStatus) {
    case 'pending':
      return 'initializing';
    case 'running':
      return 'running';
    case 'stopping':
      return 'stopping';
    case 'stopped':
      return 'off';
    case 'shutting-down':
    case 'terminated':
      return 'deleting';
    default:
      return 'off';
  }
}

/**
 * Get or create a security group for Zeroclaw instances
 */
async function getOrCreateSecurityGroup(
  client: EC2Client,
  region: string
): Promise<string> {
  const groupName = 'zeroclaw-security-group';
  const description = 'Security group for Zeroclaw bot instances';

  try {
    // Check if security group exists
    const describeCommand = new DescribeSecurityGroupsCommand({
      Filters: [
        { Name: 'group-name', Values: [groupName] }
      ]
    });

    const existingGroups = await client.send(describeCommand);

    if (existingGroups.SecurityGroups && existingGroups.SecurityGroups.length > 0) {
      const groupId = existingGroups.SecurityGroups[0].GroupId!;
      console.log(`[aws] Using existing security group: ${groupId}`);
      return groupId;
    }

    // Create new security group
    console.log(`[aws] Creating new security group: ${groupName}`);
    const createCommand = new CreateSecurityGroupCommand({
      GroupName: groupName,
      Description: description
    });

    const createResult = await client.send(createCommand);
    const groupId = createResult.GroupId!;

    // Add ingress rule for SSH (port 22)
    const authorizeCommand = new AuthorizeSecurityGroupIngressCommand({
      GroupId: groupId,
      IpPermissions: [
        {
          IpProtocol: 'tcp',
          FromPort: 22,
          ToPort: 22,
          IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'SSH access' }]
        }
      ]
    });

    await client.send(authorizeCommand);

    console.log(`[aws] Security group created: ${groupId}`);
    return groupId;
  } catch (error) {
    console.error('[aws] Failed to get/create security group:', error);
    throw error;
  }
}
