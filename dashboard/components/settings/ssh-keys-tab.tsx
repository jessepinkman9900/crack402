"use client"

import { useState, useEffect } from "react"
import { api, type SSHKey } from "@/lib/api-client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Textarea } from "@/components/ui/textarea"
import { Key, Plus, Trash2, Download, Copy, CheckCircle2, AlertCircle } from "lucide-react"
import { formatDistanceToNow } from "date-fns"

export function SSHKeysTab() {
  const [keys, setKeys] = useState<SSHKey[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showNewKeyDialog, setShowNewKeyDialog] = useState(false)
  const [showPrivateKeyDialog, setShowPrivateKeyDialog] = useState(false)
  const [newKeyName, setNewKeyName] = useState("")
  const [generatedKey, setGeneratedKey] = useState<{
    privateKey: string
    publicKey: string
    fingerprint: string
    filename: string
  } | null>(null)
  const [deleteKeyId, setDeleteKeyId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Load SSH keys
  useEffect(() => {
    loadKeys()
  }, [])

  async function loadKeys() {
    setIsLoading(true)
    setError(null)
    try {
      const data = await api.listSSHKeys()
      setKeys(data.keys)
    } catch (err) {
      setError("Failed to load SSH keys")
      console.error("Failed to load SSH keys:", err)
    } finally {
      setIsLoading(false)
    }
  }

  async function handleCreateKey() {
    if (!newKeyName.trim()) return

    setSubmitting(true)
    try {
      const data = await api.createSSHKey({ name: newKeyName.trim() })

      // Add to list
      await loadKeys()

      // Close dialog
      setShowNewKeyDialog(false)
      setNewKeyName("")

      // Show private key dialog
      setGeneratedKey({
        privateKey: data.privateKey!,
        publicKey: data.publicKey,
        fingerprint: data.fingerprint,
        filename: data.filename!,
      })
      setShowPrivateKeyDialog(true)
    } catch (err) {
      console.error("Failed to create SSH key:", err)
      setError("Failed to create SSH key")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeleteKey(id: string) {
    try {
      await api.deleteSSHKey(id)
      await loadKeys()
      setDeleteKeyId(null)
    } catch (err) {
      console.error("Failed to delete SSH key:", err)
      setError("Failed to delete SSH key")
    }
  }

  function handleCopyPrivateKey() {
    if (generatedKey) {
      navigator.clipboard.writeText(generatedKey.privateKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  function handleDownloadPrivateKey() {
    if (generatedKey) {
      const blob = new Blob([generatedKey.privateKey], { type: "text/plain" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = generatedKey.filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>SSH Keys</CardTitle>
              <CardDescription>
                Manage SSH keys for accessing your bot instances
              </CardDescription>
            </div>
            <Button onClick={() => setShowNewKeyDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Generate New Key
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && (
            <div className="text-center py-8 text-muted-foreground">
              Loading SSH keys...
            </div>
          )}

          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {!isLoading && keys.length === 0 && (
            <div className="text-center py-12">
              <div className="inline-flex size-12 items-center justify-center rounded-full bg-muted mb-4">
                <Key className="size-6 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">No SSH keys yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Generate an SSH key to access your bot instances for debugging
              </p>
              <Button onClick={() => setShowNewKeyDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Generate Your First Key
              </Button>
            </div>
          )}

          {!isLoading && keys.length > 0 && (
            <div className="space-y-4">
              {keys.map((key) => (
                <div
                  key={key.id}
                  className="flex items-start justify-between p-4 border border-border rounded-lg"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="font-semibold">{key.name}</h4>
                      <Badge variant="outline">Ed25519</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">
                      Fingerprint: <code className="text-xs">{key.fingerprint}</code>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Created {formatDistanceToNow(new Date(key.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteKeyId(key.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* New Key Dialog */}
      <Dialog open={showNewKeyDialog} onOpenChange={setShowNewKeyDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate New SSH Key</DialogTitle>
            <DialogDescription>
              Create a new Ed25519 SSH key pair for accessing your bot instances
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="key-name">Key Name</Label>
              <Input
                id="key-name"
                placeholder="e.g., my-laptop"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateKey()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowNewKeyDialog(false)
                setNewKeyName("")
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateKey}
              disabled={!newKeyName.trim() || submitting}
            >
              {submitting ? "Generating..." : "Generate Key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Private Key Dialog */}
      <Dialog open={showPrivateKeyDialog} onOpenChange={setShowPrivateKeyDialog}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] flex flex-col p-6">
          <DialogHeader>
            <DialogTitle>Save Your Private Key</DialogTitle>
            <DialogDescription>
              This is the only time you'll see this private key. Download or copy it now.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 overflow-y-auto flex-1 min-h-0 pr-1">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Store this key securely. Anyone with access to it can SSH into your bot instances.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label>Private Key</Label>
              <div className="relative">
                <Textarea
                  value={generatedKey?.privateKey || ""}
                  readOnly
                  className="font-mono text-xs h-48 resize-none pr-10"
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={handleCopyPrivateKey}
                  className="absolute top-2 right-2"
                >
                  {copied ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Fingerprint</Label>
              <code className="text-xs bg-muted px-2 py-1 rounded block break-all">
                {generatedKey?.fingerprint}
              </code>
            </div>
          </div>

          <DialogFooter className="flex-col-reverse sm:flex-row gap-2 flex-shrink-0 pt-4">
            <Button
              variant="outline"
              onClick={handleDownloadPrivateKey}
              className="w-full sm:w-auto"
            >
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
            <Button
              onClick={() => {
                setShowPrivateKeyDialog(false)
                setGeneratedKey(null)
              }}
              className="w-full sm:w-auto"
            >
              I've Saved It
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteKeyId} onOpenChange={() => setDeleteKeyId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete SSH Key?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. You won't be able to use this key to access bot instances anymore.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteKeyId && handleDeleteKey(deleteKeyId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
