import type { CloudServer } from "../types";

/**
 * In-memory state store for mock bot/server lifecycle.
 * Simulates cloud server state transitions.
 * State is per-isolate (reset on worker restart) — fine for local dev.
 */

const servers = new Map<string, CloudServer>();

let idCounter = 1000;

export function nextServerId(): string {
  return String(++idCounter);
}

export function getServer(id: string): CloudServer | null {
  return servers.get(id) ?? null;
}

export function setServer(server: CloudServer): void {
  servers.set(server.id, server);
}

export function deleteServer(id: string): boolean {
  return servers.delete(id);
}

export function listServers(): CloudServer[] {
  return Array.from(servers.values());
}
