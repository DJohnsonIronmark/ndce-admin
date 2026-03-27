import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatRequest {
  message: string
  history?: ChatMessage[]
}

interface TaskItem {
  type: 'find_replace' | 'website_update' | 'social_post' | 'verify' | 'question'
  description: string
  findText?: string
  replaceText?: string
  verifyText?: string
  content?: string
  section?: string
  status: 'pending' | 'ready'
}

interface ParsedIntent {
  type: 'find_replace' | 'website_update' | 'social_post' | 'verify' | 'review' | 'question' | 'multi_task' | 'unknown'
  findText?: string
  replaceText?: string
  verifyText?: string
  content?: string
  section?: string
  platforms?: string[]
  tasks?: TaskItem[]
  response: string
}

const SYSTEM_PROMPT = `You are an AI assistant for Nicole's Dance Center Elite (NDCE), a dance studio in Lutz, FL.

Your capabilities:
1. **Find & Replace**: Update text across the website (e.g., "change ages 2 to ages 3")
2. **Website Updates**: Create or modify website content sections
3. **Social Posts**: Generate social media content for Facebook and Instagram
4. **Verify Changes**: Check if SPECIFIC text appears on the live website (e.g., "verify ages 3 is on the site")
5. **Review Website**: Fetch and analyze the ENTIRE website content to see what's currently there (e.g., "review the website", "what's on the site", "show me the current content")
6. **Answer Questions**: Help with general questions

IMPORTANT DISTINCTION between verify and review:
- **verify**: Search for SPECIFIC text on the website (requires verifyText)
- **review**: Get a full analysis of ALL content currently on the website (no specific text needed)

CRITICAL - USING CONTEXT FROM CONVERSATION HISTORY:
- ALWAYS check conversation history for relevant information (phone numbers, names, text from website reviews)
- If a website review showed phone: "(813) 551-7859" and user says "remove phone number", use that EXACT number
- If context provides the info needed, mark task as "ready" with the actual values filled in
- Only mark as "pending" if the information truly cannot be determined from context

IMPORTANT - REMOVAL TASKS:
- "Remove X" or "Delete X" means find_replace with replaceText: "" (empty string)
- For removal tasks, search the conversation history for the actual text to remove
- If the phone number was shown in a website review, use THAT exact number
- Example: If review showed "(813) 551-7859", and user says "remove phone", then:
  { "type": "find_replace", "findText": "(813) 551-7859", "replaceText": "", "status": "ready" }

IMPORTANT: When a user sends a message with MULTIPLE requests or tasks (like an email with several items), you MUST:
1. Identify ALL the individual tasks/requests
2. Return type: "multi_task" with a "tasks" array listing each one
3. Use conversation history to fill in actual values where possible
4. Only mark as "pending" if info is truly missing

For multi-task requests, respond with:
{
  "type": "multi_task",
  "tasks": [
    { "type": "find_replace", "description": "Update age from 2 to 3", "findText": "ages 2", "replaceText": "ages 3", "status": "ready" },
    { "type": "find_replace", "description": "Remove phone number", "findText": "(813) 551-7859", "replaceText": "", "status": "ready" },
    { "type": "website_update", "description": "Add viewing windows info", "content": "...", "section": "about", "status": "pending" },
    { "type": "verify", "description": "Check if ages 3 is on website", "verifyText": "ages 3", "status": "pending" }
  ],
  "response": "I found 4 tasks in your request. Let me break them down..."
}

Task status meanings:
- "ready": You have all info needed to execute this task (including info from conversation history!)
- "pending": You need more information from the user to complete this task (info not in history)

For SINGLE requests, use the standard format:
{
  "type": "find_replace" | "website_update" | "social_post" | "verify" | "review" | "question",
  "findText": "text to find (for find_replace)",
  "replaceText": "replacement text (for find_replace, use empty string for removals)",
  "verifyText": "text to verify (for verify - NOT needed for review)",
  "content": "content for website/social",
  "section": "hero | about | schedule | announcement",
  "platforms": ["facebook", "instagram"],
  "response": "Your conversational response"
}

ALWAYS respond with valid JSON. Use conversation history to maintain context about previous changes made.

Examples:
- "Change ages 2 to ages 3" → type: find_replace, status: ready
- "Remove phone number" (if number known from context) → findText: "actual number", replaceText: "", status: ready
- "Remove lead teacher" (if name known from context) → findText: "actual name", replaceText: "", status: ready
- "Verify the website shows ages 3" → type: verify, verifyText: "ages 3"
- "Review the current website" → type: review (NO verifyText needed)
- "What content is on the site?" → type: review
- "Show me what's on the website" → type: review
- "What does the website currently say?" → type: review
- "Here's an email from Nicole: 1) update ages to 3, 2) remove phone" → type: multi_task with tasks`

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json()
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

    // Build messages array with history
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []

    // Add conversation history (limit to last 10 messages for context)
    const recentHistory = history.slice(-10)
    for (const msg of recentHistory) {
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

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages,
    })

    // Extract text content from response
    const textContent = response.content.find(c => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from AI')
    }

    // Parse the JSON response
    let parsed: ParsedIntent
    try {
      // Extract JSON from the response (handle markdown code blocks)
      let jsonStr = textContent.text
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (jsonMatch) {
        jsonStr = jsonMatch[1]
      }
      parsed = JSON.parse(jsonStr.trim())
    } catch {
      // If parsing fails, treat as a question/unknown
      parsed = {
        type: 'question',
        response: textContent.text,
      }
    }

    return NextResponse.json({
      success: true,
      intent: parsed,
    })
  } catch (error) {
    console.error('Chat API error:', error)
    return NextResponse.json(
      { error: 'Failed to process chat request', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
