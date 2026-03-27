import { NextRequest, NextResponse } from 'next/server'
import { addStagedChange } from '@/lib/github-staging'

interface FileOperationRequest {
  operation: 'write' | 'edit' | 'delete'
  path: string
  content?: string
  sha?: string
  description: string
  oldContent?: string
  newContent?: string
}

export async function POST(request: NextRequest) {
  try {
    const body: FileOperationRequest = await request.json()
    const { operation, path, content, sha, description, oldContent, newContent } = body

    if (!operation || !path) {
      return NextResponse.json(
        { success: false, message: 'Operation and path are required' },
        { status: 400 }
      )
    }

    // Generate a staging ID
    const stagingId = `file-${Date.now()}-${Math.random().toString(36).substring(7)}`

    // Stage the file operation
    if (operation === 'write' || operation === 'edit') {
      if (!content) {
        return NextResponse.json(
          { success: false, message: 'Content is required for write/edit operations' },
          { status: 400 }
        )
      }

      // Add to staging store
      addStagedChange({
        id: stagingId,
        type: operation === 'write' ? 'file_write' : 'file_edit',
        path,
        content,
        sha,
        description,
        oldContent,
        newContent,
        createdAt: new Date().toISOString(),
      })

      return NextResponse.json({
        success: true,
        stagingId,
        operation,
        path,
        message: `File ${operation} staged for approval`,
        linesChanged: content.split('\n').length,
      })
    }

    if (operation === 'delete') {
      addStagedChange({
        id: stagingId,
        type: 'file_delete',
        path,
        sha,
        description,
        createdAt: new Date().toISOString(),
      })

      return NextResponse.json({
        success: true,
        stagingId,
        operation,
        path,
        message: 'File deletion staged for approval',
      })
    }

    return NextResponse.json(
      { success: false, message: 'Invalid operation' },
      { status: 400 }
    )
  } catch (error) {
    console.error('File operation error:', error)
    return NextResponse.json(
      {
        success: false,
        message: 'Failed to process file operation',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'File operation endpoint ready',
    operations: ['write', 'edit', 'delete'],
  })
}
