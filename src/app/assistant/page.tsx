'use client'

import { useState, useRef } from 'react'
import Sidebar from '@/components/Sidebar'
import { Send, Upload, Image, Video, FileText, Sparkles, Globe, MessageSquare, X, Check, Loader2, Clock, CheckCircle, XCircle, Rocket } from 'lucide-react'
import ProgressTracker, { ProgressStep, UPDATE_STEPS, VERIFY_STEPS } from '@/components/ProgressTracker'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  attachments?: Attachment[]
  suggestions?: Suggestion[]
  progressSteps?: ProgressStep[]
  timestamp: Date
}

interface Attachment {
  type: 'image' | 'video' | 'text'
  name: string
  url?: string
  preview?: string
}

interface Suggestion {
  id: string
  type: 'website_update' | 'social_post' | 'find_replace'
  title: string
  description: string
  content: string
  section?: string
  platforms?: string[]
  status: 'pending' | 'staged' | 'applied' | 'rejected'
  // For find-replace operations
  findText?: string
  replaceText?: string
  matchCount?: number
  filesAffected?: number
  // For staged changes requiring approval
  requiresApproval?: boolean
}

interface StagedChange {
  suggestionId: string
  messageId: string
  findText: string
  replaceText: string
  matchCount: number
  filesAffected: number
}

const EXAMPLE_PROMPTS = [
  "Update the hero text to promote our summer dance camp",
  "Create a post about our new hip hop class starting next month",
  "I have photos from last weekend's recital - suggest some posts",
  "Change the class schedule section to show new fall hours",
  "Write an announcement about our guest instructor workshop",
]

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: `Hi! I'm your NDCE content assistant. I can help you:

• **Update the website** - Change text, add announcements, update schedules
• **Create social posts** - Generate engaging content for Facebook & Instagram
• **Process your media** - Upload photos or videos and I'll suggest posts

Just tell me what you'd like to do, or upload some content to get started!`,
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [stagedChanges, setStagedChanges] = useState<StagedChange[]>([])
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([])
  const [isPublishing, setIsPublishing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() && attachments.length === 0) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      attachments: attachments.length > 0 ? [...attachments] : undefined,
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setAttachments([])
    setIsLoading(true)

    try {
      // Show initial progress for understanding
      setProgressSteps([
        { ...VERIFY_STEPS.UNDERSTANDING, status: 'active' },
      ])

      // Call real AI endpoint
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: input }),
      })

      const result = await response.json()

      if (result.success && result.intent) {
        // Handle verify intent with progress tracking
        if (result.intent.type === 'verify' && result.intent.verifyText) {
          setProgressSteps([
            { ...VERIFY_STEPS.UNDERSTANDING, status: 'complete', detail: 'Detected verification request' },
            { ...VERIFY_STEPS.FETCHING, status: 'active' },
            { ...VERIFY_STEPS.SEARCHING, status: 'pending' },
            { ...VERIFY_STEPS.COMPLETE, status: 'pending' },
          ])

          await new Promise(r => setTimeout(r, 300))

          try {
            const verifyResponse = await fetch('/api/website/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ searchText: result.intent.verifyText }),
            })

            setProgressSteps(prev => prev.map(s =>
              s.id === 'fetching' ? { ...s, status: 'complete', detail: 'Website loaded' } :
              s.id === 'searching' ? { ...s, status: 'active', detail: `Looking for "${result.intent.verifyText}"` } :
              s
            ))

            await new Promise(r => setTimeout(r, 300))

            const verifyResult = await verifyResponse.json()

            if (verifyResult.success) {
              const found = verifyResult.found
              const match = verifyResult.match

              setProgressSteps(prev => prev.map(s =>
                s.id === 'searching' ? { ...s, status: 'complete', detail: found ? `Found ${match?.count || 1} match(es)` : 'Not found' } :
                s.id === 'verify-complete' ? { ...s, status: 'complete', detail: found ? 'Text verified!' : 'Text not found' } :
                s
              ))

              setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'assistant',
                content: found
                  ? `**Verified!** I checked the live website and found **"${result.intent.verifyText}"** ${match?.count || 1} time(s).\n\nContext: *"${match?.context || ''}"*`
                  : `**Not Found.** I checked the live website but could not find **"${result.intent.verifyText}"**. The change may not have been deployed yet, or the text might be slightly different.`,
                timestamp: new Date(),
              }])

              // Clear progress after delay
              setTimeout(() => setProgressSteps([]), 3000)
            }
          } catch (verifyError) {
            console.error('Verify error:', verifyError)
            setProgressSteps(prev => prev.map(s =>
              s.id === 'fetching' || s.id === 'searching' ? { ...s, status: 'error' } : s
            ))
            setMessages(prev => [...prev, {
              id: Date.now().toString(),
              role: 'assistant',
              content: `I tried to verify the website but encountered an error. Please try again or check the website directly at https://ndce-platform.vercel.app`,
              timestamp: new Date(),
            }])
            setTimeout(() => setProgressSteps([]), 3000)
          }
        } else {
          // Clear progress for non-verify intents
          setProgressSteps([])
          const aiResponse = await processAIIntent(result.intent, attachments)
          setMessages(prev => [...prev, aiResponse])
        }
      } else {
        // Fallback to pattern matching if AI fails
        setProgressSteps([])
        const aiResponse = generateAIResponse(input, attachments)
        setMessages(prev => [...prev, aiResponse])
      }
    } catch (error) {
      console.error('AI chat error:', error)
      // Fallback to pattern matching
      setProgressSteps([])
      const aiResponse = generateAIResponse(input, attachments)
      setMessages(prev => [...prev, aiResponse])
    }

    setIsLoading(false)
  }

  // Process AI intent into a message with suggestions
  const processAIIntent = async (intent: {
    type: string
    findText?: string
    replaceText?: string
    verifyText?: string
    content?: string
    section?: string
    platforms?: string[]
    response: string
  }, userAttachments: Attachment[]): Promise<Message> => {
    const suggestions: Suggestion[] = []

    // Handle verification requests
    if (intent.type === 'verify') {
      if (intent.verifyText) {
        // Call the verify API to check the live website
        try {
          const verifyResponse = await fetch('/api/website/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ searchText: intent.verifyText }),
          })
          const verifyResult = await verifyResponse.json()

          if (verifyResult.success) {
            const found = verifyResult.found
            const match = verifyResult.match
            return {
              id: Date.now().toString(),
              role: 'assistant',
              content: found
                ? `**Verified!** I checked the live website and found **"${intent.verifyText}"** ${match?.count || 1} time(s).\n\nContext: *"${match?.context || ''}"*`
                : `**Not Found.** I checked the live website but could not find **"${intent.verifyText}"**. The change may not have been deployed yet, or the text might be slightly different.`,
              timestamp: new Date(),
            }
          }
        } catch (error) {
          console.error('Verify error:', error)
          return {
            id: Date.now().toString(),
            role: 'assistant',
            content: `I tried to verify the website but encountered an error. Please try again or check the website directly at https://ndce-platform.vercel.app`,
            timestamp: new Date(),
          }
        }
      } else {
        // No specific text to verify - ask what to look for
        return {
          id: Date.now().toString(),
          role: 'assistant',
          content: `I can check the live website for you! What specific text should I look for? For example, tell me "verify the website shows ages 3" or "check if the phone number is 813-555-1234".`,
          timestamp: new Date(),
        }
      }
    }

    if (intent.type === 'find_replace' && intent.findText && intent.replaceText) {
      suggestions.push({
        id: `fr-${Date.now()}`,
        type: 'find_replace',
        title: 'Find & Replace',
        description: `Replace "${intent.findText}" with "${intent.replaceText}" across the website`,
        content: `Find: ${intent.findText}\nReplace with: ${intent.replaceText}`,
        findText: intent.findText,
        replaceText: intent.replaceText,
        status: 'pending',
      })
    } else if (intent.type === 'website_update' && intent.content) {
      suggestions.push({
        id: `wu-${Date.now()}`,
        type: 'website_update',
        title: `Update ${intent.section ? intent.section.charAt(0).toUpperCase() + intent.section.slice(1) : 'Website'} Section`,
        description: 'AI-generated website content',
        content: intent.content,
        section: intent.section,
        status: 'pending',
      })
    } else if (intent.type === 'social_post' && intent.content) {
      suggestions.push({
        id: `sp-${Date.now()}`,
        type: 'social_post',
        title: 'Social Media Post',
        description: 'AI-generated social content',
        content: intent.content,
        platforms: intent.platforms || ['facebook', 'instagram'],
        status: 'pending',
      })
    }

    // Handle media uploads - suggest social posts
    if (userAttachments.length > 0 && suggestions.length === 0) {
      const hasImages = userAttachments.some(a => a.type === 'image')
      const hasVideos = userAttachments.some(a => a.type === 'video')
      suggestions.push({
        id: `mp-${Date.now()}`,
        type: 'social_post',
        title: 'Media Post',
        description: `Post with your uploaded ${hasImages && hasVideos ? 'photos and videos' : hasImages ? 'photos' : 'videos'}`,
        content: intent.content || `✨ Moments from NDCE!\n\n${hasVideos ? '🎬 Watch our dancers in action!' : '📸 Capturing the magic of dance!'}\n\n#NicolesDanceCenterElite #DanceMoments #NDCE`,
        platforms: ['facebook', 'instagram'],
        status: 'pending',
      })
    }

    return {
      id: Date.now().toString(),
      role: 'assistant',
      content: intent.response,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
      timestamp: new Date(),
    }
  }

  const generateAIResponse = (userInput: string, userAttachments: Attachment[]): Message => {
    const lowerInput = userInput.toLowerCase()
    const suggestions: Suggestion[] = []

    // Detect find-replace patterns like "change X to Y", "update X to Y", "replace X with Y"
    const findReplacePatterns = [
      /(?:change|update|replace|modify)\s+(?:the\s+)?(?:minimum\s+)?(?:age\s+)?(?:from\s+)?['"]?(\d+)['"]?\s+(?:to|with|years?\s+old\s+to)\s+['"]?(\d+)['"]?/i,
      /(?:change|update|replace|modify)\s+['"]([^'"]+)['"]\s+(?:to|with)\s+['"]([^'"]+)['"]/i,
      /(?:change|update|replace|modify)\s+(\S+)\s+(?:to|with)\s+(\S+)(?:\s+(?:across|on|throughout)\s+(?:the\s+)?(?:site|website|page))?/i,
    ]

    let findReplaceMatch: { find: string; replace: string } | null = null
    for (const pattern of findReplacePatterns) {
      const match = userInput.match(pattern)
      if (match) {
        findReplaceMatch = { find: match[1], replace: match[2] }
        break
      }
    }

    // Special case for age updates
    if (lowerInput.includes('age') && lowerInput.includes('across')) {
      const ageMatch = userInput.match(/(\d+)\s+(?:to|years?\s+old)\s+(?:to\s+)?(\d+)/i)
      if (ageMatch) {
        findReplaceMatch = { find: `ages ${ageMatch[1]}`, replace: `ages ${ageMatch[2]}` }
      }
    }

    // If we detected a find-replace operation
    if (findReplaceMatch) {
      suggestions.push({
        id: `fr-${Date.now()}`,
        type: 'find_replace',
        title: 'Find & Replace',
        description: `Replace "${findReplaceMatch.find}" with "${findReplaceMatch.replace}" across the website`,
        content: `Find: ${findReplaceMatch.find}\nReplace with: ${findReplaceMatch.replace}`,
        findText: findReplaceMatch.find,
        replaceText: findReplaceMatch.replace,
        status: 'pending',
      })

      return {
        id: Date.now().toString(),
        role: 'assistant',
        content: `I'll replace **"${findReplaceMatch.find}"** with **"${findReplaceMatch.replace}"** across your website. Click "Preview Changes" to see all occurrences, then "Apply" to make the changes.`,
        suggestions,
        timestamp: new Date(),
      }
    }

    // Detect website update intent
    const websiteKeywords = ['website', 'site', 'page', 'update', 'change', 'edit', 'modify', 'content']
    const sectionKeywords = ['hero', 'banner', 'headline', 'header', 'about', 'schedule', 'class', 'announcement', 'section']
    const socialKeywords = ['post', 'social', 'facebook', 'instagram', 'share']

    const wantsWebsiteUpdate = websiteKeywords.some(k => lowerInput.includes(k)) ||
                               sectionKeywords.some(k => lowerInput.includes(k))
    const wantsSocialPost = socialKeywords.some(k => lowerInput.includes(k))

    // Determine which section to update
    const detectSection = (): string => {
      if (lowerInput.includes('hero') || lowerInput.includes('banner') || lowerInput.includes('headline') || lowerInput.includes('header')) return 'hero'
      if (lowerInput.includes('about')) return 'about'
      if (lowerInput.includes('schedule') || lowerInput.includes('class')) return 'schedule'
      if (lowerInput.includes('announcement') || lowerInput.includes('news')) return 'announcement'
      return 'hero' // default to hero for general updates
    }

    // Generate website content based on input
    const generateWebsiteContent = (): string => {
      const section = detectSection()

      if (lowerInput.includes('summer') || lowerInput.includes('camp')) {
        return `<div class="text-center">
  <h1 class="text-5xl font-bold text-white">Summer Dance Camp 2026</h1>
  <p class="text-xl mt-4 text-white/90">Join us for an unforgettable summer of dance, creativity, and fun!</p>
  <p class="mt-2 text-white/80">Ages 5-17 welcome | Weekly sessions available</p>
</div>`
      }

      if (section === 'schedule') {
        return `<div class="schedule-section">
  <h2 class="text-3xl font-bold">Class Schedule</h2>
  <p class="mt-2">Updated class times coming soon. Contact us for current availability.</p>
</div>`
      }

      if (section === 'announcement') {
        return `<div class="announcement-banner bg-purple-600 text-white p-4 text-center">
  <p class="font-semibold">${userInput}</p>
</div>`
      }

      // Generic content update
      return `<div class="content-section">
  <p>${userInput}</p>
</div>`
    }

    // Add website update suggestion if detected
    if (wantsWebsiteUpdate && !wantsSocialPost) {
      const section = detectSection()
      suggestions.push({
        id: 's1',
        type: 'website_update',
        title: `Update ${section.charAt(0).toUpperCase() + section.slice(1)} Section`,
        description: `Modify the ${section} section of your website`,
        content: generateWebsiteContent(),
        section,
        status: 'pending',
      })
    }

    // Add social post suggestion if detected
    if (wantsSocialPost && !wantsWebsiteUpdate) {
      suggestions.push({
        id: 's2',
        type: 'social_post',
        title: 'Social Media Post',
        description: 'Ready to share on Facebook and Instagram',
        content: generatePostContent(userInput),
        platforms: ['facebook', 'instagram'],
        status: 'pending',
      })
    }

    // If both intents or ambiguous, provide both options
    if ((wantsWebsiteUpdate && wantsSocialPost) ||
        (lowerInput.includes('class') || lowerInput.includes('schedule'))) {
      if (!suggestions.some(s => s.type === 'website_update')) {
        const section = detectSection()
        suggestions.push({
          id: 's3',
          type: 'website_update',
          title: `Update ${section.charAt(0).toUpperCase() + section.slice(1)} Section`,
          description: `Modify the ${section} section of your website`,
          content: generateWebsiteContent(),
          section,
          status: 'pending',
        })
      }
      if (!suggestions.some(s => s.type === 'social_post')) {
        suggestions.push({
          id: 's4',
          type: 'social_post',
          title: 'Announcement Post',
          description: 'Share this update on social media',
          content: generatePostContent(userInput),
          platforms: ['facebook', 'instagram'],
          status: 'pending',
        })
      }
    }

    // Handle media uploads - always suggest social posts
    if (userAttachments.length > 0) {
      const hasImages = userAttachments.some(a => a.type === 'image')
      const hasVideos = userAttachments.some(a => a.type === 'video')

      if (hasImages || hasVideos) {
        suggestions.push({
          id: 's5',
          type: 'social_post',
          title: 'Media Post',
          description: `Post with your uploaded ${hasImages && hasVideos ? 'photos and videos' : hasImages ? 'photos' : 'videos'}`,
          content: `✨ Moments from NDCE!\n\n${hasVideos ? '🎬 Watch our dancers in action!' : '📸 Capturing the magic of dance!'}\n\nThank you to our amazing dance family for making every class special.\n\n#NicolesDanceCenterElite #DanceMoments #NDCE #DanceLife`,
          platforms: ['facebook', 'instagram'],
          status: 'pending',
        })
      }
    }

    // Default: Ask what they want to do
    if (suggestions.length === 0) {
      // Check if it seems like a content request
      if (userInput.length > 20) {
        // Provide both options for ambiguous requests
        suggestions.push({
          id: 's6',
          type: 'website_update',
          title: 'Website Content Update',
          description: 'Add this content to your website',
          content: `<div class="content-section">\n  <p>${userInput}</p>\n</div>`,
          section: 'announcement',
          status: 'pending',
        })
        suggestions.push({
          id: 's7',
          type: 'social_post',
          title: 'Social Media Post',
          description: 'Share this on social media',
          content: generatePostContent(userInput),
          platforms: ['facebook', 'instagram'],
          status: 'pending',
        })
      } else {
        suggestions.push({
          id: 's8',
          type: 'social_post',
          title: 'Generated Post',
          description: 'Based on your request',
          content: generatePostContent(userInput),
          platforms: ['facebook', 'instagram'],
          status: 'pending',
        })
      }
    }

    let responseContent = ''
    if (suggestions.length > 0) {
      const websiteUpdates = suggestions.filter(s => s.type === 'website_update')
      const socialPosts = suggestions.filter(s => s.type === 'social_post')

      if (websiteUpdates.length > 0 && socialPosts.length > 0) {
        responseContent = `I've prepared both **website updates** and **social media posts** based on your request. Review the suggestions below and click "Apply" to make the changes or "Add to Calendar" to schedule the posts.`
      } else if (websiteUpdates.length > 0) {
        responseContent = `I've prepared a **website update** for you. Review the content below and click "Apply" to update your site.`
      } else {
        responseContent = `I've created **social media content** based on your input. Review the posts below and add them to your calendar or post directly.`
      }
    }

    return {
      id: Date.now().toString(),
      role: 'assistant',
      content: responseContent,
      suggestions,
      timestamp: new Date(),
    }
  }

  const generatePostContent = (input: string): string => {
    const lowerInput = input.toLowerCase()

    if (lowerInput.includes('hip hop')) {
      return `🔥 Hip Hop at NDCE! 🔥\n\nBring the energy, bring the moves! Our Hip Hop classes are where style meets skill.\n\nNew session starting soon - DM us or click the link in bio to register!\n\n#HipHop #DanceClass #NDCE #NicolesDanceCenterElite`
    }

    if (lowerInput.includes('summer') || lowerInput.includes('camp')) {
      return `☀️ SUMMER DANCE CAMP 2026 ☀️\n\nGet ready for the best summer ever! Our dance camp is back with:\n✨ Multiple dance styles\n✨ Professional instruction\n✨ New friends & memories\n✨ End-of-camp showcase\n\nAges 5-17 | Register now - spots fill fast!\n\n#SummerCamp #DanceCamp #NDCE #SummerFun`
    }

    if (lowerInput.includes('recital') || lowerInput.includes('showcase')) {
      return `🌟 SAVE THE DATE 🌟\n\nOur dancers have been working SO hard, and it's almost time to show you what they've got!\n\nRecital details coming soon. Get ready to be amazed!\n\n#DanceRecital #NDCE #ProudMoments #DanceShowcase`
    }

    if (lowerInput.includes('workshop') || lowerInput.includes('guest')) {
      return `📣 SPECIAL WORKSHOP ANNOUNCEMENT 📣\n\nWe're bringing something special to NDCE! Stay tuned for details on our upcoming workshop.\n\nThis is one you won't want to miss!\n\n#DanceWorkshop #NDCE #SpecialEvent #DanceEducation`
    }

    // Generic response
    return `✨ At Nicole's Dance Center Elite ✨\n\n${input}\n\nJoin our dance family today!\n\n#NicolesDanceCenterElite #NDCE #DanceStudio #DanceLife`
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    const newAttachments: Attachment[] = []

    Array.from(files).forEach(file => {
      const isImage = file.type.startsWith('image/')
      const isVideo = file.type.startsWith('video/')

      if (isImage || isVideo) {
        const url = URL.createObjectURL(file)
        newAttachments.push({
          type: isImage ? 'image' : 'video',
          name: file.name,
          url,
          preview: isImage ? url : undefined,
        })
      }
    })

    setAttachments(prev => [...prev, ...newAttachments])
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }

  // Update progress steps helper
  const updateProgress = (stepId: string, status: 'active' | 'complete' | 'error', detail?: string) => {
    setProgressSteps(prev => prev.map(step =>
      step.id === stepId ? { ...step, status, detail } : step
    ))
  }

  const handleSuggestionAction = async (messageId: string, suggestionId: string, action: 'apply' | 'reject' | 'preview' | 'stage') => {
    console.log('handleSuggestionAction called:', { messageId, suggestionId, action })

    // Find the suggestion
    const message = messages.find(m => m.id === messageId)
    const suggestion = message?.suggestions?.find(s => s.id === suggestionId)

    console.log('Found suggestion:', suggestion)

    if (!suggestion) return

    // Handle find-replace operations
    if (suggestion.type === 'find_replace' && suggestion.findText && suggestion.replaceText) {
      console.log('Processing find-replace:', { find: suggestion.findText, replace: suggestion.replaceText, action })

      if (action === 'preview') {
        setIsLoading(true)
        try {
          const response = await fetch('/api/website/find-replace', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              find: suggestion.findText,
              replace: suggestion.replaceText,
              preview: true,
            }),
          })

          const result = await response.json()

          if (result.success) {
            setMessages(prev => prev.map(msg => {
              if (msg.id === messageId && msg.suggestions) {
                return {
                  ...msg,
                  suggestions: msg.suggestions.map(s =>
                    s.id === suggestionId
                      ? {
                          ...s,
                          matchCount: result.matchCount,
                          filesAffected: result.filesAffected,
                          content: `Found ${result.matchCount} occurrence(s) in ${result.filesAffected} file(s):\n\n${result.matches?.map((m: { relativePath: string; line: number; before: string; after: string }) =>
                            `📄 ${m.relativePath}:${m.line}\n  Before: ${m.before.substring(0, 80)}...\n  After: ${m.after.substring(0, 80)}...`
                          ).join('\n\n') || ''}`,
                        }
                      : s
                  ),
                }
              }
              return msg
            }))
          }
        } catch (error) {
          console.error('Preview error:', error)
        } finally {
          setIsLoading(false)
        }
        return
      }

      if (action === 'apply' || action === 'stage') {
        // Initialize progress steps
        setProgressSteps([
          { ...UPDATE_STEPS.FINDING, status: 'active' },
          { ...UPDATE_STEPS.APPLYING, status: 'pending' },
          { ...UPDATE_STEPS.STAGING, status: 'pending' },
          { ...UPDATE_STEPS.AWAITING, status: 'pending' },
        ])
        setIsLoading(true)

        try {
          // Step 1: Finding matches
          await new Promise(r => setTimeout(r, 500))
          updateProgress('finding', 'complete', `Found matches for "${suggestion.findText}"`)
          updateProgress('applying', 'active')

          // Step 2: Apply changes (staged mode - no auto deploy)
          const response = await fetch('/api/website/find-replace', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              find: suggestion.findText,
              replace: suggestion.replaceText,
              preview: false,
              staged: true,
              autoDeploy: false,
            }),
          })

          const result = await response.json()

          if (result.success) {
            updateProgress('applying', 'complete', `${result.matchCount} changes applied`)
            updateProgress('staging', 'active')

            await new Promise(r => setTimeout(r, 300))
            updateProgress('staging', 'complete', 'Changes staged for review')
            updateProgress('awaiting', 'active')

            // Update suggestion to staged status
            setMessages(prev => prev.map(msg => {
              if (msg.id === messageId && msg.suggestions) {
                return {
                  ...msg,
                  suggestions: msg.suggestions.map(s =>
                    s.id === suggestionId
                      ? {
                          ...s,
                          status: 'staged' as const,
                          matchCount: result.matchCount,
                          filesAffected: result.filesAffected,
                          requiresApproval: true,
                        }
                      : s
                  ),
                }
              }
              return msg
            }))

            // Add staged change for tracking
            setStagedChanges(prev => [...prev, {
              suggestionId,
              messageId,
              findText: suggestion.findText!,
              replaceText: suggestion.replaceText!,
              matchCount: result.matchCount,
              filesAffected: result.filesAffected,
            }])

            // Add approval message
            setMessages(prev => [...prev, {
              id: Date.now().toString(),
              role: 'assistant',
              content: `✅ **Changes staged for review**\n\nReplaced ${result.matchCount} occurrence(s) in ${result.filesAffected} file(s):\n**"${suggestion.findText}"** → **"${suggestion.replaceText}"**\n\n🔍 Review the changes above, then click **"Approve & Publish"** to deploy or **"Reject"** to discard.`,
              timestamp: new Date(),
            }])

          } else {
            updateProgress('applying', 'error', result.message)
            setMessages(prev => [...prev, {
              id: Date.now().toString(),
              role: 'assistant',
              content: result.message || `No matches found for "${suggestion.findText}".`,
              timestamp: new Date(),
            }])
          }
        } catch (error) {
          console.error('Find-replace error:', error)
          updateProgress('applying', 'error', 'Failed to apply changes')
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'assistant',
            content: 'Sorry, there was an error processing the find-replace request.',
            timestamp: new Date(),
          }])
        } finally {
          setIsLoading(false)
        }
        return
      }
    }

    // Handle regular suggestion actions
    setMessages(prev => prev.map(msg => {
      if (msg.id === messageId && msg.suggestions) {
        return {
          ...msg,
          suggestions: msg.suggestions.map(s =>
            s.id === suggestionId
              ? { ...s, status: action === 'apply' ? 'applied' : 'rejected' as const }
              : s
          )
        }
      }
      return msg
    }))
  }

  // Publish staged changes
  const handlePublish = async () => {
    if (stagedChanges.length === 0) return

    setIsPublishing(true)
    setProgressSteps([
      { ...UPDATE_STEPS.COMMITTING, status: 'active' },
      { ...UPDATE_STEPS.PUSHING, status: 'pending' },
      { ...UPDATE_STEPS.DEPLOYING, status: 'pending' },
      { ...UPDATE_STEPS.COMPLETE, status: 'pending' },
    ])

    try {
      // Build commit message from all staged changes
      const commitMessage = stagedChanges.map(c =>
        `Replace "${c.findText}" with "${c.replaceText}" (${c.matchCount} occurrences)`
      ).join('; ')

      updateProgress('committing', 'complete', 'Changes committed')
      updateProgress('pushing', 'active')

      const response = await fetch('/api/website/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'publish',
          commitMessage: `Website updates: ${commitMessage}`,
        }),
      })

      const result = await response.json()

      if (result.success) {
        updateProgress('pushing', 'complete', 'Pushed to GitHub')
        updateProgress('deploying', 'active')

        await new Promise(r => setTimeout(r, 1000))
        updateProgress('deploying', 'complete', 'Vercel deploying...')
        updateProgress('complete', 'complete', 'All updates published!')

        // Update all staged suggestions to applied
        stagedChanges.forEach(change => {
          setMessages(prev => prev.map(msg => {
            if (msg.id === change.messageId && msg.suggestions) {
              return {
                ...msg,
                suggestions: msg.suggestions.map(s =>
                  s.id === change.suggestionId
                    ? { ...s, status: 'applied' as const, requiresApproval: false }
                    : s
                ),
              }
            }
            return msg
          }))
        })

        // Clear staged changes
        setStagedChanges([])

        // Add success message
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          content: `🚀 **Published successfully!**\n\nYour changes are now being deployed to:\n${result.deployUrl || 'https://ndce-platform.vercel.app'}\n\nDeployment typically takes 30-60 seconds.`,
          timestamp: new Date(),
        }])
      } else {
        throw new Error(result.message || 'Publish failed')
      }
    } catch (error) {
      console.error('Publish error:', error)
      updateProgress('pushing', 'error', 'Failed to publish')
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `❌ **Publish failed**\n\n${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date(),
      }])
    } finally {
      setIsPublishing(false)
      setTimeout(() => setProgressSteps([]), 3000)
    }
  }

  // Reject/rollback staged changes
  const handleReject = async () => {
    if (stagedChanges.length === 0) return

    setIsLoading(true)
    try {
      const response = await fetch('/api/website/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rollback' }),
      })

      const result = await response.json()

      if (result.success) {
        // Update all staged suggestions to rejected
        stagedChanges.forEach(change => {
          setMessages(prev => prev.map(msg => {
            if (msg.id === change.messageId && msg.suggestions) {
              return {
                ...msg,
                suggestions: msg.suggestions.map(s =>
                  s.id === change.suggestionId
                    ? { ...s, status: 'rejected' as const, requiresApproval: false }
                    : s
                ),
              }
            }
            return msg
          }))
        })

        // Clear staged changes
        setStagedChanges([])
        setProgressSteps([])

        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          content: '🔄 **Changes discarded**\n\nAll staged changes have been rolled back. No changes were published.',
          timestamp: new Date(),
        }])
      }
    } catch (error) {
      console.error('Rollback error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const useExamplePrompt = (prompt: string) => {
    setInput(prompt)
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-gray-200 bg-white px-8 py-4">
          <h1 className="text-2xl font-bold text-gray-900">AI Assistant</h1>
          <p className="mt-1 text-sm text-gray-600">
            Chat with AI to update your website and create social content
          </p>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Chat Area */}
          <div className="flex flex-1 flex-col">
            {/* Staged Changes Banner */}
            {stagedChanges.length > 0 && (
              <div className="bg-amber-50 border-b border-amber-200 px-6 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Clock className="h-5 w-5 text-amber-600" />
                    <div>
                      <p className="font-medium text-amber-800">
                        {stagedChanges.length} change{stagedChanges.length > 1 ? 's' : ''} awaiting approval
                      </p>
                      <p className="text-sm text-amber-600">
                        Review and approve to publish to your website
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleReject}
                      disabled={isPublishing}
                      className="flex items-center gap-1 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      <XCircle className="h-4 w-4" />
                      Reject
                    </button>
                    <button
                      onClick={handlePublish}
                      disabled={isPublishing}
                      className="flex items-center gap-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {isPublishing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Rocket className="h-4 w-4" />
                      )}
                      Approve & Publish
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Progress Tracker */}
            {progressSteps.length > 0 && (
              <div className="px-6 py-3 bg-gray-50 border-b">
                <ProgressTracker steps={progressSteps} title="Update Progress" />
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-2xl rounded-lg px-4 py-3 ${
                      message.role === 'user'
                        ? 'bg-purple-600 text-white'
                        : 'bg-white shadow'
                    }`}
                  >
                    {message.attachments && message.attachments.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-2">
                        {message.attachments.map((att, i) => (
                          <div key={i} className="flex items-center gap-1 rounded bg-purple-500 px-2 py-1 text-xs">
                            {att.type === 'image' ? <Image className="h-3 w-3" /> : <Video className="h-3 w-3" />}
                            {att.name}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className={`prose prose-sm ${message.role === 'user' ? 'prose-invert' : ''} max-w-none`}>
                      <p className="whitespace-pre-wrap m-0">{message.content}</p>
                    </div>

                    {message.suggestions && message.suggestions.length > 0 && (
                      <div className="mt-4 space-y-3">
                        {message.suggestions.map((suggestion) => (
                          <div
                            key={suggestion.id}
                            className={`rounded-lg border p-4 ${
                              suggestion.status === 'applied'
                                ? 'border-green-200 bg-green-50'
                                : suggestion.status === 'staged'
                                ? 'border-amber-200 bg-amber-50'
                                : suggestion.status === 'rejected'
                                ? 'border-gray-200 bg-gray-50 opacity-50'
                                : 'border-gray-200 bg-gray-50'
                            }`}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-2">
                                {suggestion.type === 'website_update' || suggestion.type === 'find_replace' ? (
                                  <Globe className="h-4 w-4 text-blue-600" />
                                ) : (
                                  <MessageSquare className="h-4 w-4 text-pink-600" />
                                )}
                                <span className="font-medium text-gray-900">{suggestion.title}</span>
                                {suggestion.matchCount !== undefined && (
                                  <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                                    {suggestion.matchCount} matches in {suggestion.filesAffected || '?'} files
                                  </span>
                                )}
                              </div>
                              {suggestion.status === 'applied' && (
                                <span className="flex items-center gap-1 text-xs text-green-600">
                                  <CheckCircle className="h-3 w-3" /> Published
                                </span>
                              )}
                              {suggestion.status === 'staged' && (
                                <span className="flex items-center gap-1 text-xs text-amber-600">
                                  <Clock className="h-3 w-3" /> Awaiting Approval
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-gray-500">{suggestion.description}</p>
                            <div className="mt-2 rounded bg-white p-3 text-sm text-gray-700 whitespace-pre-wrap border">
                              {suggestion.content}
                            </div>
                            {suggestion.platforms && (
                              <div className="mt-2 flex gap-1">
                                {suggestion.platforms.map(p => (
                                  <span key={p} className="rounded bg-gray-200 px-2 py-0.5 text-xs capitalize">
                                    {p}
                                  </span>
                                ))}
                              </div>
                            )}
                            {suggestion.status === 'pending' && (
                              <div className="mt-3 flex gap-2">
                                {suggestion.type === 'find_replace' && (
                                  <button
                                    onClick={() => handleSuggestionAction(message.id, suggestion.id, 'preview')}
                                    className="flex items-center gap-1 rounded border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                                  >
                                    <Globe className="h-3 w-3" /> Preview Changes
                                  </button>
                                )}
                                <button
                                  onClick={() => handleSuggestionAction(message.id, suggestion.id, 'apply')}
                                  className="flex items-center gap-1 rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700"
                                >
                                  {suggestion.type === 'find_replace' ? (
                                    <>
                                      <Clock className="h-3 w-3" /> Stage Changes
                                    </>
                                  ) : suggestion.type === 'website_update' ? (
                                    <>
                                      <Globe className="h-3 w-3" /> Apply to Website
                                    </>
                                  ) : (
                                    <>
                                      <Check className="h-3 w-3" /> Add to Calendar
                                    </>
                                  )}
                                </button>
                                <button
                                  onClick={() => handleSuggestionAction(message.id, suggestion.id, 'reject')}
                                  className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
                                >
                                  Dismiss
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-lg bg-white px-4 py-3 shadow">
                    <Loader2 className="h-4 w-4 animate-spin text-purple-600" />
                    <span className="text-sm text-gray-600">Thinking...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Attachments Preview */}
            {attachments.length > 0 && (
              <div className="border-t border-gray-200 bg-gray-50 px-6 py-3">
                <div className="flex flex-wrap gap-2">
                  {attachments.map((att, index) => (
                    <div
                      key={index}
                      className="relative flex items-center gap-2 rounded-lg bg-white px-3 py-2 shadow-sm"
                    >
                      {att.preview ? (
                        <img src={att.preview} alt="" className="h-8 w-8 rounded object-cover" />
                      ) : att.type === 'video' ? (
                        <Video className="h-5 w-5 text-blue-600" />
                      ) : (
                        <FileText className="h-5 w-5 text-gray-600" />
                      )}
                      <span className="text-sm text-gray-700">{att.name}</span>
                      <button
                        onClick={() => removeAttachment(index)}
                        className="ml-1 text-gray-400 hover:text-gray-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Input Area */}
            <div className="border-t border-gray-200 bg-white p-4">
              <form onSubmit={handleSubmit} className="flex items-end gap-3">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept="image/*,video/*"
                  multiple
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg border border-gray-300 p-2.5 text-gray-600 hover:bg-gray-50"
                >
                  <Upload className="h-5 w-5" />
                </button>
                <div className="flex-1">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleSubmit(e)
                      }
                    }}
                    placeholder="Tell me what you'd like to update or create..."
                    rows={1}
                    className="w-full resize-none rounded-lg border border-gray-300 px-4 py-2.5 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLoading || (!input.trim() && attachments.length === 0)}
                  className="rounded-lg bg-purple-600 p-2.5 text-white hover:bg-purple-700 disabled:opacity-50"
                >
                  <Send className="h-5 w-5" />
                </button>
              </form>
            </div>
          </div>

          {/* Quick Actions Sidebar */}
          <div className="hidden w-72 border-l border-gray-200 bg-white p-4 lg:block">
            <h3 className="font-medium text-gray-900">Quick Actions</h3>
            <div className="mt-3 space-y-2">
              <button className="flex w-full items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-left text-sm hover:bg-gray-50">
                <Globe className="h-4 w-4 text-blue-600" />
                Update Website
              </button>
              <button className="flex w-full items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-left text-sm hover:bg-gray-50">
                <MessageSquare className="h-4 w-4 text-pink-600" />
                Create Post
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-left text-sm hover:bg-gray-50"
              >
                <Image className="h-4 w-4 text-green-600" />
                Upload Media
              </button>
            </div>

            <h3 className="mt-6 font-medium text-gray-900">Try These</h3>
            <div className="mt-3 space-y-2">
              {EXAMPLE_PROMPTS.map((prompt, index) => (
                <button
                  key={index}
                  onClick={() => useExamplePrompt(prompt)}
                  className="w-full rounded-lg bg-gray-50 px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-100"
                >
                  "{prompt}"
                </button>
              ))}
            </div>

            <div className="mt-6 rounded-lg bg-purple-50 p-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-600" />
                <span className="text-sm font-medium text-purple-900">Pro Tip</span>
              </div>
              <p className="mt-1 text-xs text-purple-700">
                Upload photos from events and I'll automatically suggest engaging posts with captions and hashtags!
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
