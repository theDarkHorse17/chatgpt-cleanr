import type { Chat, FilterConfig } from './types'

/**
 * Format a date relative to now (e.g., "2 days ago", "just now")
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSecs < 60) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 30) return `${diffDays}d ago`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`
  return `${Math.floor(diffDays / 365)}y ago`
}

/**
 * Format a date as a short string
 */
export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  })
}

/**
 * Check if a chat should be kept based on filter config
 */
export function shouldKeepChat(chat: Chat, config: FilterConfig): { keep: boolean; reason?: string } {
  // Check if pinned
  if (config.keepPinned && chat.isPinned) {
    return { keep: true, reason: 'Pinned' }
  }

  // Check if project chat
  if (config.keepProjectChats && chat.isProject) {
    return { keep: true, reason: 'Project' }
  }

  // Check if recent
  if (config.keepRecentDays > 0) {
    const daysSinceModified = (Date.now() - chat.lastModified.getTime()) / (1000 * 60 * 60 * 24)
    if (daysSinceModified <= config.keepRecentDays) {
      return { keep: true, reason: `Recent (${Math.floor(daysSinceModified)}d old)` }
    }
  }

  // Check keep keywords
  if (config.keepKeywords.length > 0) {
    const titleLower = chat.title.toLowerCase()
    for (const keyword of config.keepKeywords) {
      if (titleLower.includes(keyword.toLowerCase())) {
        return { keep: true, reason: `Matches keep keyword: "${keyword}"` }
      }
    }
  }

  // Check delete keywords
  if (config.deleteKeywords.length > 0) {
    const titleLower = chat.title.toLowerCase()
    for (const keyword of config.deleteKeywords) {
      if (titleLower.includes(keyword.toLowerCase())) {
        return { keep: false, reason: `Matches delete keyword: "${keyword}"` }
      }
    }
  }

  // Check max age
  if (config.maxAgeDays > 0) {
    const daysSinceModified = (Date.now() - chat.lastModified.getTime()) / (1000 * 60 * 60 * 24)
    if (daysSinceModified > config.maxAgeDays) {
      return { keep: false, reason: `Older than ${config.maxAgeDays} days` }
    }
  }

  // Default: keep if no criteria matched for deletion
  return { keep: true, reason: 'No delete criteria matched' }
}

/**
 * Filter chats based on config, returning chats to delete
 */
export function filterChatsForDeletion(chats: Chat[], config: FilterConfig): Chat[] {
  return chats.filter((chat) => {
    const { keep } = shouldKeepChat(chat, config)
    return !keep
  })
}

/**
 * Generate a unique ID for a chat
 */
export function generateChatId(title: string, href?: string): string {
  if (href) {
    // Extract conversation ID from href if available
    const match = href.match(/\/c\/([a-f0-9-]+)/)
    if (match) return match[1]
  }
  // Fallback to title hash
  let hash = 0
  for (let i = 0; i < title.length; i++) {
    const char = title.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return `chat-${Math.abs(hash).toString(16)}`
}

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Clamp a number between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
