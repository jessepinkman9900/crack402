import type { CloudProvider, Region } from "./types"
import { getHetznerRegions } from "./providers/hetzner"

export async function getRegions(provider: CloudProvider): Promise<Region[]> {
  switch (provider) {
    case "hetzner":
      return getHetznerRegions()
    // case "aws":   return getAwsRegions()   ← extend here
    // case "gcp":   return getGcpRegions()
    // case "azure": return getAzureRegions()
    default:
      throw new Error(`Unsupported provider: ${provider}`)
  }
}

export type { CloudProvider, Region }
