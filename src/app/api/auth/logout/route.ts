import { NextResponse } from 'next/server'
import { buildClearSessionCookie } from '@/lib/session'

export async function POST() {
  const res = NextResponse.json({ success: true })
  res.headers.append('Set-Cookie', buildClearSessionCookie())
  return res
}
