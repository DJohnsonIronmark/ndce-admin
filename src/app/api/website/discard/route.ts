import { NextRequest, NextResponse } from 'next/server'
import { requireSessionOrServiceToken } from '@/lib/session'
import { deleteBranch, isGitHubAvailable } from '@/lib/github'

export const maxDuration = 30

interface DiscardRequest {
  branch: string
}

export async function POST(request: NextRequest) {
  const auth = await requireSessionOrServiceToken(request)
  if (!auth.ok) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  if (!isGitHubAvailable()) {
    return NextResponse.json({ error: 'Storage not configured' }, { status: 500 })
  }

  let body: DiscardRequest
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { branch } = body
  if (!branch || typeof branch !== 'string' || !/^staging-[a-z0-9]+$/.test(branch)) {
    return NextResponse.json({ error: 'Invalid staging branch name' }, { status: 400 })
  }

  const del = await deleteBranch(branch)
  if (!del.success) {
    return NextResponse.json(
      { success: false, error: `Failed to delete ${branch}: ${del.error}` },
      { status: 500 },
    )
  }

  return NextResponse.json({
    success: true,
    branch,
    message: `Discarded ${branch}. No changes reached production.`,
  })
}
