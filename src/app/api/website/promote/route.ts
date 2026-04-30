import { NextRequest, NextResponse } from 'next/server'
import { requireSessionOrServiceToken } from '@/lib/session'
import { mergeBranchToMain, deleteBranch, isGitHubAvailable } from '@/lib/github'

// Merge + branch-delete are two GitHub calls; 60s is plenty.
export const maxDuration = 60

interface PromoteRequest {
  branch: string
  commitMessage?: string
}

export async function POST(request: NextRequest) {
  const auth = await requireSessionOrServiceToken(request)
  if (!auth.ok) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  if (!isGitHubAvailable()) {
    return NextResponse.json({ error: 'Storage not configured' }, { status: 500 })
  }

  let body: PromoteRequest
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { branch, commitMessage } = body
  // Guardrail: only allow merging branches we created. Rejecting random
  // branch names protects against an attacker (or a buggy client) merging
  // some other branch into main.
  if (!branch || typeof branch !== 'string' || !/^staging-[a-z0-9]+$/.test(branch)) {
    return NextResponse.json({ error: 'Invalid staging branch name' }, { status: 400 })
  }

  const merge = await mergeBranchToMain(branch, commitMessage)
  if (!merge.success) {
    return NextResponse.json(
      { success: false, error: `Failed to merge ${branch}: ${merge.error}` },
      { status: 500 },
    )
  }

  // Best-effort delete; not fatal if it fails (e.g. branch protection).
  const del = await deleteBranch(branch)

  return NextResponse.json({
    success: true,
    branch,
    branchDeleted: del.success,
    deployUrl: 'https://ndce-site-v2.vercel.app',
    message: `Merged ${branch} into main. Production deployment will begin shortly.`,
  })
}
