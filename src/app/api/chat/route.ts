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
  type: 'find_replace' | 'website_update' | 'social_post' | 'verify' | 'question' | 'multi_task' | 'unknown'
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
4. **Verify Changes**: Check if text appears on the live website
5. **Answer Questions**: Help with general questions

IMPORTANT: When a user sends a message with MULTIPLE requests or tasks (like an email with several items), you MUST:
1. Identify ALL the individual tasks/requests
2. Return type: "multi_task" with a "tasks" array listing each one
3. Each task should have enough detail to be actionable

For multi-task requests, respond with:
{
  "type": "multi_task",
  "tasks": [
    { "type": "find_replace", "description": "Update age from 2 to 3", "findText": "ages 2", "replaceText": "ages 3", "status": "ready" },
    { "type": "find_replace", "description": "Remove phone number", "findText": "813-555-1234", "replaceText": "", "status": "pending" },
    { "type": "website_update", "description": "Add viewing windows info", "content": "...", "section": "about", "status": "pending" },
    { "type": "verify", "description": "Check if ages 3 is on website", "verifyText": "ages 3", "status": "pending" }
  ],
  "response": "I found 4 tasks in your request. Let me break them down..."
}

Task status meanings:
- "ready": You have all info needed to execute this task
- "pending": You need more information from the user to complete this task

For SINGLE requests, use the standard format:
{
  "type": "find_replace" | "website_update" | "social_post" | "verify" | "question",
  "findText": "text to find (for find_replace)",
  "replaceText": "replacement text (for find_replace)",
  "verifyText": "text to verify (for verify)",
  "content": "content for website/social",
  "section": "hero | about | schedule | announcement",
  "platforms": ["facebook", "instagram"],
  "response": "Your conversational response"
}

ALWAYS respond with valid JSON. Use conversation history to maintain context about previous changes made.

Examples:
- Single: "Change ages 2 to ages 3" → type: find_replace
- Single: "Verify the website shows ages 3" → type: verify
- Multi: "Here's an email from Nicole: 1) update ages to 3, 2) remove phone, 3) add viewing windows section" → type: multi_task with 3 tasks`

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
