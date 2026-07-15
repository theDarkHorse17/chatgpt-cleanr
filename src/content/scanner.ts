import type { Chat } from '../shared/types'
import { generateChatId } from '../shared/utils'
import {
  findScrollContainer,
  findChatItems,
  isChatPinned,
  isChatProject,
  getChatTitle,
  getChatHref,
} from './selectors'

/**
 * Scroll the sidebar to load all chats
 * ChatGPT lazy-loads sidebar items, so we need to scroll to load everything
 */
export async function scrollSidebarToLoadAll(
  onProgress?: (loaded: number) => void
): Promise<void> {
  const scrollContainer = findScrollContainer()
  if (!scrollContainer) {
    console.warn('[ChatGPT Cleaner] Could not find scroll container — scanning visible chats only')
    return
  }

  let previousCount = 0
  let currentCount = 0
  let stableCount = 0
  const maxStableAttempts = 5
  const scrollDelay = 300

  while (stableCount < maxStableAttempts) {
    // Count current items
    const items = findChatItems()
    currentCount = items.length

    // Report progress
    onProgress?.(currentCount)

    if (currentCount === previousCount) {
      stableCount++
    } else {
      stableCount = 0
      previousCount = currentCount
    }

    // Scroll down
    scrollContainer.scrollTop = scrollContainer.scrollHeight

    // Wait for new items to load
    await new Promise((resolve) => setTimeout(resolve, scrollDelay))
  }

  // Scroll back to top
  scrollContainer.scrollTop = 0
  await new Promise((resolve) => setTimeout(resolve, 200))
}

/**
 * Parse a chat item element into a Chat object
 */
function parseChatItem(element: Element): Chat {
  const title = getChatTitle(element)
  const href = getChatHref(element)
  const isPinned = isChatPinned(element)
  const isProject = isChatProject(element)

  // Try to extract date from the element
  let lastModified = new Date()
  const dateText = element.querySelector('time')?.getAttribute('datetime')
  if (dateText) {
    lastModified = new Date(dateText)
  } else {
    // Try to find date in tooltip or aria-label
    const tooltip = element.getAttribute('title') || element.getAttribute('aria-label') || ''
    const dateMatch = tooltip.match(/\d{4}-\d{2}-\d{2}/)
    if (dateMatch) {
      lastModified = new Date(dateMatch[0])
    }
  }

  // Extract project ID from href if it's a project chat
  let projectId: string | undefined
  if (href) {
    const projectMatch = href.match(/\/g\/([a-f0-9-]+)/)
    if (projectMatch) {
      projectId = projectMatch[1]
    }
  }

  return {
    id: generateChatId(title, href),
    title,
    lastModified,
    isPinned,
    isProject,
    projectId,
    element: element as HTMLElement,
    href,
  }
}

/**
 * Scan the sidebar and extract all chats
 */
export async function scanChats(
  onProgress?: (loaded: number) => void
): Promise<Chat[]> {
  // First, scroll to load all chats
  await scrollSidebarToLoadAll(onProgress)

  // Then extract chat metadata
  const chatItems = findChatItems()
  const chats: Chat[] = []

  for (const item of chatItems) {
    try {
      const chat = parseChatItem(item)
      chats.push(chat)
    } catch (error) {
      console.warn('[ChatGPT Cleaner] Failed to parse chat item:', error)
    }
  }

  return chats
}

/**
 * Re-scan chats (for after scrolling or UI changes)
 */
export async function rescanChats(): Promise<Chat[]> {
  return scanChats()
}
