import { NextRequest, NextResponse } from 'next/server'

interface GenerateRequest {
  contentType: string
  danceStyle?: string
  ageGroup?: string
  platforms: string[]
  customPrompt?: string
}

const CONTENT_PROMPTS: Record<string, string> = {
  class_promo: `Create an engaging social media post promoting a dance class.
Focus on the excitement and benefits of joining the class.
Include a call-to-action for registration.`,

  event_announcement: `Create an exciting announcement for an upcoming dance event.
Build anticipation and encourage attendance.
Include key details and a call-to-action.`,

  motivation: `Create an inspirational post about dance.
Encourage dancers to keep practicing and growing.
Use uplifting and motivating language.`,

  behind_scenes: `Create a behind-the-scenes post about dance studio life.
Make followers feel like insiders.
Highlight the dedication and fun of dance training.`,

  student_spotlight: `Create a post celebrating dance students.
Highlight their growth, dedication, and achievements.
Be encouraging and positive.`,

  holiday: `Create a festive holiday greeting for the dance community.
Express gratitude and warmth.
Include well-wishes for the season.`,
}

export async function POST(request: NextRequest) {
  try {
    const body: GenerateRequest = await request.json()
    const { contentType, danceStyle, ageGroup, platforms, customPrompt } = body

    // Check for API keys
    const openaiKey = process.env.OPENAI_API_KEY
    const anthropicKey = process.env.ANTHROPIC_API_KEY

    if (!openaiKey && !anthropicKey) {
      // Return a template-based response if no API keys configured
      return NextResponse.json({
        content: generateTemplateContent(contentType, danceStyle, ageGroup),
        model: 'template',
        note: 'Using template generation. Add OPENAI_API_KEY or ANTHROPIC_API_KEY for AI-powered content.'
      })
    }

    // Build the prompt
    const basePrompt = CONTENT_PROMPTS[contentType] || CONTENT_PROMPTS.motivation

    const prompt = `You are a social media manager for Nicole's Dance Center Elite, a dance studio.

${basePrompt}

${danceStyle ? `Dance Style: ${danceStyle}` : ''}
${ageGroup ? `Target Age Group: ${ageGroup}` : ''}
${platforms.length > 0 ? `Platforms: ${platforms.join(', ')}` : ''}
${customPrompt ? `Additional instructions: ${customPrompt}` : ''}

Guidelines:
- Keep the post concise and engaging (150-250 characters for main message)
- Use appropriate hashtags (3-5 relevant hashtags)
- Include emoji sparingly and appropriately
- End with a clear call-to-action
- Mention "Nicole's Dance Center Elite" or "NDCE" naturally
- Tone should be enthusiastic but professional

Generate the social media post content only, no explanations.`

    let generatedContent: string

    if (openaiKey) {
      // Use OpenAI
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a creative social media content writer for a dance studio.' },
            { role: 'user', content: prompt }
          ],
          max_tokens: 500,
          temperature: 0.7,
        }),
      })

      if (!response.ok) {
        throw new Error('OpenAI API error')
      }

      const data = await response.json()
      generatedContent = data.choices[0].message.content

      return NextResponse.json({
        content: generatedContent,
        model: 'gpt-4o-mini',
      })
    } else if (anthropicKey) {
      // Use Anthropic
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 500,
          messages: [
            { role: 'user', content: prompt }
          ],
        }),
      })

      if (!response.ok) {
        throw new Error('Anthropic API error')
      }

      const data = await response.json()
      generatedContent = data.content[0].text

      return NextResponse.json({
        content: generatedContent,
        model: 'claude-3-haiku',
      })
    }

    throw new Error('No API key available')
  } catch (error) {
    console.error('AI generation error:', error)
    return NextResponse.json(
      { error: 'Failed to generate content' },
      { status: 500 }
    )
  }
}

function generateTemplateContent(contentType: string, danceStyle?: string, ageGroup?: string): string {
  const templates: Record<string, string> = {
    class_promo: `Ready to dance? Our ${danceStyle || 'dance'} classes are perfect for ${ageGroup || 'all ages'}!

Join Nicole's Dance Center Elite and discover the joy of movement. Limited spots available!

DM us or visit the link in bio to register today!

#NicolesDanceCenterElite #DanceClass #${(danceStyle || 'Dance').replace(/\s/g, '')} #DanceStudio #JoinUs`,

    event_announcement: `SAVE THE DATE!

Something exciting is coming to NDCE! Our ${danceStyle ? danceStyle + ' ' : ''}showcase will feature our talented ${ageGroup || ''} dancers.

Stay tuned for more details!

#NDCEShowcase #DanceRecital #ComingSoon #DancePerformance`,

    motivation: `Every step you take brings you closer to your dreams.

At Nicole's Dance Center Elite, we believe in the power of dedication, practice, and passion. Keep dancing, keep growing!

See you in the studio!

#DanceMotivation #NDCE #KeepDancing #DreamBig #DanceLife`,

    behind_scenes: `A peek behind the curtain at NDCE!

This is where the magic happens - our ${ageGroup || ''} ${danceStyle || ''} dancers putting in the work, perfecting every move.

Dedication + Passion = Excellence

#BehindTheScenes #StudioLife #DanceRehearsals #NDCE`,

    student_spotlight: `SPOTLIGHT on our amazing dancers!

We're so proud of the dedication and growth we see every day at Nicole's Dance Center Elite. These dancers inspire us!

Keep shining, dancers!

#StudentSpotlight #DancerLife #ProudMoments #NDCE #DanceCommunity`,

    holiday: `Warm wishes from the NDCE family!

We're grateful for our incredible dance community - dancers, parents, and supporters who make our studio special.

Wishing you joy, peace, and lots of dancing!

#NDCEFamily #DanceCommunity #Grateful #HappyHolidays`,
  }

  return templates[contentType] || templates.motivation
}
