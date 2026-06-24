import { BACKEND_API_URL } from "@/lib/config"

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ documentId: string }> }
) {
  const { documentId } = await context.params

  const upstream = await fetch(
    `${BACKEND_API_URL}/documents/${encodeURIComponent(documentId)}`,
    { method: "DELETE" }
  )

  if (!upstream.ok) {
    const body = await upstream.text()
    return new Response(body, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "text/plain" },
    })
  }

  return new Response(null, { status: 204 })
}
