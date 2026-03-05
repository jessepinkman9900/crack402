"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { BsWhatsapp, BsDiscord, BsTelegram, BsSlack } from "react-icons/bs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { api } from "@/lib/api-client"
import type { SSHKey } from "@/lib/api-client"

const CHANNEL_TYPES = [
  { id: "telegram", label: "Telegram", icon: <BsTelegram /> },
  { id: "discord", label: "Discord", icon: <BsDiscord /> },
  // { id: "slack", label: "Slack", icon: <BsSlack /> },
  // { id: "whatsapp", label: "WhatsApp", icon: <BsWhatsapp /> },
]

const API_BASE = process.env.NEXT_PUBLIC_MSHIP_API_URL ?? "http://localhost:8787"

// Hardcoded to Hetzner Cloud for now
const DEFAULT_PROVIDER = "hetzner"

type BotType = "standard" | "gateway"

export default function LaunchBotPage() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [botType, setBotType] = useState<BotType>("standard")

  // Standard bot fields
  const [channelType, setChannelType] = useState("telegram")
  const [channelToken, setChannelToken] = useState("")

  // Bot version
  const [botVersion, setBotVersion] = useState("")
  const [supportedVersions, setSupportedVersions] = useState<Array<{version: string, label: string, isDefault: boolean, description: string}>>([])
  const [loadingVersions, setLoadingVersions] = useState(false)

  // Gateway bot fields
  const [gatewayHost, setGatewayHost] = useState("")
  const [gatewayPort, setGatewayPort] = useState("")
  const [gatewayNewPairing, setGatewayNewPairing] = useState(false)

  // SSH key selection
  const [sshKeyId, setSshKeyId] = useState<string>("")
  const [sshKeys, setSshKeys] = useState<SSHKey[]>([])
  const [loadingKeys, setLoadingKeys] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load SSH keys and bot versions on mount
  useEffect(() => {
    loadSSHKeys()
    loadSupportedVersions()
  }, [])

  async function loadSSHKeys() {
    setLoadingKeys(true)
    try {
      const data = await api.listSSHKeys()
      setSshKeys(data.keys)
    } catch (err) {
      console.error("Failed to load SSH keys:", err)
    } finally {
      setLoadingKeys(false)
    }
  }

  async function loadSupportedVersions() {
    setLoadingVersions(true)
    try {
      const res = await fetch(`${API_BASE}/v1/bot-versions`, {
        credentials: "include",
      })

      if (res.ok) {
        const data = await res.json()
        setSupportedVersions(data.versions || [])

        // Set default version
        const defaultVersion = data.versions?.find((v: any) => v.isDefault)
        if (defaultVersion) {
          setBotVersion(defaultVersion.version)
        }
      }
    } catch (err) {
      console.error("Failed to load supported versions:", err)
    } finally {
      setLoadingVersions(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Validate based on bot type
    if (!name.trim() || !botVersion) return

    if (botType === "standard") {
      if (!channelType || !channelToken.trim()) return
    } else {
      if (!gatewayHost.trim() || !gatewayPort.trim()) return
    }

    setSubmitting(true)
    setError(null)

    try {
      // Step 1: Create the bot record
      const res = await fetch(`${API_BASE}/v1/bots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          provider: DEFAULT_PROVIDER,
          botType,
          version: botVersion,
        }),
        credentials: "include",
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? "Failed to create bot.")
        setSubmitting(false)
        return
      }

      const created = await res.json()

      // Step 2: Trigger provisioning
      try {
        const provisionData: Record<string, unknown> = {
          sshKeyId: sshKeyId || undefined,
        }

        if (botType === "standard") {
          provisionData.channelType = channelType
          provisionData.channelToken = channelToken.trim()
        } else {
          provisionData.gatewayHost = gatewayHost.trim()
          provisionData.gatewayPort = parseInt(gatewayPort, 10)
          provisionData.gatewayNewPairing = gatewayNewPairing
        }

        await api.provisionBot(created.id, provisionData as Parameters<typeof api.provisionBot>[1])
      } catch {
        setError("Bot created but provisioning failed to start. You can retry from the dashboard.")
      }

      // Navigate back to bots list
      router.push("/dashboard/bots")
      router.refresh()
    } catch {
      setError("Network error. Please try again.")
      setSubmitting(false)
    }
  }

  function handleCancel() {
    router.push("/dashboard/bots")
  }

  const isFormValid =
    name.trim() &&
    botVersion &&
    (botType === "standard"
      ? (channelType && channelToken.trim())
      : (gatewayHost.trim() && gatewayPort.trim())
    )

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Launch an Agent</h1>
        <p className="text-muted-foreground">
          Configure and deploy a new bot instance
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Bot Configuration</CardTitle>
          <CardDescription>
            Fill in the details to create and deploy your bot
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bot-name">Name</Label>
              <Input
                id="bot-name"
                placeholder="my-trading-bot"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            {/* Bot Version */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bot-version">Bot Version</Label>
              <Select value={botVersion} onValueChange={setBotVersion} disabled={loadingVersions}>
                <SelectTrigger id="bot-version">
                  <SelectValue placeholder={loadingVersions ? "Loading versions..." : "Select a version"} />
                </SelectTrigger>
                <SelectContent>
                  {supportedVersions.map((version) => (
                    <SelectItem key={version.version} value={version.version}>
                      <div className="flex flex-col">
                        <span>{version.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Choose the Zeroclaw bot version to deploy. Latest stable is recommended.
              </p>
            </div>

            {/* Bot Type */}
            <div className="flex flex-col gap-2">
              <Label>Bot Type</Label>
              <RadioGroup value={botType} onValueChange={(v) => setBotType(v as BotType)}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="standard" id="type-standard" />
                  <Label htmlFor="type-standard" className="font-normal cursor-pointer">
                    Standard (Channel-based)
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="gateway" id="type-gateway" />
                  <Label htmlFor="type-gateway" className="font-normal cursor-pointer">
                    Gateway (Webhook-based)
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Conditional fields based on bot type */}
            {botType === "standard" ? (
              <>
                {/* Channel Type */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="bot-channel-type">Channel</Label>
                  <Select value={channelType || "telegram"} onValueChange={(v) => setChannelType(v)}>
                    <SelectTrigger id="bot-channel-type">
                      <SelectValue placeholder="Select a channel" />
                    </SelectTrigger>
                    <SelectContent>
                      {CHANNEL_TYPES.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <div className="flex items-center gap-2">{c.icon} {c.label}</div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Channel Token */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="bot-channel-token">Bot Token</Label>
                  <Input
                    id="bot-channel-token"
                    type="password"
                    placeholder={channelType === "telegram" ? "110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw" : "your-bot-token"}
                    value={channelToken}
                    onChange={(e) => setChannelToken(e.target.value)}
                    required
                  />
                </div>
              </>
            ) : (
              <>
                {/* Gateway Host */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="gateway-host">Gateway Host</Label>
                  <Input
                    id="gateway-host"
                    placeholder="gateway.example.com"
                    value={gatewayHost}
                    onChange={(e) => setGatewayHost(e.target.value)}
                    required
                  />
                </div>

                {/* Gateway Port */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="gateway-port">Gateway Port</Label>
                  <Input
                    id="gateway-port"
                    type="number"
                    placeholder="8080"
                    value={gatewayPort}
                    onChange={(e) => setGatewayPort(e.target.value)}
                    required
                  />
                </div>

                {/* Gateway New Pairing */}
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="gateway-new-pairing"
                    checked={gatewayNewPairing}
                    onCheckedChange={(checked) => setGatewayNewPairing(checked === true)}
                  />
                  <Label htmlFor="gateway-new-pairing" className="font-normal cursor-pointer">
                    New Pairing
                  </Label>
                </div>
              </>
            )}

            {/* SSH Key Selection (Optional) */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ssh-key">SSH Key (Optional)</Label>
              <Select value={sshKeyId || undefined} onValueChange={(v) => setSshKeyId(v || "")} disabled={loadingKeys}>
                <SelectTrigger id="ssh-key">
                  <SelectValue placeholder={loadingKeys ? "Loading keys..." : "None (no SSH access)"} />
                </SelectTrigger>
                <SelectContent>
                  {sshKeys.map((key) => (
                    <SelectItem key={key.id} value={key.id}>
                      {key.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Select an SSH key for debugging access to the bot instance.
              </p>
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!isFormValid || submitting}
              >
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create & Deploy
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
