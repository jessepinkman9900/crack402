"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { api } from "@/lib/api-client"
import { Loader2 } from "lucide-react"

interface UsageRecord {
  id: string
  botId: string
  type: string
  amount: number
  createdAt: string
}

export default function BillingPage() {
  const [balance, setBalance] = useState<number | null>(null)
  const [usage, setUsage] = useState<UsageRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadBillingData() {
      try {
        const [creditsRes, usageRes] = await Promise.all([
          api.getCredits(),
          api.getUsage({ limit: 10 }),
        ])
        setBalance(creditsRes.balance)
        setUsage(usageRes.usage)
      } catch (error) {
        console.error("Failed to load billing data:", error)
      } finally {
        setLoading(false)
      }
    }
    loadBillingData()
  }, [])

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
        <p className="text-muted-foreground">
          Manage your billing and view usage history
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Credit Balance</CardTitle>
            <CardDescription>Your current credit balance</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              ${balance !== null ? (balance / 100).toFixed(2) : "0.00"}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Credits are used for bot compute time
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Add Credits</CardTitle>
            <CardDescription>Purchase additional credits</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Credit purchasing coming soon...
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Usage History</CardTitle>
          <CardDescription>Recent usage records</CardDescription>
        </CardHeader>
        <CardContent>
          {usage.length === 0 ? (
            <p className="text-sm text-muted-foreground">No usage records yet</p>
          ) : (
            <div className="space-y-2">
              {usage.map((record) => (
                <div
                  key={record.id}
                  className="flex items-center justify-between border-b pb-2 last:border-0"
                >
                  <div>
                    <p className="text-sm font-medium">{record.type}</p>
                    <p className="text-xs text-muted-foreground">
                      Bot: {record.botId.slice(0, 8)}...
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">
                      ${(record.amount / 100).toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(record.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
