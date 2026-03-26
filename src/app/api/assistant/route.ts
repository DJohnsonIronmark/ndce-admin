import { NextRequest, NextResponse } from 'next/server'

interface AssistantRequest {
  message: string
  attachments?: {
    type: 'image' | 'video' | 'text'
    name: string
    url?: string
  }[]
  context?: {
    currentPage?: string
    recentActions?: string[]
  }
}

interface Suggestion {
  id: string
  type: 'website_update' | 'social_post'
  title: string
  description: string
  content: string
  section?: string
  platforms?: string[]
}

// System prompt for the AI assistant
const SYSTEM_PROMPT = `You are an AI assistant for Nicole's Dance Center Elite (NDCE), a dance studio. Your role is to help manage website content and create social media posts.

When users ask for website updates, provide structured suggestions with:
- Clear title
- HTML content for the website section
- Which section to update (hero, schedule, announcement, about)

When users ask for social media posts, create engaging content with:
- Attention-grabbing opening
- Key information
- Call to action
- Relevant hashtags (always include #NicolesDanceCenterElite #NDCE)

Dance styles at NDCE: Hip Hop, Ballet, Jazz, Contemporary, Tap, Lyrical, Acro, Musical Theater
Age groups: Tiny Tots (2-4), Kids (5-8), Tweens (9-12), Teens (13-17), Adults (18+)

Keep posts under 2200 characters for Instagram. Be enthusiastic but professional.`

export async function POST(request: NextRequest) {
  try {
    const body: AssistantRequest = await request.json()
    const { message, attachments } = body

    // Check for API keys
    const openaiKey = process.env.OPENAI_API_KEY
    const anthropicKey = process.env.ANTHROPIC_API_KEY

    if (!openaiKey && !anthropicKey) {
      // Return template-based response
      return NextResponse.json({
        response: generateTemplateResponse(message, attachments),
        model: 'template',
        note: 'Using template responses. Add OPENAI_API_KEY or ANTHROPIC_API_KEY for AI-powered assistance.',
      })
    }

    // Build the user message
    let userMessage = message
    if (attachments && attachments.length > 0) {
      const attachmentDesc = attachments
        .map(a => `[Uploaded ${a.type}: ${a.name}]`)
        .join('\n')
      userMessage = `${attachmentDesc}\n\n${message}`
    }

    let aiResponse: string

    if (openaiKey) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMessage },
          ],
          max_tokens: 1000,
          temperature: 0.7,
        }),
      })

      if (!response.ok) {
        throw new Error('OpenAI API error')
      }

      const data = await response.json()
      aiResponse = data.choices[0].message.content
    } else if (anthropicKey) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
        }),
      })

      if (!response.ok) {
        throw new Error('Anthropic API error')
      }

      const data = await response.json()
      aiResponse = data.content[0].text
    } else {
      throw new Error('No API key configured')
    }

    // Parse AI response for suggestions
    const suggestions = parseAIResponse(aiResponse, message)

    return NextResponse.json({
      response: aiResponse,
      suggestions,
      model: openaiKey ? 'gpt-4o' : 'claude-3.5-sonnet',
    })
  } catch (error) {
    console.error('Assistant error:', error)
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    )
  }
}

function generateTemplateResponse(
  message: string,
  attachments?: AssistantRequest['attachments']
): { content: string; suggestions: Suggestion[] } {
  const lowerMessage = message.toLowerCase()
  const suggestions: Suggestion[] = []

  // Detect intent
  const wantsWebsiteUpdate =
    lowerMessage.includes('website') ||
    lowerMessage.includes('hero') ||
    lowerMessage.includes('update') ||
    lowerMessage.includes('change') ||
    lowerMessage.includes('schedule')

  const wantsSocialPost =
    lowerMessage.includes('post') ||
    lowerMessage.includes('social') ||
    lowerMessage.includes('facebook') ||
    lowerMessage.includes('instagram')

  const hasMedia = attachments && attachments.length > 0

  if (wantsWebsiteUpdate) {
    suggestions.push({
      id: `ws-${Date.now()}`,
      type: 'website_update',
      title: 'Website Update',
      description: 'Update your website content',
      content: generateWebsiteContent(message),
      section: detectSection(message),
    })
  }

  if (wantsSocialPost || hasMedia || !wantsWebsiteUpdate) {
    suggestions.push({
      id: `sp-${Date.now()}`,
      type: 'social_post',
      title: 'Social Media Post',
      description: 'Share on Facebook and Instagram',
      content: generateSocialContent(message, hasMedia),
      platforms: ['facebook', 'instagram'],
    })
  }

  const content =
    suggestions.length > 0
      ? `I've prepared ${suggestions.length} suggestion(s) based on your request. Review them below and apply the ones you'd like to use.`
      : `I understand you want to: "${message}". Let me help you with that.`

  return { content, suggestions }
}

function generateWebsiteContent(message: string): string {
  const lower = message.toLowerCase()

  if (lower.includes('summer') || lower.includes('camp')) {
    return `<div class="hero-content">
  <h1 class="text-5xl font-bold">Summer Dance Camp 2026</h1>
  <p class="text-xl mt-4">Join us for an unforgettable summer of dance!</p>
  <p class="mt-2">Ages 5-17 | Multiple styles | Weekly sessions</p>
  <a href="#register" class="btn btn-primary mt-6">Register Now</a>
</div>`
  }

  if (lower.includes('class') || lower.includes('schedule')) {
    return `<div class="schedule-update">
  <h2>Updated Class Schedule</h2>
  <p>Check out our latest class times and offerings.</p>
</div>`
  }

  return `<div class="content-update">
  <p>${message}</p>
</div>`
}

function generateSocialContent(message: string, hasMedia?: boolean): string {
  const lower = message.toLowerCase()

  if (hasMedia) {
    return `✨ Moments from NDCE! ✨

${lower.includes('recital') ? '🎭 Our dancers brought the house down!' : '📸 Capturing the magic of dance!'}

Every class, every rehearsal, every performance - our dancers give it their all. We're so proud of this amazing community!

#NicolesDanceCenterElite #NDCE #DanceMoments #DanceLife #DanceStudio`
  }

  if (lower.includes('hip hop')) {
    return `🔥 Hip Hop at NDCE! 🔥

Bring the energy, bring the moves! Our Hip Hop classes are where style meets skill.

All levels welcome | New session starting soon

DM us or click the link in bio to register!

#HipHop #DanceClass #NDCE #NicolesDanceCenterElite #DanceStudio`
  }

  if (lower.includes('summer') || lower.includes('camp')) {
    return `☀️ SUMMER DANCE CAMP 2026 ☀️

Get ready for the BEST summer ever!

What to expect:
✨ Multiple dance styles
✨ Professional instruction
✨ New friends & memories
✨ End-of-camp showcase

Ages 5-17 | Weekly sessions available

Registration is OPEN - spots fill fast!

#SummerCamp #DanceCamp #NDCE #NicolesDanceCenterElite`
  }

  // Generic post
  return `✨ At Nicole's Dance Center Elite ✨

${message}

Join our dance family and discover the joy of movement!

Link in bio to learn more.

#NicolesDanceCenterElite #NDCE #DanceStudio #DanceClass`
}

function detectSection(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('hero') || lower.includes('headline') || lower.includes('banner')) return 'hero'
  if (lower.includes('schedule') || lower.includes('class')) return 'schedule'
  if (lower.includes('announcement') || lower.includes('news')) return 'announcement'
  if (lower.includes('about')) return 'about'
  return 'hero'
}

function parseAIResponse(response: string, originalMessage: string): Suggestion[] {
  const suggestions: Suggestion[] = []
  const lower = originalMessage.toLowerCase()

  // Simple heuristic parsing - in production you'd want structured output
  if (lower.includes('website') || lower.includes('update') || lower.includes('hero')) {
    suggestions.push({
      id: `ws-${Date.now()}`,
      type: 'website_update',
      title: 'Website Update',
      description: 'AI-generated website content',
      content: response,
      section: detectSection(originalMessage),
    })
  }

  if (lower.includes('post') || lower.includes('social') || response.includes('#')) {
    suggestions.push({
      id: `sp-${Date.now()}`,
      type: 'social_post',
      title: 'Social Media Post',
      description: 'AI-generated social content',
      content: response,
      platforms: ['facebook', 'instagram'],
    })
  }

  // Default to social post if no clear intent
  if (suggestions.length === 0) {
    suggestions.push({
      id: `sp-${Date.now()}`,
      type: 'social_post',
      title: 'Generated Content',
      description: 'Based on your request',
      content: response,
      platforms: ['facebook', 'instagram'],
    })
  }

  return suggestions
}
