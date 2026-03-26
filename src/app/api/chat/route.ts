import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

interface ChatRequest {
  message: string
  context?: string
}

interface ParsedIntent {
  type: 'find_replace' | 'website_update' | 'social_post' | 'question' | 'unknown'
  findText?: string
  replaceText?: string
  content?: string
  section?: string
  platforms?: string[]
  response: string
}

const SYSTEM_PROMPT = `You are an AI assistant for Nicole's Dance Center Elite (NDCE), a dance studio in Lutz, FL.

Your capabilities:
1. **Find & Replace**: Detect when users want to update text across the website (e.g., "change ages 2 to ages 3", "update the phone number from X to Y")
2. **Website Updates**: Help create or modify website content sections
3. **Social Posts**: Generate engaging social media content for Facebook and Instagram
4. **Answer Questions**: Help with general questions about the studio

When you detect a find/replace request, extract:
- The text to find (findText)
- The text to replace it with (replaceText)

ALWAYS respond with valid JSON in this exact format:
{
  "type": "find_replace" | "website_update" | "social_post" | "question" | "unknown",
  "findText": "text to find (only for find_replace)",
  "replaceText": "replacement text (only for find_replace)",
  "content": "generated content for website updates or social posts",
  "section": "hero | about | schedule | announcement (for website updates)",
  "platforms": ["facebook", "instagram"] (for social posts),
  "response": "Your conversational response to the user explaining what you'll do"
}

Examples:
- "Update the minimum age from 2 to 3 across the site" → type: find_replace, findText: "ages 2", replaceText: "ages 3"
- "Change the phone number to 813-555-1234" → type: find_replace, findText: current phone, replaceText: "813-555-1234"
- "Write a post about our summer camp" → type: social_post with generated content
- "Update the hero section to promote fall registration" → type: website_update with content`

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json()
    const { message } = body

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

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: message,
        },
      ],
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
