"use client"

import { usePathname, useParams } from "next/navigation"
import Link from "next/link"
import { useEffect, useState } from "react"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { api } from "@/lib/api-client"

interface BreadcrumbConfig {
  label: string
  href: string | null
}

const staticBreadcrumbs: Record<string, BreadcrumbConfig[]> = {
  "/dashboard/bots": [{ label: "Bots", href: null }],
  "/dashboard/bots/launch": [
    { label: "Bots", href: "/dashboard/bots" },
    { label: "Launch an agent", href: null },
  ],
  "/dashboard/settings": [{ label: "Settings", href: null }],
  "/dashboard/settings/ssh-keys": [
    { label: "Settings", href: "/dashboard/settings" },
    { label: "SSH Keys", href: null },
  ],
  "/dashboard/settings/billing": [
    { label: "Settings", href: "/dashboard/settings" },
    { label: "Billing", href: null },
  ],
  "/dashboard/settings/account": [
    { label: "Settings", href: "/dashboard/settings" },
    { label: "Account", href: null },
  ],
}

export function DynamicBreadcrumb() {
  const pathname = usePathname()
  const params = useParams()
  const [botName, setBotName] = useState<string | null>(null)

  // Check if we're on a bot details page
  const botId = params.id as string | undefined
  const isBotDetailsPage = pathname.match(/^\/dashboard\/bots\/[^/]+$/) && botId && botId !== "launch"

  useEffect(() => {
    if (isBotDetailsPage && botId) {
      api.getBot(botId)
        .then((bot) => setBotName(bot.name))
        .catch(() => setBotName("Bot"))
    }
  }, [isBotDetailsPage, botId])

  // Determine breadcrumb configuration
  let breadcrumbs: BreadcrumbConfig[]

  if (isBotDetailsPage) {
    breadcrumbs = [
      { label: "Bots", href: "/dashboard/bots" },
      { label: botName ?? "Loading...", href: null },
    ]
  } else if (staticBreadcrumbs[pathname]) {
    breadcrumbs = staticBreadcrumbs[pathname]
  } else {
    // Fallback for unknown routes
    breadcrumbs = [{ label: "Dashboard", href: null }]
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {breadcrumbs.map((crumb, index) => (
          <BreadcrumbItem key={index}>
            {index > 0 && <BreadcrumbSeparator />}
            {crumb.href ? (
              <BreadcrumbLink asChild>
                <Link href={crumb.href}>{crumb.label}</Link>
              </BreadcrumbLink>
            ) : (
              <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
            )}
          </BreadcrumbItem>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
