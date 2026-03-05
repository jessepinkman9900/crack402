import type { Region } from "../types"

// TODO: Replace hardcoded list with live Hetzner API call:
//   const response = await fetch("https://api.hetzner.cloud/v1/locations", {
//     headers: { Authorization: `Bearer ${process.env.HETZNER_API_KEY}` },
//   })
//   const { locations } = await response.json()
//   return locations.map((l) => ({ id: l.name, name: l.description, provider: "hetzner", flag: ... }))

const HETZNER_REGIONS: Region[] = [
  { id: "nbg1", name: "Nuremberg, Germany",    provider: "hetzner", flag: "🇩🇪" },
  { id: "fsn1", name: "Falkenstein, Germany",  provider: "hetzner", flag: "🇩🇪" },
  { id: "hel1", name: "Helsinki, Finland",     provider: "hetzner", flag: "🇫🇮" },
  { id: "ash",  name: "Ashburn, Virginia, US", provider: "hetzner", flag: "🇺🇸" },
  { id: "hil",  name: "Hillsboro, Oregon, US", provider: "hetzner", flag: "🇺🇸" },
  { id: "sin",  name: "Singapore",             provider: "hetzner", flag: "🇸🇬" },
]

export async function getHetznerRegions(): Promise<Region[]> {
  return HETZNER_REGIONS
}
