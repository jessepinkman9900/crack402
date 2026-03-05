import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { serverApi, type Bot } from "@/lib/api-client"
import { BotDetailsClient } from "./bot-details-client"

interface BotDetailsPageProps {
  params: Promise<{ id: string }>
}

async function fetchBot(id: string, cookie: string): Promise<Bot | null> {
  try {
    return await serverApi.getBot(id, cookie)
  } catch (err) {
    console.error("[bot-details] Failed to fetch bot:", err)
    return null
  }
}

export default async function BotDetailsPage({ params }: BotDetailsPageProps) {
  const { id } = await params

  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    redirect("/signin")
  }

  const reqHeaders = await headers()
  const cookie = reqHeaders.get("cookie") ?? ""

  const bot = await fetchBot(id, cookie)

  if (!bot) {
    redirect("/dashboard/bots")
  }

  return <BotDetailsClient bot={bot} />
}
