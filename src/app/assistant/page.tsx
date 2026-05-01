'use client'

import { useState, useRef } from 'react'
import Sidebar from '@/components/Sidebar'
import { Send, Upload, Image, Video, FileText, Sparkles, Globe, MessageSquare, X, Check, Loader2, Clock, CheckCircle, XCircle, Rocket, ListTodo, Play, AlertCircle, Edit2, Eye, ChevronDown, ChevronUp } from 'lucide-react'
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
  url?: string  // local object URL for preview thumb
  preview?: string
  uploadStatus?: 'uploading' | 'uploaded' | 'failed'
  uploadedPath?: string  // public path after committed via /api/uploads/image
  uploadError?: string
}

interface Suggestion {
  id: string
  type: 'website_update' | 'social_post' | 'find_replace' | 'verify'
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
  // For verify operations
  verifyText?: string
  // For staged changes requiring approval
  requiresApproval?: boolean
}

interface TaskItem {
  id: string
  type: 'find_replace' | 'website_update' | 'social_post' | 'verify' | 'question'
  description: string
  findText?: string
  replaceText?: string
  verifyText?: string
  content?: string
  section?: string
  status: 'pending' | 'ready' | 'in_progress' | 'completed' | 'error'
  result?: string
}

interface StagedChange {
  id: string
  suggestionId: string
  messageId: string
  type: 'find_replace' | 'website_update' | 'social_post'
  // For find_replace
  findText?: string
  replaceText?: string
  matchCount?: number
  filesAffected?: number
  stagingId?: string
  editedReplaceText?: string
  // For find_replace publish: prepared file contents (bypasses in-memory staging store)
  files?: Array<{ path: string; newContent: string; sha: string }>
  // For website_update
  section?: string
  content?: string
  editedContent?: string
  // For social_post
  platforms?: string[]
  caption?: string
  editedCaption?: string
  // Common
  title: string
  description: string
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
  const [taskList, setTaskList] = useState<TaskItem[]>([])
  const [isProcessingTask, setIsProcessingTask] = useState(false)
  const [previewExpanded, setPreviewExpanded] = useState(true)
  const [editingChangeId, setEditingChangeId] = useState<string | null>(null)
  // Preview workflow state. When previewBranch is set, the staged changes
  // have been committed to a staging branch and Vercel is building a
  // preview deployment. Until the user clicks Publish to Live or Discard,
  // production is untouched.
  const [previewBranch, setPreviewBranch] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isCreatingPreview, setIsCreatingPreview] = useState(false)
  const [isPublishingLive, setIsPublishingLive] = useState(false)
  // Live label for what the assistant is doing right now (set from SSE
  // tool_start events). Falls back to "Thinking..." between tool calls.
  const [currentActivity, setCurrentActivity] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Get conversation history for AI context
  const getConversationHistory = () => {
    return messages.map(m => ({
      role: m.role,
      content: m.content,
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() && attachments.length === 0) return

    // Don't dispatch while images are still uploading — the assistant
    // would just see no usable attachments. The submit button is also
    // disabled in this state, so this is defense-in-depth.
    if (attachments.some(a => a.uploadStatus === 'uploading')) {
      return
    }

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

      // Only forward attachments that finished uploading; placeholders or
      // failed uploads can't be referenced server-side.
      const uploadedAttachments = attachments
        .filter(a => a.uploadStatus === 'uploaded' && a.uploadedPath)
        .map(a => ({ type: a.type, name: a.name, uploadedPath: a.uploadedPath }))

      // Call agentic AI assistant with tool capabilities. The route now
      // streams SSE events (tool_start, tool_end, final, error) so we can
      // render live progress instead of a static "Thinking..." indicator.
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify({
          message: input,
          history: getConversationHistory(),
          attachments: uploadedAttachments,
        }),
      })

      if (!response.ok || !response.body) {
        // Surface non-2xx responses as a normal error message and bail
        // out of the streaming path.
        const text = await response.text().catch(() => '')
        throw new Error(text || `Assistant request failed: ${response.status}`)
      }

      // SSE reader. Each event is `data: <json>\n\n`. We only care about
      // the typed payloads our route emits; anything else is ignored.
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      type StagedChangeFromServer = {
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
      type AssistantFinal = {
        success?: boolean
        response?: string
        toolsUsed?: Array<{ name: string; input: unknown }>
        turns?: number
        taskList?: TaskItem[] | null
        stagedChanges?: StagedChangeFromServer[] | null
        error?: string
        details?: string
      }
      let result: AssistantFinal | null = null
      let streamError: string | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })

        // Events are separated by a blank line; pop the trailing partial.
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''

        for (const part of parts) {
          if (!part.startsWith('data:')) continue
          const json = part.slice(part.indexOf(':') + 1).trim()
          if (!json) continue
          try {
            const evt = JSON.parse(json) as Record<string, unknown>
            if (evt.type === 'tool_start') {
              const label = typeof evt.label === 'string' ? evt.label : (typeof evt.name === 'string' ? evt.name : 'Working')
              setCurrentActivity(label)
            } else if (evt.type === 'tool_end') {
              setCurrentActivity(null)
            } else if (evt.type === 'final') {
              result = evt as AssistantFinal
            } else if (evt.type === 'error') {
              streamError = (evt.details as string) || (evt.error as string) || 'Unknown error'
            }
          } catch {
            // Malformed event — skip.
          }
        }
      }

      if (streamError) {
        throw new Error(streamError)
      }

      setCurrentActivity(null)

      // Handle agentic response
      if (result && result.success && result.response) {
        const responseText = result.response
        const stagedFromServer = result.stagedChanges ?? []
        // Clear progress
        setProgressSteps([])

        // Show tools used if any
        if (result.toolsUsed && result.toolsUsed.length > 0) {
          const toolNames = result.toolsUsed.map((t: { name: string }) => t.name).join(', ')
          setMessages(prev => [...prev, {
            id: `tools-${Date.now()}`,
            role: 'assistant',
            content: `🔧 *Used tools: ${toolNames}*`,
            timestamp: new Date(),
          }])
        }

        // Add main response
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          content: responseText,
          timestamp: new Date(),
        }])

        // Handle task list if created
        if (result.taskList) {
          setTaskList(result.taskList)
        }

        // Handle staged changes from assistant tools
        if (stagedFromServer.length > 0) {
          setStagedChanges(prev => [
            ...prev,
            ...stagedFromServer.map((sc: {
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
            }) => ({
              id: sc.id,
              suggestionId: sc.id,
              messageId: 'assistant-tool',
              type: sc.type,
              title: sc.title,
              description: sc.description,
              findText: sc.findText,
              replaceText: sc.replaceText,
              matchCount: sc.matchCount,
              filesAffected: sc.filesAffected,
              stagingId: sc.stagingId || '',
              section: sc.section,
              content: sc.content,
              platforms: sc.platforms,
              caption: sc.caption,
              files: sc.files,
            }))
          ])
        }

        setIsLoading(false)
        return
      }

      // Fallback to old chat API for compatibility
      const chatResponse = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: input,
          history: getConversationHistory(),
        }),
      })

      const chatResult = await chatResponse.json()

      if (chatResult.success && chatResult.intent) {
        const result = chatResult
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
        } else if (result.intent.type === 'review') {
          // Handle website review request
          setProgressSteps([
            { ...VERIFY_STEPS.UNDERSTANDING, status: 'complete', detail: 'Review request detected' },
            { ...VERIFY_STEPS.FETCHING, status: 'active', detail: 'Fetching website content...' },
            { ...VERIFY_STEPS.SEARCHING, status: 'pending', detail: '' },
            { ...VERIFY_STEPS.COMPLETE, status: 'pending' },
          ])

          try {
            const reviewResponse = await fetch('/api/website/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mode: 'review' }),
            })

            setProgressSteps(prev => prev.map(s =>
              s.id === 'fetching' ? { ...s, status: 'complete', detail: 'Website loaded' } :
              s.id === 'searching' ? { ...s, status: 'active', detail: 'Analyzing content...' } :
              s
            ))

            await new Promise(r => setTimeout(r, 300))

            const reviewResult = await reviewResponse.json()

            if (reviewResult.success && reviewResult.review) {
              const review = reviewResult.review

              setProgressSteps(prev => prev.map(s =>
                s.id === 'searching' ? { ...s, status: 'complete', detail: `Found ${review.sections?.length || 0} sections` } :
                s.id === 'verify-complete' ? { ...s, status: 'complete', detail: 'Review complete!' } :
                s
              ))

              // Build a formatted review summary
              let reviewContent = `**Website Review Complete**\n\n`
              reviewContent += `**Title:** ${review.title}\n`
              reviewContent += `**Word Count:** ${review.wordCount}\n\n`

              if (review.keyInfo?.ages?.length) {
                reviewContent += `**Ages Mentioned:** ${review.keyInfo.ages.join(', ')}\n`
              }
              if (review.keyInfo?.phoneNumbers?.length) {
                reviewContent += `**Phone Numbers:** ${review.keyInfo.phoneNumbers.join(', ')}\n`
              }
              if (review.keyInfo?.emails?.length) {
                reviewContent += `**Emails:** ${review.keyInfo.emails.join(', ')}\n`
              }

              reviewContent += `\n**Content Sections:**\n`
              review.sections?.forEach((section: { name: string; content: string }) => {
                reviewContent += `\n**${section.name}:**\n${section.content.substring(0, 300)}${section.content.length > 300 ? '...' : ''}\n`
              })

              setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'assistant',
                content: reviewContent,
                timestamp: new Date(),
              }])

              setTimeout(() => setProgressSteps([]), 3000)
            }
          } catch (reviewError) {
            console.error('Review error:', reviewError)
            setProgressSteps(prev => prev.map(s =>
              s.id === 'fetching' || s.id === 'searching' ? { ...s, status: 'error' } : s
            ))
            setMessages(prev => [...prev, {
              id: Date.now().toString(),
              role: 'assistant',
              content: `I tried to review the website but encountered an error. Please try again or check the website directly at https://ndce-platform.vercel.app`,
              timestamp: new Date(),
            }])
            setTimeout(() => setProgressSteps([]), 3000)
          }
        } else if (result.intent.type === 'multi_task' && result.intent.tasks) {
          // Handle multi-task requests
          setProgressSteps([])

          // Convert tasks to TaskItem format with IDs
          const tasks: TaskItem[] = result.intent.tasks.map((task: {
            type: string
            description: string
            findText?: string
            replaceText?: string
            verifyText?: string
            content?: string
            section?: string
            status: string
          }, index: number) => {
            // Determine if task is ready based on having required fields
            let isReady = task.status === 'ready'

            // For find_replace tasks, check if we have findText (replaceText can be empty for removal)
            if (task.type === 'find_replace' && task.findText && task.replaceText !== undefined) {
              isReady = true
            }

            // For verify tasks, check if we have verifyText
            if (task.type === 'verify' && task.verifyText) {
              isReady = true
            }

            return {
              id: `task-${Date.now()}-${index}`,
              type: task.type as TaskItem['type'],
              description: task.description,
              findText: task.findText,
              replaceText: task.replaceText,
              verifyText: task.verifyText,
              content: task.content,
              section: task.section,
              status: isReady ? 'ready' : 'pending',
            }
          })

          setTaskList(tasks)

          // Add message explaining the tasks
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'assistant',
            content: result.intent.response || `I found **${tasks.length} tasks** in your request. Review them in the task panel and click "Run" to execute each one, or "Run All" to process them in sequence.`,
            timestamp: new Date(),
          }])
        } else {
          // Clear progress for other intents
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

    setCurrentActivity(null)
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    // Add placeholders so the user sees the thumb immediately, then upload
    // each file in the background. Match by name+url to identify which
    // placeholder to update when the upload finishes.
    const initialAttachments: Attachment[] = []
    const filesToUpload: Array<{ file: File; key: string }> = []

    Array.from(files).forEach(file => {
      const isImage = file.type.startsWith('image/')
      const isVideo = file.type.startsWith('video/')

      if (isImage || isVideo) {
        const url = URL.createObjectURL(file)
        const key = `${file.name}|${file.size}|${url}`
        initialAttachments.push({
          type: isImage ? 'image' : 'video',
          name: file.name,
          url,
          preview: isImage ? url : undefined,
          uploadStatus: isImage ? 'uploading' : undefined,
        })
        if (isImage) filesToUpload.push({ file, key })
      }
    })

    setAttachments(prev => [...prev, ...initialAttachments])
    if (fileInputRef.current) fileInputRef.current.value = ''

    // Upload images in parallel; video upload not supported yet.
    await Promise.all(
      filesToUpload.map(async ({ file }) => {
        const fd = new FormData()
        fd.append('file', file)
        try {
          const resp = await fetch('/api/uploads/image', { method: 'POST', body: fd })
          const data = await resp.json().catch(() => ({}))
          if (!resp.ok || !data.success) {
            throw new Error(data.error || `Upload failed (${resp.status})`)
          }
          setAttachments(prev =>
            prev.map(a =>
              a.name === file.name && a.uploadStatus === 'uploading'
                ? { ...a, uploadStatus: 'uploaded' as const, uploadedPath: data.path }
                : a,
            ),
          )
        } catch (err) {
          setAttachments(prev =>
            prev.map(a =>
              a.name === file.name && a.uploadStatus === 'uploading'
                ? {
                    ...a,
                    uploadStatus: 'failed' as const,
                    uploadError: err instanceof Error ? err.message : 'Upload failed',
                  }
                : a,
            ),
          )
        }
      }),
    )
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

            // Add staged change for tracking (includes stagingId for GitHub mode)
            setStagedChanges(prev => [...prev, {
              id: `staged-${Date.now()}`,
              suggestionId,
              messageId,
              type: 'find_replace',
              title: 'Find & Replace',
              description: suggestion.description,
              findText: suggestion.findText!,
              replaceText: suggestion.replaceText!,
              matchCount: result.matchCount,
              filesAffected: result.filesAffected,
              stagingId: result.stagingId || '',
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

    // Handle website updates - stage for preview
    if (suggestion.type === 'website_update' && action === 'apply') {
      setStagedChanges(prev => [...prev, {
        id: `staged-${Date.now()}`,
        suggestionId,
        messageId,
        type: 'website_update',
        title: suggestion.title,
        description: suggestion.description,
        section: suggestion.section,
        content: suggestion.content,
      }])

      // Mark as staged
      setMessages(prev => prev.map(msg => {
        if (msg.id === messageId && msg.suggestions) {
          return {
            ...msg,
            suggestions: msg.suggestions.map(s =>
              s.id === suggestionId
                ? { ...s, status: 'staged' as const, requiresApproval: true }
                : s
            )
          }
        }
        return msg
      }))

      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `✅ **Website update staged for review**\n\nYour content for the **${suggestion.section || 'website'}** section has been staged.\n\n🔍 Review and edit the content in the preview panel above, then click **"Approve & Publish"** to deploy.`,
        timestamp: new Date(),
      }])
      return
    }

    // Handle social posts - stage for preview
    if (suggestion.type === 'social_post' && action === 'apply') {
      setStagedChanges(prev => [...prev, {
        id: `staged-${Date.now()}`,
        suggestionId,
        messageId,
        type: 'social_post',
        title: suggestion.title,
        description: suggestion.description,
        platforms: suggestion.platforms,
        caption: suggestion.content,
      }])

      // Mark as staged
      setMessages(prev => prev.map(msg => {
        if (msg.id === messageId && msg.suggestions) {
          return {
            ...msg,
            suggestions: msg.suggestions.map(s =>
              s.id === suggestionId
                ? { ...s, status: 'staged' as const, requiresApproval: true }
                : s
            )
          }
        }
        return msg
      }))

      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `✅ **Social post staged for review**\n\nYour post for **${suggestion.platforms?.join(' & ') || 'social media'}** has been staged.\n\n🔍 Review and edit the caption in the preview panel above, then click **"Approve & Publish"** to schedule.`,
        timestamp: new Date(),
      }])
      return
    }

    // Handle rejections
    setMessages(prev => prev.map(msg => {
      if (msg.id === messageId && msg.suggestions) {
        return {
          ...msg,
          suggestions: msg.suggestions.map(s =>
            s.id === suggestionId
              ? { ...s, status: 'rejected' as const }
              : s
          )
        }
      }
      return msg
    }))
  }

  // Flatten staged changes into a list of files to commit. Used by both
  // the preview workflow (commits to a staging branch) and is the single
  // place that translates UI staging objects into GitHub commits.
  const collectFilesForCommit = (): Array<{ path: string; newContent: string; sha?: string }> => {
    const files: Array<{ path: string; newContent: string; sha?: string }> = []
    for (const change of stagedChanges) {
      if (change.type === 'find_replace' && change.files) {
        const finalReplaceText = change.editedReplaceText ?? change.replaceText
        let filesToAdd = change.files
        // If the user edited the replacement text after staging, re-apply
        // find/replace on the staged file contents so we commit the right thing.
        if (
          change.editedReplaceText !== undefined &&
          change.editedReplaceText !== change.replaceText &&
          change.findText
        ) {
          const findRegex = new RegExp(
            change.findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
            'gi',
          )
          filesToAdd = change.files.map(f => ({
            ...f,
            newContent: f.newContent.replace(findRegex, finalReplaceText ?? ''),
          }))
        }
        for (const f of filesToAdd) {
          files.push({ path: f.path, newContent: f.newContent, sha: f.sha })
        }
      } else if (change.type === 'website_update' && change.section && change.content) {
        // section holds the file path for write_file/edit_file changes.
        const finalContent = change.editedContent ?? change.content
        files.push({ path: change.section, newContent: finalContent })
      }
      // social_post is intentionally not committed to the site repo.
    }
    return files
  }

  // STEP 1: Build a Vercel preview deployment from staged changes.
  // This commits the bundle to a fresh staging-<id> branch — production
  // is untouched until the user clicks Publish to Live.
  const handlePreview = async () => {
    if (stagedChanges.length === 0) return

    const files = collectFilesForCommit()
    if (files.length === 0) {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `⚠️ Nothing to preview. The staged changes don't include any file edits yet.`,
        timestamp: new Date(),
      }])
      return
    }

    setIsCreatingPreview(true)
    setIsPublishing(true)
    setProgressSteps([
      { ...UPDATE_STEPS.COMMITTING, status: 'active' },
      { ...UPDATE_STEPS.PUSHING, status: 'pending' },
      { ...UPDATE_STEPS.DEPLOYING, status: 'pending' },
    ])

    try {
      const commitMessage = `Staging: ${stagedChanges.length} change${stagedChanges.length === 1 ? '' : 's'} via assistant`
      const response = await fetch('/api/website/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files, commitMessage }),
      })
      const result = await response.json()

      if (result.success) {
        updateProgress('committing', 'complete', `Committed ${result.filesCommitted} file(s)`)
        updateProgress('pushing', 'complete', `Pushed to ${result.branch}`)
        updateProgress('deploying', 'active', 'Vercel building preview...')

        setPreviewBranch(result.branch)
        setPreviewUrl(result.previewUrl)

        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          content: `🧪 **Preview ready to build**\n\nI've committed ${result.filesCommitted} file(s) to a staging branch (\`${result.branch}\`). Vercel is building the preview now (usually 30–60 seconds).\n\n**Preview URL:** ${result.previewUrl}\n\nOpen it in a new tab to review. Once you're happy, click **Publish to Live**. To throw away these changes without publishing, click **Discard**.`,
          timestamp: new Date(),
        }])
      } else {
        updateProgress('committing', 'error', result.error || 'Preview failed')
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          content: `❌ **Preview failed**\n\n${result.error || result.message || 'Unknown error'}`,
          timestamp: new Date(),
        }])
      }
    } catch (error) {
      console.error('Preview error:', error)
      updateProgress('committing', 'error', 'Failed to build preview')
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `❌ **Preview failed**\n\n${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date(),
      }])
    } finally {
      setIsCreatingPreview(false)
      setIsPublishing(false)
      setTimeout(() => setProgressSteps([]), 3000)
    }
  }

  // STEP 2: Promote the staging branch to main once the user has reviewed
  // the preview. Vercel auto-deploys main to production.
  const handlePublishLive = async () => {
    if (!previewBranch) return

    setIsPublishingLive(true)
    setIsPublishing(true)
    setProgressSteps([
      { ...UPDATE_STEPS.PUSHING, status: 'active', label: 'Merging to main...' },
      { ...UPDATE_STEPS.DEPLOYING, status: 'pending' },
      { ...UPDATE_STEPS.COMPLETE, status: 'pending' },
    ])

    try {
      const commitMessage = `Publish ${stagedChanges.length} change${stagedChanges.length === 1 ? '' : 's'} via assistant`
      const response = await fetch('/api/website/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: previewBranch, commitMessage }),
      })
      const result = await response.json()

      if (result.success) {
        updateProgress('pushing', 'complete', 'Merged to main')
        updateProgress('deploying', 'active', 'Vercel deploying to production...')
        await new Promise(r => setTimeout(r, 600))
        updateProgress('deploying', 'complete', 'Production deploy started')
        updateProgress('complete', 'complete', 'All updates published!')

        // Mark all staged suggestions as applied.
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

        setStagedChanges([])
        setPreviewBranch(null)
        setPreviewUrl(null)

        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          content: `🚀 **Published live!**\n\nYour changes are now deploying to production:\nhttps://ndce-site-v2.vercel.app\n\nDeployment typically takes 30–60 seconds.`,
          timestamp: new Date(),
        }])
      } else {
        updateProgress('pushing', 'error', result.error || 'Publish failed')
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          content: `❌ **Publish to Live failed**\n\n${result.error || result.message || 'Unknown error'}\n\nThe staging branch \`${previewBranch}\` is still in place — try again, or click Discard to throw it away.`,
          timestamp: new Date(),
        }])
      }
    } catch (error) {
      console.error('Promote error:', error)
      updateProgress('pushing', 'error', 'Failed to merge')
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `❌ **Publish to Live failed**\n\n${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date(),
      }])
    } finally {
      setIsPublishingLive(false)
      setIsPublishing(false)
      setTimeout(() => setProgressSteps([]), 3000)
    }
  }

  // Re-stage a find-replace change with edited text
  const handleRestage = async (change: StagedChange) => {
    if (change.type !== 'find_replace' || !change.editedReplaceText || !change.findText) return

    setIsLoading(true)
    setProgressSteps([
      { ...UPDATE_STEPS.FINDING, status: 'active' },
      { ...UPDATE_STEPS.APPLYING, status: 'pending' },
      { ...UPDATE_STEPS.STAGING, status: 'pending' },
    ])

    try {
      // First, reject the old staged change
      if (change.stagingId) {
        await fetch('/api/website/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'rollback', stagingId: change.stagingId }),
        })
      }

      updateProgress('finding', 'complete', `Found matches for "${change.findText}"`)
      updateProgress('applying', 'active')

      // Stage with the new replacement text
      const response = await fetch('/api/website/find-replace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          find: change.findText,
          replace: change.editedReplaceText,
          preview: false,
          staged: true,
          autoDeploy: false,
        }),
      })

      const result = await response.json()

      if (result.success && result.matchCount > 0) {
        updateProgress('applying', 'complete', `${result.matchCount} changes applied`)
        updateProgress('staging', 'complete', 'Changes re-staged')

        // Update the staged change with new values
        setStagedChanges(prev => prev.map(c =>
          c.id === change.id
            ? {
                ...c,
                replaceText: change.editedReplaceText!,
                editedReplaceText: undefined,
                matchCount: result.matchCount,
                filesAffected: result.filesAffected,
                stagingId: result.stagingId || '',
              }
            : c
        ))

        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          content: `✅ **Changes re-staged**\n\nUpdated replacement: **"${change.findText}"** → **"${change.editedReplaceText}"**\n\n${result.matchCount} occurrence(s) in ${result.filesAffected} file(s) ready for approval.`,
          timestamp: new Date(),
        }])
      } else {
        updateProgress('applying', 'error', result.message || 'No matches found')
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          content: `⚠️ **Re-staging failed**: ${result.message || 'No matches found for the original text.'}`,
          timestamp: new Date(),
        }])
      }
    } catch (error) {
      console.error('Restage error:', error)
      updateProgress('applying', 'error', 'Failed to re-stage')
    } finally {
      setIsLoading(false)
      setTimeout(() => setProgressSteps([]), 2000)
    }
  }

  // Reject/rollback staged changes. If a preview branch is in flight,
  // also delete it on GitHub so we don't leave orphaned staging branches.
  const handleReject = async () => {
    if (stagedChanges.length === 0 && !previewBranch) return

    setIsLoading(true)
    try {
      // If we already pushed a preview to GitHub, discard that branch first.
      if (previewBranch) {
        try {
          await fetch('/api/website/discard', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ branch: previewBranch }),
          })
        } catch (e) {
          console.warn('Failed to delete staging branch on discard:', e)
        }
        setPreviewBranch(null)
        setPreviewUrl(null)
      }

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

  // Execute a single task from the task list
  const executeTask = async (taskId: string) => {
    const task = taskList.find(t => t.id === taskId)
    if (!task) return

    setIsProcessingTask(true)
    setTaskList(prev => prev.map(t =>
      t.id === taskId ? { ...t, status: 'in_progress' } : t
    ))

    try {
      if (task.type === 'find_replace' && task.findText && task.replaceText !== undefined) {
        // Execute find-replace
        const response = await fetch('/api/website/find-replace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            find: task.findText,
            replace: task.replaceText,
            preview: false,
            staged: true,
            autoDeploy: false,
          }),
        })
        const result = await response.json()

        if (result.success && result.matchCount > 0) {
          setTaskList(prev => prev.map(t =>
            t.id === taskId ? { ...t, status: 'completed', result: `Replaced ${result.matchCount} occurrence(s) in ${result.filesAffected} file(s)` } : t
          ))

          // Add to staged changes (includes stagingId for GitHub mode)
          setStagedChanges(prev => [...prev, {
            id: `staged-task-${Date.now()}`,
            suggestionId: taskId,
            messageId: 'task',
            type: 'find_replace',
            title: 'Find & Replace',
            description: task.description,
            findText: task.findText!,
            replaceText: task.replaceText!,
            matchCount: result.matchCount,
            filesAffected: result.filesAffected,
            stagingId: result.stagingId || '',
          }])
        } else {
          setTaskList(prev => prev.map(t =>
            t.id === taskId ? { ...t, status: 'error', result: result.message || 'No matches found' } : t
          ))
        }
      } else if (task.type === 'verify' && task.verifyText) {
        // Execute verification
        const response = await fetch('/api/website/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ searchText: task.verifyText }),
        })
        const result = await response.json()

        if (result.success) {
          setTaskList(prev => prev.map(t =>
            t.id === taskId ? {
              ...t,
              status: 'completed',
              result: result.found
                ? `Found "${task.verifyText}" ${result.match?.count || 1} time(s)`
                : `"${task.verifyText}" not found on website`
            } : t
          ))
        }
      } else {
        // Mark as pending - needs more info
        setTaskList(prev => prev.map(t =>
          t.id === taskId ? { ...t, status: 'pending', result: 'This task needs more information or manual implementation' } : t
        ))
      }
    } catch (error) {
      console.error('Task execution error:', error)
      setTaskList(prev => prev.map(t =>
        t.id === taskId ? { ...t, status: 'error', result: 'Failed to execute task' } : t
      ))
    } finally {
      setIsProcessingTask(false)
    }
  }

  // Execute all ready tasks in sequence
  const executeAllTasks = async () => {
    const readyTasks = taskList.filter(t => t.status === 'ready' || t.status === 'pending')
    for (const task of readyTasks) {
      await executeTask(task.id)
      await new Promise(r => setTimeout(r, 500)) // Small delay between tasks
    }
  }

  // Clear task list
  const clearTasks = () => {
    setTaskList([])
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
            {/* Staged Changes Preview Panel */}
            {stagedChanges.length > 0 && (
              <div className="bg-amber-50 border-b border-amber-200">
                {/* Header with collapse toggle */}
                <div className="px-6 py-3 flex items-center justify-between border-b border-amber-200">
                  <button
                    onClick={() => setPreviewExpanded(!previewExpanded)}
                    className="flex items-center gap-3 hover:opacity-80"
                  >
                    {previewExpanded ? (
                      <ChevronUp className="h-5 w-5 text-amber-600" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-amber-600" />
                    )}
                    <Eye className="h-5 w-5 text-amber-600" />
                    <div className="text-left">
                      <p className="font-medium text-amber-800">
                        {previewBranch
                          ? `Preview ready — review before publishing`
                          : `${stagedChanges.length} change${stagedChanges.length > 1 ? 's' : ''} awaiting preview`}
                      </p>
                      <p className="text-sm text-amber-600">
                        {previewExpanded ? 'Click to collapse preview' : 'Click to expand preview'}
                      </p>
                    </div>
                  </button>
                  <div className="flex gap-2">
                    {previewBranch ? (
                      <>
                        <button
                          onClick={handleReject}
                          disabled={isPublishing || isPublishingLive}
                          className="flex items-center gap-1 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          <XCircle className="h-4 w-4" />
                          Discard
                        </button>
                        <button
                          onClick={handlePublishLive}
                          disabled={isPublishing || isPublishingLive || editingChangeId !== null}
                          className="flex items-center gap-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          {isPublishingLive ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Rocket className="h-4 w-4" />
                          )}
                          Publish to Live
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={handleReject}
                          disabled={isPublishing}
                          className="flex items-center gap-1 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          <XCircle className="h-4 w-4" />
                          Reject
                        </button>
                        <button
                          onClick={handlePreview}
                          disabled={isPublishing || isCreatingPreview || editingChangeId !== null}
                          className="flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {isCreatingPreview ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                          Preview
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Preview URL banner — visible once the staging branch is built */}
                {previewBranch && previewUrl && (
                  <div className="px-6 py-3 bg-blue-50 border-b border-blue-200 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Eye className="h-4 w-4 text-blue-600 shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-blue-800">Preview deployment</p>
                        <p className="text-xs text-blue-700">
                          Branch <code className="px-1 bg-blue-100 rounded">{previewBranch}</code> · production unchanged until you click Publish to Live
                        </p>
                      </div>
                    </div>
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-sm font-medium text-blue-700 hover:text-blue-900 underline whitespace-nowrap"
                    >
                      Open preview →
                    </a>
                  </div>
                )}

                {/* Expanded Preview Content */}
                {previewExpanded && (
                  <div className="px-6 py-4 space-y-4 max-h-96 overflow-y-auto">
                    {stagedChanges.map((change, index) => (
                      <div key={change.id || index} className="bg-white rounded-lg border border-amber-200 overflow-hidden">
                        {/* Change Header */}
                        <div className="px-4 py-2 bg-gray-50 border-b flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {change.type === 'find_replace' && <Globe className="h-4 w-4 text-blue-600" />}
                            {change.type === 'website_update' && <Globe className="h-4 w-4 text-purple-600" />}
                            {change.type === 'social_post' && <MessageSquare className="h-4 w-4 text-pink-600" />}
                            <span className="text-sm font-medium text-gray-700">
                              {change.title}
                              {change.type === 'find_replace' && change.matchCount && (
                                <span className="ml-2 text-xs text-gray-500">
                                  ({change.matchCount} occurrence{change.matchCount !== 1 ? 's' : ''} in {change.filesAffected} file{change.filesAffected !== 1 ? 's' : ''})
                                </span>
                              )}
                              {change.type === 'website_update' && change.section && (
                                <span className="ml-2 text-xs text-gray-500">({change.section} section)</span>
                              )}
                            </span>
                          </div>
                          {editingChangeId !== change.id ? (
                            <button
                              onClick={() => {
                                setEditingChangeId(change.id)
                                setStagedChanges(prev => prev.map(c =>
                                  c.id === change.id
                                    ? {
                                        ...c,
                                        editedReplaceText: c.type === 'find_replace' ? (c.editedReplaceText ?? c.replaceText) : c.editedReplaceText,
                                        editedContent: c.type === 'website_update' ? (c.editedContent ?? c.content) : c.editedContent,
                                        editedCaption: c.type === 'social_post' ? (c.editedCaption ?? c.caption) : c.editedCaption,
                                      }
                                    : c
                                ))
                              }}
                              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                            >
                              <Edit2 className="h-3 w-3" />
                              Edit
                            </button>
                          ) : (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setEditingChangeId(null)}
                                className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800"
                              >
                                <Check className="h-3 w-3" />
                                Save
                              </button>
                              <button
                                onClick={() => {
                                  setStagedChanges(prev => prev.map(c =>
                                    c.id === change.id
                                      ? {
                                          ...c,
                                          editedReplaceText: c.replaceText,
                                          editedContent: c.content,
                                          editedCaption: c.caption,
                                        }
                                      : c
                                  ))
                                  setEditingChangeId(null)
                                }}
                                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
                              >
                                <X className="h-3 w-3" />
                                Cancel
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Content Preview based on type */}
                        <div className="p-4 space-y-3">
                          {/* Find & Replace Preview */}
                          {change.type === 'find_replace' && (
                            <>
                              <div>
                                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Before</label>
                                <div className="mt-1 p-3 bg-red-50 border border-red-200 rounded text-sm">
                                  <span className="bg-red-200 px-1 rounded">{change.findText}</span>
                                </div>
                              </div>
                              <div>
                                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">After</label>
                                {editingChangeId === change.id ? (
                                  <textarea
                                    value={change.editedReplaceText ?? change.replaceText ?? ''}
                                    onChange={(e) => {
                                      setStagedChanges(prev => prev.map(c =>
                                        c.id === change.id ? { ...c, editedReplaceText: e.target.value } : c
                                      ))
                                    }}
                                    className="mt-1 w-full p-3 bg-white border-2 border-blue-400 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    rows={3}
                                    placeholder="Enter replacement text..."
                                    autoFocus
                                  />
                                ) : (
                                  <div className="mt-1 p-3 bg-green-50 border border-green-200 rounded text-sm">
                                    {(change.editedReplaceText ?? change.replaceText) ? (
                                      <span className="bg-green-200 px-1 rounded">{change.editedReplaceText ?? change.replaceText}</span>
                                    ) : (
                                      <span className="text-gray-400 italic">(text will be removed)</span>
                                    )}
                                  </div>
                                )}
                              </div>
                              {change.editedReplaceText !== undefined && change.editedReplaceText !== change.replaceText && (
                                <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                                  <p className="text-xs text-amber-600 flex items-center gap-1">
                                    <AlertCircle className="h-3 w-3" />
                                    Text modified - re-stage to apply changes
                                  </p>
                                  <button
                                    onClick={() => handleRestage(change)}
                                    disabled={isLoading}
                                    className="flex items-center gap-1 rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
                                  >
                                    {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
                                    Re-stage
                                  </button>
                                </div>
                              )}
                            </>
                          )}

                          {/* Website Update Preview */}
                          {change.type === 'website_update' && (
                            <>
                              <div>
                                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Content Preview</label>
                                {editingChangeId === change.id ? (
                                  <textarea
                                    value={change.editedContent ?? change.content ?? ''}
                                    onChange={(e) => {
                                      setStagedChanges(prev => prev.map(c =>
                                        c.id === change.id ? { ...c, editedContent: e.target.value } : c
                                      ))
                                    }}
                                    className="mt-1 w-full p-3 bg-white border-2 border-blue-400 rounded text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    rows={8}
                                    placeholder="Enter website content..."
                                    autoFocus
                                  />
                                ) : (
                                  <div className="mt-1 p-4 bg-gradient-to-br from-purple-50 to-white border border-purple-200 rounded-lg">
                                    <div className="prose prose-sm max-w-none">
                                      <div
                                        className="text-sm"
                                        dangerouslySetInnerHTML={{ __html: change.editedContent ?? change.content ?? '' }}
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                              {change.editedContent !== undefined && change.editedContent !== change.content && (
                                <p className="text-xs text-amber-600 flex items-center gap-1">
                                  <AlertCircle className="h-3 w-3" />
                                  Content modified - changes will be applied on publish
                                </p>
                              )}
                            </>
                          )}

                          {/* Social Post Preview */}
                          {change.type === 'social_post' && (
                            <>
                              <div>
                                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Post Preview</label>
                                {editingChangeId === change.id ? (
                                  <textarea
                                    value={change.editedCaption ?? change.caption ?? ''}
                                    onChange={(e) => {
                                      setStagedChanges(prev => prev.map(c =>
                                        c.id === change.id ? { ...c, editedCaption: e.target.value } : c
                                      ))
                                    }}
                                    className="mt-1 w-full p-3 bg-white border-2 border-blue-400 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    rows={6}
                                    placeholder="Enter post caption..."
                                    autoFocus
                                  />
                                ) : (
                                  <div className="mt-1 p-4 bg-gradient-to-br from-pink-50 to-white border border-pink-200 rounded-lg">
                                    <p className="text-sm whitespace-pre-wrap">{change.editedCaption ?? change.caption}</p>
                                  </div>
                                )}
                              </div>
                              {change.platforms && change.platforms.length > 0 && (
                                <div className="flex gap-2">
                                  {change.platforms.map(p => (
                                    <span key={p} className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium capitalize">
                                      {p}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {change.editedCaption !== undefined && change.editedCaption !== change.caption && (
                                <p className="text-xs text-amber-600 flex items-center gap-1">
                                  <AlertCircle className="h-3 w-3" />
                                  Caption modified - changes will be applied on publish
                                </p>
                              )}
                            </>
                          )}
                        </div>

                        {/* Remove individual change button */}
                        <div className="px-4 py-2 bg-gray-50 border-t flex justify-end">
                          <button
                            onClick={() => setStagedChanges(prev => prev.filter(c => c.id !== change.id))}
                            className="text-xs text-red-500 hover:text-red-700"
                          >
                            Remove this change
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Progress Tracker */}
            {progressSteps.length > 0 && (
              <div className="px-6 py-3 bg-gray-50 border-b">
                <ProgressTracker steps={progressSteps} title="Update Progress" />
              </div>
            )}

            {/* Task List Panel */}
            {taskList.length > 0 && (
              <div className="bg-blue-50 border-b border-blue-200 px-6 py-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <ListTodo className="h-5 w-5 text-blue-600" />
                    <h3 className="font-medium text-blue-900">Task List ({taskList.length} items)</h3>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={clearTasks}
                      className="text-xs text-gray-500 hover:text-gray-700"
                    >
                      Clear
                    </button>
                    <button
                      onClick={executeAllTasks}
                      disabled={isProcessingTask}
                      className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {isProcessingTask ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                      Run All Ready Tasks
                    </button>
                  </div>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {taskList.map((task) => (
                    <div
                      key={task.id}
                      className={`flex items-center justify-between rounded-lg border p-3 ${
                        task.status === 'completed' ? 'border-green-200 bg-green-50' :
                        task.status === 'error' ? 'border-red-200 bg-red-50' :
                        task.status === 'in_progress' ? 'border-blue-300 bg-blue-100' :
                        task.status === 'ready' ? 'border-blue-200 bg-white' :
                        'border-gray-200 bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="flex-shrink-0">
                          {task.status === 'completed' && <CheckCircle className="h-4 w-4 text-green-600" />}
                          {task.status === 'error' && <XCircle className="h-4 w-4 text-red-600" />}
                          {task.status === 'in_progress' && <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />}
                          {task.status === 'ready' && <Play className="h-4 w-4 text-blue-600" />}
                          {task.status === 'pending' && <AlertCircle className="h-4 w-4 text-amber-500" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{task.description}</p>
                          <p className="text-xs text-gray-500">
                            {task.type === 'find_replace' && task.findText && (
                              <span>Replace "{task.findText}" → "{task.replaceText}"</span>
                            )}
                            {task.type === 'verify' && task.verifyText && (
                              <span>Verify "{task.verifyText}" on website</span>
                            )}
                            {task.result && <span className="ml-2 italic">— {task.result}</span>}
                          </p>
                        </div>
                      </div>
                      {(task.status === 'ready' || task.status === 'pending') && (
                        <button
                          onClick={() => executeTask(task.id)}
                          disabled={isProcessingTask}
                          className="flex-shrink-0 ml-2 rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          Run
                        </button>
                      )}
                    </div>
                  ))}
                </div>
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
                    <span className="text-sm text-gray-600">{currentActivity ?? 'Thinking...'}</span>
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
                      className={`relative flex items-center gap-2 rounded-lg bg-white px-3 py-2 shadow-sm ${
                        att.uploadStatus === 'failed' ? 'ring-1 ring-red-300' : ''
                      }`}
                    >
                      {att.preview ? (
                        <img src={att.preview} alt="" className="h-8 w-8 rounded object-cover" />
                      ) : att.type === 'video' ? (
                        <Video className="h-5 w-5 text-blue-600" />
                      ) : (
                        <FileText className="h-5 w-5 text-gray-600" />
                      )}
                      <span className="text-sm text-gray-700">{att.name}</span>
                      {att.uploadStatus === 'uploading' && (
                        <Loader2 className="h-3 w-3 animate-spin text-purple-600" />
                      )}
                      {att.uploadStatus === 'uploaded' && (
                        <span className="text-xs text-green-600">✓ uploaded</span>
                      )}
                      {att.uploadStatus === 'failed' && (
                        <span className="text-xs text-red-600" title={att.uploadError}>upload failed</span>
                      )}
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
                  disabled={
                    isLoading ||
                    (!input.trim() && attachments.length === 0) ||
                    attachments.some(a => a.uploadStatus === 'uploading')
                  }
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
