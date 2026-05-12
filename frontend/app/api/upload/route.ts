import { BACKEND_API_URL } from "@/lib/config"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  const formData = await request.formData()
  const file = formData.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json(
      { detail: "Missing form-data field: file" },
      { status: 400 },
    )
  }

  const response = await fetch(`${BACKEND_API_URL}/upload`, {
    method: "POST",
    body: formData,
    cache: "no-store",
  })

  const data = await response.json()

  return NextResponse.json(data, { status: response.status })
}