import { BACKEND_API_URL } from "@/lib/config"

export async function GET(
  _request: Request, 
  // Dynamic route param from /api/documents/[documentId]/file
  context: { params: Promise<{ documentId: string }> }
) {
  // Resolve route params and extract the requested document id.
  const { documentId } = await context.params

  // Proxy the request to FastAPI and URL-encode the path segment for safety.
  const upstream = await fetch(
    `${BACKEND_API_URL}/documents/${encodeURIComponent(documentId)}/file`, {
    method: "GET",
    cache: "no-store",
  })

  // Pass through backend errors with original status and content type.
  if (!upstream.ok) {
    const body = await upstream.text()
    return new Response(body, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "text/plain" },
    })
  }

  // Stream PDF bytes through without buffering the whole file in memory.
  return new Response(
    upstream.body, {
      status: upstream.status, 
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/pdf",
        "content-disposition": upstream.headers.get("content-disposition") ?? "inline",
        "cache-control": "no-store",
      }
  })
}
