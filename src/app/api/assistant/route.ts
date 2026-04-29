import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { ASSISTANT_TOOLS, AGENTIC_SYSTEM_PROMPT, executeTool } from '@/lib/assistant-tools'
import { requireSession } from '@/lib/session'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// Vercel Pro default timeout is 15s; an agentic loop with several tool
// calls (~3–8s each) easily overruns that and the UI stalls on "Thinking".
// Pro allows up to 300s.
export const maxDuration = 300

// Maximum number of agentic turns to prevent infinite loops.
// Multi-file changes (e.g. JSX + accompanying CSS) need ~10–15 turns;
// 25 leaves headroom for retries and verification.
const MAX_TURNS = 25

// If the agent makes this many consecutive search/read calls without any
// stage-producing edit, append a hint to the next tool result nudging it
// to commit to an edit_file or apply_find_replace call.
const STALL_THRESHOLD = 4

const STAGE_PRODUCING_TOOLS = new Set(['edit_file', 'write_file', 'apply_find_replace'])
const RECON_TOOLS = new Set(['search_source_code', 'search_website', 'review_website', 'list_files', 'read_file', 'preview_find_replace', 'get_component_info'])

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface AssistantAttachment {
  type: 'image' | 'video' | 'text'
  name: string
  uploadedPath?: string  // public URL path after /api/uploads/image succeeds
  contentType?: string
}

interface AssistantRequest {
  message: string
  history?: ChatMessage[]
  attachments?: AssistantAttachment[]
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
    // Require an authenticated admin session — this endpoint spends
    // Anthropic credits and triggers GitHub commits, so it can't be open.
    const session = await requireSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body: AssistantRequest = await request.json()
    const { message, history = [], attachments = [] } = body

    if ((!message || message.trim() === '') && attachments.length === 0) {
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

    // Build an attachment context block the model can read alongside
    // the user's message. The image is already committed to the site
    // repo at this point — the model just needs the public path so it
    // can put it into JSX with edit_file.
    const uploadedImages = attachments.filter(a => a.uploadedPath && a.type === 'image')
    const attachmentContext = uploadedImages.length > 0
      ? `\n\n[Attached images — already committed to public/uploads/ in the ndce-platform repo, ready to reference in JSX]\n${uploadedImages.map(a => `- "${a.name}" → src="${a.uploadedPath}"`).join('\n')}`
      : ''
    const fullMessage = message + attachmentContext

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

    // Add current message (with attachment context appended)
    messages.push({
      role: 'user',
      content: fullMessage,
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
        let { cleaned: result, payload } = extractStagingPayload(rawResult)

        // Stalled-loop nudge: if the agent has been doing recon-only calls
        // for a while without producing a staged change, append a hint to
        // the result so the model sees the prompt to commit.
        const recentToolNames = toolResults.slice(-STALL_THRESHOLD).map(t => t.name)
        const inRunOfRecon =
          recentToolNames.length >= STALL_THRESHOLD &&
          recentToolNames.every(n => RECON_TOOLS.has(n)) &&
          stagedChanges.length === 0 &&
          RECON_TOOLS.has(toolUse.name)
        if (inRunOfRecon) {
          result = `${result}\n\n---\n⚠️ **Coach note:** You've made ${recentToolNames.length} information-gathering calls in a row without staging a change. You almost certainly have enough context now. Your next action should be \`edit_file\` (preferred), \`write_file\`, or \`apply_find_replace\` — not another search or read. If you don't know what to edit, say so to the user instead of searching more.`
        }

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

    // If we exhausted turns with no final text and nothing staged, surface
    // what tools were attempted so the user can iterate instead of seeing
    // an empty bubble.
    if (!finalResponse && turn >= MAX_TURNS) {
      const lastFew = toolResults.slice(-5).map(t => `- ${t.name}(${JSON.stringify(t.input).slice(0, 100)})`).join('\n')
      finalResponse = `I ran out of steps before finishing this request (used all ${MAX_TURNS} of my action turns). Recent tool calls:\n\n${lastFew}\n\nThis usually happens when I keep searching for the same thing without finding it. Try asking again with the file path or a more specific search term.`
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
