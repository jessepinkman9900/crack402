"use client"

import { SSHKeysTab } from "@/components/settings/ssh-keys-tab"

export default function SSHKeysPage() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">SSH Keys</h1>
        <p className="text-muted-foreground">
          Manage SSH keys for debugging bot instances
        </p>
      </div>
      <SSHKeysTab />
    </div>
  )
}
