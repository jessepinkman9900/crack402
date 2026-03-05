"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Bot, Globe, MoreHorizontal, Trash2, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
} from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export type BotStatus = "stopped" | "provisioning" | "running" | "deleting" | "deleted"

export interface Bot {
  id: string
  name: string
  status: BotStatus
  provisioningStatus: "pending_openrouter" | "pending_vm" | "pending_setup" | "ready" | "failed" | null
  region: string
}

interface BotsDashboardProps {
  bots: Bot[]
}

const STATUS_BADGE: Record<BotStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  stopped:      { label: "Stopped",      variant: "secondary" },
  provisioning: { label: "Provisioning", variant: "outline" },
  running:      { label: "Running",      variant: "default" },
  deleting:     { label: "Deleting",     variant: "outline" },
  deleted:      { label: "Deleted",      variant: "destructive" },
}

export function BotsDashboard({ bots: initialBots }: BotsDashboardProps) {
  const router = useRouter()
  const [bots, setBots] = useState<Bot[]>(initialBots)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      const apiBase = process.env.NEXT_PUBLIC_MSHIP_API_URL ?? "http://localhost:8787"
      const res = await fetch(`${apiBase}/v1/bots/${id}`, { method: "DELETE", credentials: "include" })
      if (res.ok || res.status === 204) {
        setBots((prev) => prev.filter((b) => b.id !== id))
        startTransition(() => router.refresh())
      }
    } finally {
      setDeletingId(null)
    }
  }

  const isEmpty = bots.length === 0

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      {isEmpty ? (
        /* Empty state */
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-muted">
            <Bot className="size-8 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">No bots yet</h2>
            <p className="text-sm text-muted-foreground">
              Deploy your first bot to get started.
            </p>
          </div>
          <Button asChild>
            <Link href="/dashboard/bots/launch">
              <Plus className="mr-2 h-4 w-4" />
              Create Bot
            </Link>
          </Button>
        </div>
      ) : (
        /* Populated state */
        <>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold">Bots</h1>
            <Button asChild>
              <Link href="/dashboard/bots/launch">
                <Plus className="mr-2 h-4 w-4" />
                Create Bot
              </Link>
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {bots.map((bot) => {
              const { label, variant } = STATUS_BADGE[bot.status] ?? STATUS_BADGE.stopped
              const provisioningLabel: Record<string, string> = {
                pending_openrouter: "Creating API key...",
                pending_vm:         "Launching VM...",
                pending_setup:      "Setting up...",
                failed:             "Failed",
              }
              const subLabel = bot.provisioningStatus ? provisioningLabel[bot.provisioningStatus] : null
              return (
                <Link key={bot.id} href={`/dashboard/bots/${bot.id}`}>
                  <Card className="cursor-pointer transition-colors hover:border-primary/50">
                    <CardHeader>
                      <CardTitle className="text-base">{bot.name}</CardTitle>
                      <CardAction>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={(e) => e.preventDefault()}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">Bot actions</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              disabled={deletingId === bot.id}
                              onClick={(e) => {
                                e.preventDefault()
                                handleDelete(bot.id)
                              }}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              {deletingId === bot.id ? "Deleting..." : "Delete"}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </CardAction>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant={variant} className="w-fit">
                          {label}
                        </Badge>
                        {subLabel && (
                          <span className="text-xs text-muted-foreground">{subLabel}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Globe className="h-3.5 w-3.5" />
                        <span>{bot.region}</span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
