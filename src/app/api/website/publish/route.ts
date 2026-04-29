import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import { access } from 'fs/promises'
import { commitStagedChanges, updateFile, getFileContent } from '@/lib/github'
import { getStagedChanges, getAllPendingChanges, updateStagedStatus, removeStagedChanges, getGenericStagedChange, updateGenericStagedStatus, removeGenericStagedChange } from '@/lib/github-staging'

const execAsync = promisify(exec)

// Multi-file publish iterates over staged files; allow up to 5 min.
export const maxDuration = 300

const NDCE_PLATFORM_ROOT = '/Users/drewjohnson/Downloads/ProBono Kids Activities Memory/clients/nicoles-dance-center-elite/ndce-platform'

interface PublishRequest {
  action: 'publish' | 'rollback' | 'status'
  commitMessage?: string
  stagingId?: string  // Required for GitHub mode publish/rollback
  // Direct content for publishing (bypasses in-memory staging)
  path?: string
  content?: string
  sha?: string
  // Multi-file direct publish (used by find_replace) — also bypasses in-memory staging.
  files?: Array<{ path: string; newContent: string; sha?: string }>
}

// Check if local filesystem is available
async function isLocalAvailable(): Promise<boolean> {
  try {
    await access(NDCE_PLATFORM_ROOT)
    return true
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: PublishRequest = await request.json()
    const { action, commitMessage, stagingId, path, content, sha, files } = body

    // Check if we're in local mode
    const localAvailable = await isLocalAvailable()

    if (!localAvailable) {
      // GitHub mode - handle staged changes approval
      if (action === 'publish') {
        // DIRECT MULTI-FILE MODE: used by find_replace to publish many files at once
        // without depending on the in-memory staging store.
        if (files && files.length > 0) {
          const message = commitMessage || `Website update (${files.length} file${files.length === 1 ? '' : 's'})`
          const results = []
          for (const f of files) {
            // Always fetch fresh SHA to avoid conflicts when other commits have landed.
            let currentSha: string | undefined = f.sha
            try {
              const fresh = await getFileContent(f.path)
              currentSha = fresh.sha
            } catch {
              currentSha = undefined
            }
            const r = await updateFile(f.path, f.newContent, currentSha || '', message)
            results.push(r)
          }
          const successCount = results.filter(r => r.success).length
          return NextResponse.json({
            success: successCount > 0,
            action: 'published',
            filesUpdated: successCount,
            totalFiles: files.length,
            message: successCount === files.length
              ? `Successfully published ${successCount} file(s). Deployment will begin shortly.`
              : `Published ${successCount} of ${files.length} files. Some failed.`,
            errors: results.filter(r => !r.success),
            deployUrl: 'https://ndce-site-v2.vercel.app',
            mode: 'github-direct-multi',
          })
        }

        // DIRECT CONTENT MODE: If path and content are provided, commit directly
        // This bypasses in-memory staging which doesn't work in serverless
        if (path && content) {
          const message = commitMessage || `Website update: ${path.split('/').pop()}`

          try {
            // Get fresh SHA to avoid conflicts
            let currentSha = sha
            try {
              const fresh = await getFileContent(path)
              currentSha = fresh.sha
            } catch {
              // File might be new, continue without SHA
              currentSha = undefined
            }

            const result = await updateFile(
              path,
              content,
              currentSha || '',
              message
            )

            if (result.success) {
              return NextResponse.json({
                success: true,
                action: 'published',
                filesUpdated: 1,
                totalFiles: 1,
                message: `Successfully published update to ${path}. Deployment will begin shortly.`,
                deployUrl: 'https://ndce-site-v2.vercel.app',
                mode: 'github-direct',
              })
            } else {
              return NextResponse.json({
                success: false,
                message: `Failed to publish: ${result.error}`,
                mode: 'github-direct',
              })
            }
          } catch (error) {
            return NextResponse.json({
              success: false,
              message: `Error publishing file: ${error instanceof Error ? error.message : 'Unknown error'}`,
              mode: 'github-direct',
            })
          }
        }

        if (!stagingId) {
          // Check if there are any pending changes
          const pendingChanges = getAllPendingChanges()
          if (pendingChanges.length === 0) {
            return NextResponse.json({
              success: false,
              message: 'No staged changes to publish. Apply changes first using find-replace.',
              mode: 'github',
            })
          }
          // If no stagingId provided but there are pending changes, use the most recent one
          const mostRecent = pendingChanges[0]
          return NextResponse.json({
            success: false,
            message: `Found ${pendingChanges.length} pending change(s). Please specify which to publish.`,
            pendingChanges: pendingChanges.map(p => ({
              id: p.id,
              findText: p.findText,
              replaceText: p.replaceText,
              matchCount: p.matchCount,
              filesCount: p.files.length,
              createdAt: p.createdAt,
            })),
            mode: 'github',
          })
        }

        // Try to get find_replace staged changes first
        const staged = getStagedChanges(stagingId)

        // If not found, try generic staged changes (file operations)
        const genericStaged = !staged ? getGenericStagedChange(stagingId) : null

        if (!staged && !genericStaged) {
          return NextResponse.json({
            success: false,
            message: 'Staged changes not found or expired. Please apply changes again.',
            mode: 'github',
          })
        }

        // Handle generic file operations (write_file, edit_file)
        if (genericStaged) {
          if (genericStaged.status !== 'pending') {
            return NextResponse.json({
              success: false,
              message: `These changes have already been ${genericStaged.status}.`,
              mode: 'github',
            })
          }

          const message = commitMessage || genericStaged.description || 'Website update via assistant'

          try {
            // For file operations, we need to get fresh SHA and commit
            if (genericStaged.type === 'file_write' || genericStaged.type === 'file_edit') {
              // Get fresh SHA to avoid conflicts
              let sha = genericStaged.sha
              try {
                const fresh = await getFileContent(genericStaged.path!)
                sha = fresh.sha
              } catch {
                // File might be new, continue without SHA
                sha = undefined
              }

              const result = await updateFile(
                genericStaged.path!,
                genericStaged.content!,
                sha || '',
                message
              )

              if (result.success) {
                updateGenericStagedStatus(stagingId, 'approved')
                removeGenericStagedChange(stagingId)

                return NextResponse.json({
                  success: true,
                  action: 'published',
                  filesUpdated: 1,
                  totalFiles: 1,
                  message: `Successfully published file update to ${genericStaged.path}. Deployment will begin shortly.`,
                  deployUrl: 'https://ndce-site-v2.vercel.app',
                  mode: 'github',
                })
              } else {
                return NextResponse.json({
                  success: false,
                  message: `Failed to publish: ${result.error}`,
                  mode: 'github',
                })
              }
            }
          } catch (error) {
            return NextResponse.json({
              success: false,
              message: `Error publishing file: ${error instanceof Error ? error.message : 'Unknown error'}`,
              mode: 'github',
            })
          }
        }

        // Handle find_replace staged changes
        if (staged) {
          if (staged.status !== 'pending') {
            return NextResponse.json({
              success: false,
              message: `These changes have already been ${staged.status}.`,
              mode: 'github',
            })
          }

          // Commit the staged changes to GitHub
          const message = commitMessage || `Website update: Replace "${staged.findText}" with "${staged.replaceText}" (${staged.matchCount} occurrences)`

          const results = await commitStagedChanges(
            staged.files.map(f => ({
              path: f.path,
              newContent: f.newContent,
              sha: f.sha,
            })),
            message
          )

          const successCount = results.filter(r => r.success).length
          const failedResults = results.filter(r => !r.success)

          if (successCount > 0) {
            updateStagedStatus(stagingId, 'approved')
            removeStagedChanges(stagingId)
          }

          return NextResponse.json({
            success: successCount > 0,
            action: 'published',
            filesUpdated: successCount,
            totalFiles: staged.files.length,
            matchCount: staged.matchCount,
            errors: failedResults.length > 0 ? failedResults : undefined,
            message: successCount === staged.files.length
              ? `Successfully published ${staged.matchCount} change(s) across ${successCount} file(s). Deployment will begin shortly.`
              : `Published ${successCount} of ${staged.files.length} files. Some files failed to update.`,
            deployUrl: 'https://ndce-site-v2.vercel.app',
            mode: 'github',
          })
        }

        return NextResponse.json({
          success: false,
          message: 'No valid staged changes found',
          mode: 'github',
        })

      } else if (action === 'rollback') {
        if (!stagingId) {
          // Discard all pending changes
          const pendingChanges = getAllPendingChanges()
          if (pendingChanges.length === 0) {
            return NextResponse.json({
              success: true,
              action: 'rolled_back',
              message: 'No staged changes to discard.',
              mode: 'github',
            })
          }

          // Mark all as rejected
          pendingChanges.forEach(p => {
            updateStagedStatus(p.id, 'rejected')
            removeStagedChanges(p.id)
          })

          return NextResponse.json({
            success: true,
            action: 'rolled_back',
            message: `Discarded ${pendingChanges.length} pending change(s).`,
            mode: 'github',
          })
        }

        // Discard specific staged changes
        const staged = getStagedChanges(stagingId)
        if (!staged) {
          return NextResponse.json({
            success: false,
            message: 'Staged changes not found or already processed.',
            mode: 'github',
          })
        }

        updateStagedStatus(stagingId, 'rejected')
        removeStagedChanges(stagingId)

        return NextResponse.json({
          success: true,
          action: 'rolled_back',
          message: `Discarded staged changes: "${staged.findText}" → "${staged.replaceText}"`,
          mode: 'github',
        })
      }
    }

    // Local mode
    if (action === 'publish') {
      // Check if there are staged changes
      const { stdout: statusOutput } = await execAsync(`cd "${NDCE_PLATFORM_ROOT}" && git status --porcelain`)

      if (!statusOutput.trim()) {
        return NextResponse.json({
          success: false,
          message: 'No changes to publish',
          mode: 'local',
        })
      }

      // Stage all changes
      await execAsync(`cd "${NDCE_PLATFORM_ROOT}" && git add -A`)

      // Commit with message
      const message = commitMessage || `Website update via admin panel - ${new Date().toISOString()}`
      await execAsync(`cd "${NDCE_PLATFORM_ROOT}" && git commit -m "${message}"`)

      // Push to GitHub (triggers Vercel auto-deploy)
      await execAsync(`cd "${NDCE_PLATFORM_ROOT}" && git push origin main`)

      return NextResponse.json({
        success: true,
        action: 'published',
        message: 'Changes published successfully. Deployment will begin shortly.',
        deployUrl: 'https://ndce-site-v2.vercel.app',
        mode: 'local',
      })

    } else if (action === 'rollback') {
      // Discard all uncommitted changes
      await execAsync(`cd "${NDCE_PLATFORM_ROOT}" && git checkout -- .`)
      await execAsync(`cd "${NDCE_PLATFORM_ROOT}" && git clean -fd`)

      return NextResponse.json({
        success: true,
        action: 'rolled_back',
        message: 'Changes have been discarded.',
        mode: 'local',
      })
    }

    return NextResponse.json(
      { error: 'Invalid action. Use "publish" or "rollback".' },
      { status: 400 }
    )

  } catch (error) {
    console.error('Publish error:', error)
    return NextResponse.json(
      { error: 'Failed to process request', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// GET endpoint to check staged changes status
export async function GET() {
  // Check if we're in local mode
  const localAvailable = await isLocalAvailable()

  if (!localAvailable) {
    // GitHub mode - show pending staged changes
    const pendingChanges = getAllPendingChanges()

    return NextResponse.json({
      hasChanges: pendingChanges.length > 0,
      changedFiles: pendingChanges.flatMap(p =>
        p.files.map(f => ({
          stagingId: p.id,
          file: f.path,
          changes: f.changes.length,
        }))
      ),
      pendingChanges: pendingChanges.map(p => ({
        id: p.id,
        findText: p.findText,
        replaceText: p.replaceText,
        matchCount: p.matchCount,
        filesCount: p.files.length,
        createdAt: p.createdAt,
        files: p.files.map(f => ({
          path: f.path,
          changesCount: f.changes.length,
        })),
      })),
      message: pendingChanges.length > 0
        ? `${pendingChanges.length} change set(s) awaiting approval`
        : 'No pending changes',
      mode: 'github',
    })
  }

  try {
    const { stdout: statusOutput } = await execAsync(`cd "${NDCE_PLATFORM_ROOT}" && git status --porcelain`)
    const { stdout: diffOutput } = await execAsync(`cd "${NDCE_PLATFORM_ROOT}" && git diff --stat 2>/dev/null || echo ""`)

    const hasChanges = statusOutput.trim().length > 0
    const changedFiles = statusOutput.trim().split('\n').filter(Boolean).map(line => {
      const status = line.substring(0, 2).trim()
      const file = line.substring(3)
      return { status, file }
    })

    return NextResponse.json({
      hasChanges,
      changedFiles,
      diffSummary: diffOutput.trim(),
      mode: 'local',
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to check status' },
      { status: 500 }
    )
  }
}
