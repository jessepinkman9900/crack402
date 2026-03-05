import { NextRequest } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_MSHIP_API_URL ?? "http://localhost:8787";

/**
 * Proxy all /api/auth/* requests to the Mothership API.
 *
 * This keeps the auth flow on the same origin as the frontend
 * so cookies (Set-Cookie) work correctly without cross-origin issues.
 */
async function proxyAuth(request: NextRequest) {
  const url = new URL(request.url);
  const targetUrl = `${API_BASE}${url.pathname}${url.search}`;

  const headers = new Headers(request.headers);
  // Remove host header so it doesn't conflict
  headers.delete("host");

  const res = await fetch(targetUrl, {
    method: request.method,
    headers,
    body: request.body,
    redirect: "manual", // Don't follow redirects — let the browser handle them
  });

  // Forward the response including Set-Cookie headers
  const responseHeaders = new Headers(res.headers);

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: responseHeaders,
  });
}

export async function GET(request: NextRequest) {
  return proxyAuth(request);
}

export async function POST(request: NextRequest) {
  return proxyAuth(request);
}
