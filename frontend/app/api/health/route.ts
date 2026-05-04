import { BACKEND_API_URL } from "@/lib/config"
import { NextResponse } from "next/server"

export async function GET() {
  const response = await fetch(`${BACKEND_API_URL}/health`, {
    method: "GET",
    cache: "no-store",
  })

  const data = await response.json()

  return NextResponse.json(data, { status: response.status })
}