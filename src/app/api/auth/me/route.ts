import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE_NAME, verifySession } from '@/lib/session'

export async function GET(request: NextRequest) {
  const secret = process.env.SESSION_SECRET
  if (!secret) {
    return NextResponse.json({ user: null }, { status: 200 })
  }
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!token) return NextResponse.json({ user: null })
  const payload = await verifySession(token, secret)
  if (!payload) return NextResponse.json({ user: null })
  return NextResponse.json({ user: { email: payload.user } })
}
