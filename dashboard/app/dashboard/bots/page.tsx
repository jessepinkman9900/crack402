import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { serverApi, type Bot } from "@/lib/api-client"
import { BotsDashboard } from "@/components/bots-dashboard"

export default async function BotsPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    redirect("/signin")
  }

  const reqHeaders = await headers()
  const cookie = reqHeaders.get("cookie") ?? ""

  let botList: Bot[] = []
  try {
    const data = await serverApi.listBots(cookie)
    botList = data.bots
  } catch (err) {
    console.error("[bots] Failed to fetch bots:", err)
  }

  return (
    <BotsDashboard
      bots={botList.map((b) => ({
        id: b.id,
        name: b.name,
        status: b.status,
        provisioningStatus: b.provisioningStatus,
        region: b.region,
      }))}
    />
  )
}
