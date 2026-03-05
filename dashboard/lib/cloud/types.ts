export type CloudProvider = "hetzner" | "aws" | "gcp" | "azure"

export interface Region {
  id: string
  name: string
  provider: CloudProvider
  flag: string
}
