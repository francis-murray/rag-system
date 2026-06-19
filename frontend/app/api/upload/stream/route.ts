import { BACKEND_API_URL } from "@/lib/config"

export async function POST(request: Request) {
  const formData = await request.formData()
  const file = formData.get("file")
  if (!(file instanceof File)) {
    return Response.json(
      { detail: "Missing form-data field: file" },
      { status: 400 },
    )
  }

  const response = await fetch(`${BACKEND_API_URL}/upload/stream`, {
    method: "POST",
    body: formData,
    cache: "no-store",
  })

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
