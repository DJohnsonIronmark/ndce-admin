import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, copyFile, readdir, mkdir } from 'fs/promises'
import { join } from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

interface FindReplaceRequest {
  find: string
  replace: string
  preview?: boolean // If true, just show what would change without applying
  caseSensitive?: boolean
  autoDeploy?: boolean // If true, commit and deploy to Vercel immediately
  staged?: boolean // If true, apply changes but wait for manual approval before deploying
}

interface FileMatch {
  file: string
  relativePath: string
  line: number
  before: string
  after: string
  context: string
}

// ndce-platform paths
const NDCE_PLATFORM_ROOT = '/Users/drewjohnson/Downloads/ProBono Kids Activities Memory/clients/nicoles-dance-center-elite/ndce-platform'
const NDCE_PLATFORM_PATH = `${NDCE_PLATFORM_ROOT}/src`
const BACKUP_DIR = `${NDCE_PLATFORM_ROOT}/backups`

// Git commit and push to GitHub (triggers Vercel auto-deploy)
async function commitAndDeploy(find: string, replace: string, matchCount: number): Promise<{ committed: boolean; deployed: boolean; deployUrl?: string; error?: string }> {
  try {
    // Stage changes
    await execAsync(`cd "${NDCE_PLATFORM_ROOT}" && git add -A`)

    // Commit with descriptive message
    const commitMessage = `Update: Replace "${find}" with "${replace}" (${matchCount} occurrences)`
    await execAsync(`cd "${NDCE_PLATFORM_ROOT}" && git commit -m "${commitMessage}"`)

    // Push to GitHub (triggers Vercel auto-deploy)
    await execAsync(`cd "${NDCE_PLATFORM_ROOT}" && git push origin main`)

    return {
      committed: true,
      deployed: true,
      deployUrl: 'https://ndce-platform.vercel.app'
    }
  } catch (error) {
    console.error('Commit/deploy error:', error)
    return {
      committed: false,
      deployed: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// File extensions to search
const SEARCH_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js']

// Case-preserving replace function
function preserveCaseReplace(original: string, find: string, replace: string): string {
  // Check the case pattern of the found text
  if (original === find.toUpperCase()) {
    return replace.toUpperCase()
  }
  if (original === find.toLowerCase()) {
    return replace.toLowerCase()
  }
  // Title case (first letter uppercase)
  if (original[0] === find[0].toUpperCase() && original.slice(1) === find.slice(1).toLowerCase()) {
    return replace[0].toUpperCase() + replace.slice(1).toLowerCase()
  }
  // Otherwise return replacement as-is
  return replace
}

// Recursively get all files in a directory
async function getAllFiles(dir: string, files: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      // Skip node_modules and other non-source directories
      if (!['node_modules', '.next', '.git', 'backups'].includes(entry.name)) {
        await getAllFiles(fullPath, files)
      }
    } else if (SEARCH_EXTENSIONS.some(ext => entry.name.endsWith(ext))) {
      files.push(fullPath)
    }
  }

  return files
}

export async function POST(request: NextRequest) {
  try {
    const body: FindReplaceRequest = await request.json()
    const { find, replace, preview = false, caseSensitive = false, autoDeploy = false, staged = true } = body

    if (!find || find.trim() === '') {
      return NextResponse.json(
        { error: 'Find text is required' },
        { status: 400 }
      )
    }

    // Get all source files
    let files: string[]
    try {
      files = await getAllFiles(NDCE_PLATFORM_PATH)
    } catch (err) {
      console.error('Error reading directory:', err)
      return NextResponse.json(
        { error: 'Could not read ndce-platform source directory' },
        { status: 500 }
      )
    }

    // Create regex for finding matches
    const flags = caseSensitive ? 'g' : 'gi'
    const regex = new RegExp(escapeRegex(find), flags)

    // Find all matches across all files
    const allMatches: FileMatch[] = []
    const filesWithChanges: Map<string, string> = new Map()

    for (const filePath of files) {
      try {
        const content = await readFile(filePath, 'utf-8')
        const lines = content.split('\n')
        let hasMatches = false

        // Create a replacer function that preserves case
        const replacer = caseSensitive
          ? () => replace
          : (match: string) => preserveCaseReplace(match, find, replace)

        lines.forEach((line, index) => {
          if (regex.test(line)) {
            regex.lastIndex = 0
            hasMatches = true

            const newLine = line.replace(regex, replacer)
            const relativePath = filePath.replace(NDCE_PLATFORM_PATH + '/', '')

            allMatches.push({
              file: filePath,
              relativePath,
              line: index + 1,
              before: line.trim().substring(0, 200),
              after: newLine.trim().substring(0, 200),
              context: getContext(lines, index),
            })
          }
        })

        if (hasMatches) {
          const newContent = content.replace(new RegExp(escapeRegex(find), flags), replacer)
          filesWithChanges.set(filePath, newContent)
        }
      } catch (err) {
        console.warn(`Could not read file ${filePath}:`, err)
      }
    }

    if (allMatches.length === 0) {
      return NextResponse.json({
        success: false,
        message: `No matches found for "${find}" in ndce-platform source files`,
        matchCount: 0,
      })
    }

    // If preview mode, just return what would change
    if (preview) {
      return NextResponse.json({
        success: true,
        preview: true,
        matchCount: allMatches.length,
        filesAffected: filesWithChanges.size,
        matches: allMatches,
        message: `Found ${allMatches.length} occurrence(s) in ${filesWithChanges.size} file(s) that would be replaced`,
      })
    }

    // Apply the changes
    // First, create backups
    try {
      await mkdir(BACKUP_DIR, { recursive: true })
      const timestamp = Date.now()

      for (const [filePath] of filesWithChanges) {
        const relativePath = filePath.replace(NDCE_PLATFORM_PATH + '/', '')
        const backupPath = join(BACKUP_DIR, `${timestamp}-${relativePath.replace(/\//g, '_')}`)
        await copyFile(filePath, backupPath)
      }
    } catch (backupError) {
      console.warn('Could not create backups:', backupError)
    }

    // Apply the replacements
    for (const [filePath, newContent] of filesWithChanges) {
      await writeFile(filePath, newContent)
    }

    // Handle deployment based on mode
    let deployResult: { committed: boolean; deployed: boolean; deployUrl?: string; error?: string } = {
      committed: false,
      deployed: false,
      deployUrl: undefined
    }

    if (autoDeploy && !staged) {
      // Immediate deploy (old behavior)
      deployResult = await commitAndDeploy(find, replace, allMatches.length)
    }

    // Determine response based on mode
    const isStaged = staged && !autoDeploy
    const message = deployResult.deployed
      ? `Successfully replaced ${allMatches.length} occurrence(s) and deployed to ${deployResult.deployUrl}`
      : isStaged
        ? `Changes staged for review. ${allMatches.length} occurrence(s) in ${filesWithChanges.size} file(s) ready for approval.`
        : `Successfully replaced ${allMatches.length} occurrence(s) in ${filesWithChanges.size} file(s)`

    return NextResponse.json({
      success: true,
      preview: false,
      staged: isStaged,
      matchCount: allMatches.length,
      filesAffected: filesWithChanges.size,
      matches: allMatches,
      committed: deployResult.committed,
      deployed: deployResult.deployed,
      deployUrl: deployResult.deployUrl,
      requiresApproval: isStaged,
      message,
    })
  } catch (error) {
    console.error('Find-replace error:', error)
    return NextResponse.json(
      { error: 'Failed to process find-replace request' },
      { status: 500 }
    )
  }
}

// Get surrounding context for a match
function getContext(lines: string[], lineIndex: number): string {
  const start = Math.max(0, lineIndex - 1)
  const end = Math.min(lines.length - 1, lineIndex + 1)

  return lines
    .slice(start, end + 1)
    .map((l, i) => `${start + i + 1}: ${l.trim().substring(0, 100)}`)
    .join('\n')
}

// Escape special regex characters
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// GET endpoint to search for text
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const query = searchParams.get('q')

  if (!query) {
    return NextResponse.json(
      { error: 'Query parameter "q" is required' },
      { status: 400 }
    )
  }

  try {
    const files = await getAllFiles(NDCE_PLATFORM_PATH)
    const regex = new RegExp(escapeRegex(query), 'gi')
    const matches: Array<{ file: string; relativePath: string; line: number; content: string }> = []

    for (const filePath of files) {
      try {
        const content = await readFile(filePath, 'utf-8')
        const lines = content.split('\n')
        const relativePath = filePath.replace(NDCE_PLATFORM_PATH + '/', '')

        lines.forEach((line, index) => {
          if (regex.test(line)) {
            regex.lastIndex = 0
            matches.push({
              file: filePath,
              relativePath,
              line: index + 1,
              content: line.trim().substring(0, 200),
            })
          }
        })
      } catch {
        // Skip files that can't be read
      }
    }

    return NextResponse.json({
      success: true,
      query,
      matchCount: matches.length,
      matches,
    })
  } catch {
    return NextResponse.json(
      { error: 'Could not search ndce-platform source files' },
      { status: 500 }
    )
  }
}
