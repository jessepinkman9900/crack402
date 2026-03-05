"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Copy, Check, Square, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { api, type Bot } from "@/lib/api-client"

interface BotDetailsClientProps {
  bot: Bot
}

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  running: "default",
  provisioning: "secondary",
  stopped: "outline",
  deleting: "destructive",
  deleted: "destructive",
}

const PROVISIONING_LABELS: Record<string, string> = {
  pending_openrouter: "Setting up OpenRouter...",
  pending_vm: "Creating virtual machine...",
  pending_setup: "Installing dependencies...",
  ready: "Ready",
  failed: "Failed",
}

export function BotDetailsClient({ bot: initialBot }: BotDetailsClientProps) {
  const router = useRouter()
  const [bot, setBot] = useState(initialBot)
  const [stopping, setStopping] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  async function handleStop() {
    setStopping(true)
    try {
      const updated = await api.stopBot(bot.id)
      setBot(updated)
    } catch (err) {
      console.error("Failed to stop bot:", err)
    } finally {
      setStopping(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await api.deleteBot(bot.id)
      router.push("/dashboard/bots")
      router.refresh()
    } catch (err) {
      console.error("Failed to delete bot:", err)
      setDeleting(false)
    }
  }

  function copyToClipboard(value: string, field: string) {
    navigator.clipboard.writeText(value)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const statusVariant = STATUS_VARIANTS[bot.status] ?? "outline"
  const isRunning = bot.status === "running"
  const isProvisioning = bot.status === "provisioning"

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{bot.name}</h1>
            <Badge variant={statusVariant}>
              {bot.status.charAt(0).toUpperCase() + bot.status.slice(1)}
            </Badge>
          </div>
          {isProvisioning && bot.provisioningStatus && (
            <p className="text-sm text-muted-foreground mt-1">
              {PROVISIONING_LABELS[bot.provisioningStatus] ?? bot.provisioningStatus}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {isRunning && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleStop}
              disabled={stopping}
            >
              {stopping ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Square className="mr-2 h-4 w-4" />
              )}
              Stop
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={deleting}>
                {deleting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Bot</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete &quot;{bot.name}&quot;? This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Details Grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Overview Card */}
        <Card>
          <CardHeader>
            <CardTitle>Overview</CardTitle>
            <CardDescription>General bot information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Bot ID</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono">{bot.id.slice(0, 8)}...</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => copyToClipboard(bot.id, "id")}
                >
                  {copiedField === "id" ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Type</span>
              <Badge variant="outline">
                {bot.botType === "gateway" ? "Gateway" : "Standard"}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Region</span>
              <span className="text-sm">{bot.region}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Provider</span>
              <span className="text-sm">{bot.provider}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Created</span>
              <span className="text-sm">
                {new Date(bot.createdAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Infrastructure Card */}
        <Card>
          <CardHeader>
            <CardTitle>Infrastructure</CardTitle>
            <CardDescription>Server and connection details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Server ID</span>
              {bot.serverId ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono">{bot.serverId.slice(0, 8)}...</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => copyToClipboard(bot.serverId!, "serverId")}
                  >
                    {copiedField === "serverId" ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">IP Address</span>
              {bot.ipAddress ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono">{bot.ipAddress}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => copyToClipboard(bot.ipAddress!, "ip")}
                  >
                    {copiedField === "ip" ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <Badge variant={statusVariant}>
                {bot.status.charAt(0).toUpperCase() + bot.status.slice(1)}
              </Badge>
            </div>
            {isProvisioning && bot.provisioningStatus && (
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Provisioning</span>
                <span className="text-sm">
                  {PROVISIONING_LABELS[bot.provisioningStatus] ?? bot.provisioningStatus}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Last Updated */}
      <p className="text-xs text-muted-foreground">
        Last updated: {new Date(bot.updatedAt).toLocaleString()}
      </p>
    </div>
  )
}
