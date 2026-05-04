import { BACKEND_API_URL } from "@/lib/config"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  // Read the client payload once from the request stream.
  const body = (await request.json()) as { query?: unknown }
  const query = body.query

  // Enforce the backend contract: query must be a non-empty string.
  if (typeof query !== "string" || query.trim().length === 0) {
    return NextResponse.json(
      { error: 'JSON body must include a non-empty string "query"' },
      { status: 400 }
    )
  }

  // Forward only the validated field to the FastAPI /query endpoint.
  const response = await fetch(`${BACKEND_API_URL}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    cache: "no-store",
  })

  // Return JSON explicitly while preserving backend status.
  const data = await response.json()
  return NextResponse.json(data, { status: response.status })
}