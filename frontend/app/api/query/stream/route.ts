import { BACKEND_API_URL } from "@/lib/config"

export async function POST(request: Request) {
  const body = (await request.json()) as { query?: unknown }
  const query = body.query

  if (typeof query !== "string" || query.trim().length === 0) {
    return Response.json(
      { error: 'JSON body must include a non-empty string "query"' },
      { status: 400 }
    )
  }

  const response = await fetch(`${BACKEND_API_URL}/query/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    cache: "no-store",
  })

  // A stream endpoint must return a readable body; otherwise treat as upstream failure.
  if (!response.body) {
    return Response.json({ error: "Backend did not return a stream." }, { status: 502 })
  }

  // Pass through NDJSON stream bytes directly so the frontend can parse incrementally.
  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
    },
  })
}
