import { NextRequest, NextResponse } from 'next/server'
import { buildSessionCookie, signSession } from '@/lib/session'

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function POST(request: NextRequest) {
  const adminUser = process.env.ADMIN_USERNAME
  const adminPass = process.env.ADMIN_PASSWORD
  const secret = process.env.SESSION_SECRET

  if (!adminUser || !adminPass || !secret) {
    return NextResponse.json(
      { error: 'Auth is not configured. Missing ADMIN_USERNAME / ADMIN_PASSWORD / SESSION_SECRET.' },
      { status: 500 },
    )
  }

  let body: { email?: string; password?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const email = (body.email || '').trim().toLowerCase()
  const password = body.password || ''
  const expectedEmail = adminUser.trim().toLowerCase()

  // Compare both with constant-time semantics so neither field leaks via timing.
  const userOk = timingSafeStringEqual(email, expectedEmail)
  const passOk = timingSafeStringEqual(password, adminPass)
  if (!userOk || !passOk) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  const token = await signSession(expectedEmail, secret)
  const res = NextResponse.json({ success: true, user: { email: expectedEmail } })
  res.headers.append('Set-Cookie', buildSessionCookie(token))
  return res
}
