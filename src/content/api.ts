import type { Chat } from '../shared/types'

const DEBUG = true

function log(...args: unknown[]): void {
  if (DEBUG) console.log('[ChatGPT Cleaner API]', ...args)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Thrown when ChatGPT returns HTTP 429 (rate limited).
 * The caller can catch this to suggest the Playwright fallback.
 */
export class RateLimitError extends Error {
  constructor(message = 'ChatGPT rate limit reached (HTTP 429)') {
    super(message)
    this.name = 'RateLimitError'
  }
}

/**
 * Add random jitter to a delay to look more human-like.
 * Returns delay ± 20% random variation.
 */
function jitter(baseMs: number): number {
  const variation = baseMs * 0.2
  return baseMs + (Math.random() * variation * 2 - variation)
}

interface SessionInfo {
  accessToken?: string
  user?: unknown
  expires?: string
  error?: string
}

let cachedSession: SessionInfo | null = null
let sessionCacheTime = 0
const SESSION_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Fetch the current user's session info from ChatGPT's auth endpoint.
 * The content script shares the page's cookies, so the request is authenticated.
 */
export async function fetchSession(): Promise<SessionInfo | null> {
  try {
    const now = Date.now()
    if (cachedSession && now - sessionCacheTime < SESSION_CACHE_TTL_MS) {
      log('fetchSession: returning cached session')
      return cachedSession
    }

    log('fetchSession: fetching /api/auth/session')
    const response = await fetch('https://chatgpt.com/api/auth/session', {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      log('fetchSession: failed with status', response.status)
      return null
    }

    const data = (await response.json()) as SessionInfo
    cachedSession = data
    sessionCacheTime = now
    log('fetchSession: got session', data.accessToken ? 'with token' : 'no token')
    return data
  } catch (error) {
    log('fetchSession: error', error)
    return null
  }
}

/**
 * Extract the conversation ID from a chat href.
 */
function extractConversationId(href?: string): string | null {
  if (!href) return null
  const match = href.match(/\/c\/([a-f0-9-]+)/)
  return match ? match[1] : null
}

/**
 * Check if a response indicates rate limiting.
 */
function isRateLimited(response: Response): boolean {
  // HTTP 429 Too Many Requests - definitive rate limit
  if (response.status === 429) return true
  
  return false
}

/**
 * Delete a conversation via ChatGPT's backend API.
 * Uses PATCH with is_visible:false (soft delete) — the same method ChatGPT's own UI uses.
 * The DELETE endpoint returns 500; PATCH is the correct approach.
 * Includes exponential backoff with jitter on rate limits.
 */
export async function deleteChatViaApi(
  chat: Chat,
  baseDelay: number = 5000,
  maxRetries: number = 3
): Promise<boolean> {
  const conversationId = extractConversationId(chat.href)
  if (!conversationId) {
    log(`deleteChatViaApi: no conversation id in href "${chat.href}"`)
    return false
  }

  const session = await fetchSession()
  if (!session?.accessToken) {
    log('deleteChatViaApi: no access token available')
    return false
  }

  const url = `https://chatgpt.com/backend-api/conversation/${conversationId}`
  
  let lastError = ''
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // Aggressive exponential backoff: 10s, 30s, 90s with jitter
      const multiplier = Math.pow(3, attempt - 1)
      const backoffDelay = jitter(baseDelay * multiplier)
      log(`deleteChatViaApi: retry ${attempt}/${maxRetries} after ${Math.round(backoffDelay)}ms`)
      await sleep(backoffDelay)
    }
    
    log(`deleteChatViaApi: PATCH ${url} (attempt ${attempt + 1})`)
    
    try {
      const response = await fetch(url, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Referer': 'https://chatgpt.com/',
          'Origin': 'https://chatgpt.com',
        },
        body: JSON.stringify({ is_visible: false }),
      })

      // Success: 200 OK
      if (response.ok) {
        log(`deleteChatViaApi: success for "${chat.title}" (status ${response.status})`)
        return true
      }

      // 404 = already deleted, treat as success
      if (response.status === 404) {
        log(`deleteChatViaApi: conversation already deleted for "${chat.title}"`)
        return true
      }

      // Check for rate limiting
      if (isRateLimited(response)) {
        lastError = `Rate limited (HTTP ${response.status})`
        log(`deleteChatViaApi: rate limited for "${chat.title}"`)
        // On the last attempt, throw a RateLimitError so callers can detect it
        if (attempt === maxRetries) {
          throw new RateLimitError()
        }
        continue // Retry with backoff
      }

      // Other errors - don't retry
      lastError = `HTTP ${response.status}`
      log(`deleteChatViaApi: failed with status ${response.status}`)
      return false
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      log(`deleteChatViaApi: network error for "${chat.title}"`, error)
      continue // Retry on network errors
    }
  }

  log(`deleteChatViaApi: all retries exhausted for "${chat.title}". Last error: ${lastError}`)
  return false
}

/**
 * Clear the session cache (useful after login/logout).
 */
export function clearSessionCache(): void {
  cachedSession = null
  sessionCacheTime = 0
}
