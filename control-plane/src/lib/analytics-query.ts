/**
 * Analytics Engine SQL query helpers.
 */

export type AEQueryResult = {
  data: Record<string, unknown>[];
  rows: number;
  meta: { name: string; type: string }[];
};

export async function queryAnalyticsEngine(
  accountId: string,
  apiToken: string,
  sql: string
): Promise<AEQueryResult> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "text/plain",
    },
    body: sql,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AE query failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<AEQueryResult>;
}

/**
 * Maps a user-facing window string to a ClickHouse interval expression
 * for use in AE SQL: `timestamp > now() - parseWindowToInterval(window)`.
 */
export function parseWindowToInterval(window: string): string {
  switch (window) {
    case "1h":  return "toIntervalHour(1)";
    case "6h":  return "toIntervalHour(6)";
    case "24h": return "toIntervalHour(24)";
    case "7d":  return "toIntervalDay(7)";
    case "30d": return "toIntervalDay(30)";
    default:    return "toIntervalHour(24)";
  }
}
