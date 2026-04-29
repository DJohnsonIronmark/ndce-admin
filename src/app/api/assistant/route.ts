import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { ASSISTANT_TOOLS, AGENTIC_SYSTEM_PROMPT, executeTool } from '@/lib/assistant-tools'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// Maximum number of agentic turns to prevent infinite loops
const MAX_TURNS = 15

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface AssistantRequest {
  message: string
  history?: ChatMessage[]
}

interface StagedChangeFromTool {
  id: string
  type: 'find_replace' | 'website_update' | 'social_post'
  title: string
  description: string
  findText?: string
  replaceText?: string
  matchCount?: number
  filesAffected?: number
  stagingId?: string
  section?: string
  content?: string
  platforms?: string[]
  caption?: string
  files?: Array<{ path: string; newContent: string; sha: string }>
}

// Extracts and strips a JSON payload embedded by tools so they can pass
// structured staging data back to the route without breaking the string contract.
function extractStagingPayload(result: string): { cleaned: string; payload: { files?: Array<{ path: string; newContent: string; sha: string }> } | null } {
  const match = result.match(/<staging_payload>([\s\S]*?)<\/staging_payload>/)
  if (!match) return { cleaned: result, payload: null }
  try {
    const payload = JSON.parse(match[1])
    const cleaned = result.replace(match[0], '').trim()
    return { cleaned, payload }
  } catch {
    return { cleaned: result, payload: null }
  }
}

// Use types from Anthropic SDK
type ContentBlock = Anthropic.ContentBlock
type ToolUseBlock = Anthropic.ToolUseBlock
type TextBlock = Anthropic.TextBlock

export async function POST(request: NextRequest) {
  try {
    const body: AssistantRequest = await request.json()
    const { message, history = [] } = body

    if (!message || message.trim() === '') {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      )
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY not configured' },
        { status: 500 }
      )
    }

    // Get base URL for internal API calls
    const protocol = request.headers.get('x-forwarded-proto') || 'https'
    const host = request.headers.get('host') || 'localhost:3000'
    const baseUrl = `${protocol}://${host}`

    // Build messages array with history
    const messages: Anthropic.MessageParam[] = []

    // Add conversation history
    for (const msg of history.slice(-20)) {
      messages.push({
        role: msg.role,
        content: msg.content,
      })
    }

    // Add current message
    messages.push({
      role: 'user',
      content: message,
    })

    // Agentic loop - keep calling Claude until it doesn't use any tools
    let turn = 0
    const toolResults: Array<{ name: string; input: unknown; result: string }> = []
    let finalResponse = ''
    let taskList: unknown = null
    const stagedChanges: StagedChangeFromTool[] = []

    while (turn < MAX_TURNS) {
      turn++

      // Call Claude with tools
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: AGENTIC_SYSTEM_PROMPT,
        tools: ASSISTANT_TOOLS,
        messages,
      })

      // Check if we should stop
      if (response.stop_reason === 'end_turn') {
        // Extract final text response
        const textBlocks = response.content.filter(block => block.type === 'text') as TextBlock[]
        finalResponse = textBlocks.map(b => b.text).join('\n')
        break
      }

      // Process tool uses
      const toolUseBlocks = response.content.filter(block => block.type === 'tool_use') as ToolUseBlock[]

      if (toolUseBlocks.length === 0) {
        // No tool use, extract text and finish
        const textBlocks = response.content.filter(block => block.type === 'text') as TextBlock[]
        finalResponse = textBlocks.map(b => b.text).join('\n')
        break
      }

      // Execute each tool
      const toolResultsForMessage: Anthropic.ToolResultBlockParam[] = []

      for (const toolUse of toolUseBlocks) {
        const rawResult = await executeTool(toolUse.name, toolUse.input as Record<string, unknown>, baseUrl)
        const { cleaned: result, payload } = extractStagingPayload(rawResult)

        // Check if this is a task list creation
        if (toolUse.name === 'create_task_list') {
          try {
            const parsed = JSON.parse(result)
            if (parsed.type === 'task_list') {
              taskList = parsed.tasks
            }
          } catch {
            // Not a task list, continue normally
          }
        }

        // Check if this is a staged change from apply_find_replace
        if (toolUse.name === 'apply_find_replace' && result.includes('STAGED (NOT LIVE)')) {
          const input = toolUse.input as { findText?: string; replaceText?: string }
          // Extract staging info from result (handles markdown formatting like **Staging ID:**)
          const stagingIdMatch = result.match(/\*?\*?Staging ID:\*?\*?\s*(staged_\S+)/)
          const matchCountMatch = result.match(/Replaced (\d+) occurrence/)
          const filesMatch = result.match(/in (\d+) file/)

          stagedChanges.push({
            id: `staged-${Date.now()}-${stagedChanges.length}`,
            type: 'find_replace',
            title: 'Find & Replace',
            description: `Replace "${input.findText}" with "${input.replaceText || '(remove)'}"`,
            findText: input.findText,
            replaceText: input.replaceText || '',
            matchCount: matchCountMatch ? parseInt(matchCountMatch[1]) : 0,
            filesAffected: filesMatch ? parseInt(filesMatch[1]) : 0,
            stagingId: stagingIdMatch ? stagingIdMatch[1] : '',
            files: payload?.files,
          })
        }

        // Check if this is a staged file write
        if (toolUse.name === 'write_file' && result.includes('STAGED (NOT LIVE)')) {
          const input = toolUse.input as { path?: string; description?: string; content?: string }
          const stagingIdMatch = result.match(/\*?\*?Staging ID:\*?\*?\s*(file-\S+)/)

          stagedChanges.push({
            id: `staged-${Date.now()}-${stagedChanges.length}`,
            type: 'website_update',
            title: 'File Write',
            description: input.description || `Create/update ${input.path}`,
            section: input.path,
            content: input.content,
            stagingId: stagingIdMatch ? stagingIdMatch[1] : '',
          })
        }

        // Check if this is a staged file edit
        if (toolUse.name === 'edit_file' && result.includes('STAGED (NOT LIVE)')) {
          const input = toolUse.input as { path?: string; description?: string; oldContent?: string; newContent?: string }
          const stagingIdMatch = result.match(/\*?\*?Staging ID:\*?\*?\s*(file-\S+)/)
          // For edit_file the route needs the full new content for direct-publish.
          // Pull it from the staging payload appended by the tool.
          const fullContent = payload?.files?.[0]?.newContent

          stagedChanges.push({
            id: `staged-${Date.now()}-${stagedChanges.length}`,
            type: 'website_update',
            title: 'File Edit',
            description: input.description || `Edit ${input.path}`,
            section: input.path,
            content: fullContent ?? `Old: ${input.oldContent?.substring(0, 100)}...\nNew: ${input.newContent?.substring(0, 100)}...`,
            stagingId: stagingIdMatch ? stagingIdMatch[1] : '',
          })
        }

        toolResults.push({
          name: toolUse.name,
          input: toolUse.input,
          result: result.substring(0, 5000), // Limit result size
        })

        toolResultsForMessage.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result.substring(0, 10000), // Limit for API
        })
      }

      // Add assistant's response (with tool use) and tool results to messages
      messages.push({
        role: 'assistant',
        content: response.content as ContentBlock[],
      })

      messages.push({
        role: 'user',
        content: toolResultsForMessage,
      })
    }

    // Generate fallback response if empty but we have staged changes
    if (!finalResponse && stagedChanges.length > 0) {
      const changeDescriptions = stagedChanges.map(c => `- ${c.description}`).join('\n')
      finalResponse = `I've staged the following changes for your approval:\n\n${changeDescriptions}\n\nPlease review the changes in the preview panel and click "Approve & Publish" when ready.`
    }

    // Build response
    return NextResponse.json({
      success: true,
      response: finalResponse,
      toolsUsed: toolResults.map(t => ({ name: t.name, input: t.input })),
      turns: turn,
      taskList: taskList,
      stagedChanges: stagedChanges.length > 0 ? stagedChanges : null,
    })

  } catch (error) {
    console.error('Assistant API error:', error)
    return NextResponse.json(
      {
        error: 'Failed to process request',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
