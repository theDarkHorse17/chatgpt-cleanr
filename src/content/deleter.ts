import type { Chat, DeletionProgress } from '../shared/types'
import { sleep } from '../shared/utils'
import {
  findChatItems,
  getChatHref,
  getChatTitle,
  findMoreOptionsButton,
  findDeleteOption,
  findConfirmButton,
} from './selectors'
import { deleteChatViaApi, RateLimitError } from './api'

const DEBUG = true

function log(...args: unknown[]): void {
  if (DEBUG) console.log('[ChatGPT Cleaner]', ...args)
}

/**
 * Add random jitter to a delay to look more human-like.
 * Returns delay ± 20% random variation.
 */
function jitter(baseMs: number): number {
  const variation = baseMs * 0.2
  return baseMs + (Math.random() * variation * 2 - variation)
}

/**
 * Wait for an element to appear in the DOM using MutationObserver.
 * Returns the element if found within timeout, null otherwise.
 */
function waitForElement(
  finder: () => Element | null,
  timeoutMs: number = 3000,
  pollMs: number = 100
): Promise<Element | null> {
  return new Promise((resolve) => {
    // Check immediately
    const found = finder()
    if (found) {
      resolve(found)
      return
    }

    const deadline = Date.now() + timeoutMs
    const interval = setInterval(() => {
      const el = finder()
      if (el || Date.now() >= deadline) {
        clearInterval(interval)
        resolve(el)
      }
    }, pollMs)
  })
}

/**
 * Re-find a chat element in the DOM by href or title.
 * ChatGPT's React re-renders invalidate stored element references.
 */
function rediscoverChatElement(chat: Chat): HTMLElement | null {
  const items = findChatItems()

  // Pass 1: match by href (most reliable)
  if (chat.href) {
    for (const item of items) {
      const href = getChatHref(item)
      if (href === chat.href) {
        log(`rediscoverChatElement: found by href for "${chat.title}"`)
        return item as HTMLElement
      }
    }
  }

  // Pass 2: exact title match
  for (const item of items) {
    const title = getChatTitle(item)
    if (title === chat.title) {
      log(`rediscoverChatElement: found by title for "${chat.title}"`)
      return item as HTMLElement
    }
  }

  // Pass 3: partial title match (handles truncation)
  const shortTitle = chat.title.substring(0, 20)
  if (shortTitle.length >= 10) {
    for (const item of items) {
      const title = getChatTitle(item)
      if (title.includes(shortTitle) || chat.title.includes(title)) {
        log(`rediscoverChatElement: found by partial title for "${chat.title}"`)
        return item as HTMLElement
      }
    }
  }

  log(`rediscoverChatElement: NOT FOUND for "${chat.title}"`)
  return null
}

/**
 * Dispatch a realistic hover sequence on an element.
 * ChatGPT requires mouseenter + mouseover + a brief settle time.
 */
async function simulateHover(element: HTMLElement): Promise<void> {
  const rect = element.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2

  const eventInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  }

  element.dispatchEvent(new MouseEvent('mouseenter', eventInit))
  element.dispatchEvent(new MouseEvent('mouseover', eventInit))
  element.dispatchEvent(new MouseEvent('mousemove', eventInit))

  // Also hover parent rows/containers in case the hover trigger is higher up
  let parent: HTMLElement | null = element.parentElement
  let depth = 0
  while (parent && depth < 4) {
    parent.dispatchEvent(new MouseEvent('mouseenter', eventInit))
    parent.dispatchEvent(new MouseEvent('mouseover', eventInit))
    parent.dispatchEvent(new MouseEvent('mousemove', eventInit))
    parent = parent.parentElement
    depth++
  }

  await sleep(600)
}

/**
 * Try to open the chat context menu by right-clicking the chat item.
 * ChatGPT sometimes renders the menu on contextmenu events.
 */
async function openContextMenu(element: HTMLElement): Promise<boolean> {
  const rect = element.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2

  log('openContextMenu: dispatching contextmenu event')

  const eventInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 2,
    buttons: 2,
  }

  element.dispatchEvent(new MouseEvent('contextmenu', eventInit))
  element.dispatchEvent(new MouseEvent('mousedown', eventInit))
  element.dispatchEvent(new MouseEvent('mouseup', eventInit))

  await sleep(800)
  return !!findDeleteOption()
}

/**
 * Dispatch a realistic click sequence on an element.
 * React event listeners often require pointer + mouse events to fire properly.
 */
async function simulateClick(element: HTMLElement): Promise<void> {
  const rect = element.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2

  const pointerInit: PointerEventInit = {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  }

  const mouseInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: 1,
  }

  element.dispatchEvent(new PointerEvent('pointerover', pointerInit))
  element.dispatchEvent(new MouseEvent('mouseover', mouseInit))
  element.dispatchEvent(new PointerEvent('pointerenter', pointerInit))
  element.dispatchEvent(new MouseEvent('mouseenter', mouseInit))
  element.dispatchEvent(new PointerEvent('pointerdown', pointerInit))
  element.dispatchEvent(new MouseEvent('mousedown', mouseInit))
  await sleep(50)
  element.dispatchEvent(new PointerEvent('pointerup', pointerInit))
  element.dispatchEvent(new MouseEvent('mouseup', mouseInit))
  element.dispatchEvent(new MouseEvent('click', mouseInit))
  await sleep(50)
}

/**
 * Try to click an element using realistic events, falling back to native click.
 */
async function clickElement(element: HTMLElement): Promise<void> {
  await simulateClick(element)
  // Fallback: native click to ensure any non-React handlers also fire
  element.click()
}

/**
 * Press Escape to close any open menus/dialogs.
 */
async function pressEscape(): Promise<void> {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }))
  await sleep(300)
}

export interface DeleteResult {
  success: boolean
  method?: 'api' | 'dom'
  error?: string
  rateLimited?: boolean
}

/**
 * Delete a single chat via the backend API.
 * Most reliable method because it doesn't depend on the DOM.
 */
async function deleteChatApi(chat: Chat): Promise<DeleteResult> {
  log(`deleteChatApi: trying API deletion for "${chat.title}"`)
  try {
    const success = await deleteChatViaApi(chat)
    if (success) {
      return { success: true, method: 'api' }
    }
    return { success: false, method: 'api', error: 'API delete failed (no token or network error)' }
  } catch (err) {
    if (err instanceof RateLimitError) {
      log(`deleteChatApi: rate limited for "${chat.title}"`)
      return { success: false, method: 'api', error: 'Rate limited by ChatGPT', rateLimited: true }
    }
    throw err
  }
}

/**
 * Delete a single chat by simulating UI clicks.
 * Returns detailed result with error reason on failure.
 */
async function deleteChatDom(chat: Chat, delay: number = 5000): Promise<DeleteResult> {
  log(`deleteChatDom: trying DOM deletion for "${chat.title}"`)

  // Step 0: Re-find the element
  const element = rediscoverChatElement(chat)
  if (!element || !document.body.contains(element)) {
    const msg = 'Chat element not found in sidebar'
    log(`deleteChatDom: ${msg}`)
    return { success: false, method: 'dom', error: msg }
  }

  // Step 1: Scroll into view and hover
  element.scrollIntoView({ behavior: 'smooth', block: 'center' })
  await sleep(600)
  await simulateHover(element)
  await sleep(400)

  // Step 2: Find and click the "More options" button
  let moreButton = findMoreOptionsButton(element)
  if (!moreButton) {
    // Hover again — sometimes React needs a moment
    await simulateHover(element)
    moreButton = await waitForElement(() => findMoreOptionsButton(element), 2500)
  }

  let usedContextMenu = false
  if (!moreButton) {
    usedContextMenu = await openContextMenu(element)
    if (!usedContextMenu) {
      const msg = 'Could not open chat options menu (3-dots button or right-click menu not found)'
      log(`deleteChatDom: ${msg}`)
      return { success: false, method: 'dom', error: msg }
    }
  }

  if (!usedContextMenu) {
    await simulateHover(moreButton as HTMLElement)
    await sleep(300)
    await clickElement(moreButton as HTMLElement)
    await sleep(1200)
  }

  // Step 3: Find and click the "Delete" option
  let deleteOption = findDeleteOption()
  if (!deleteOption) {
    deleteOption = await waitForElement(() => findDeleteOption(), 3000)
  }

  if (!deleteOption) {
    const msg = 'Delete option not found in menu'
    log(`deleteChatDom: ${msg}`)
    await pressEscape()
    return { success: false, method: 'dom', error: msg }
  }

  await clickElement(deleteOption as HTMLElement)
  await sleep(jitter(3000))

  // Step 4: Find and click the confirm button
  let confirmButton = findConfirmButton()
  if (!confirmButton) {
    confirmButton = await waitForElement(() => findConfirmButton(), 4000)
  }

  if (!confirmButton) {
    const msg = 'Confirm button not found in delete dialog'
    log(`deleteChatDom: ${msg}`)
    await pressEscape()
    return { success: false, method: 'dom', error: msg }
  }

  await clickElement(confirmButton as HTMLElement)

  // Step 5: Wait for deletion to complete
  await sleep(delay)

  log(`deleteChatDom: SUCCESS for "${chat.title}"`)
  return { success: true, method: 'dom' }
}

/**
 * Delete a single chat using the best available method.
 * Tries API first, falls back to DOM simulation.
 * Adds a delay after each request to avoid automation bans.
 */
export async function deleteChat(chat: Chat, delay: number = 5000): Promise<DeleteResult> {
  log(`deleteChat: starting for "${chat.title}"`)

  try {
    // Primary method: backend API (doesn't depend on UI)
    const apiResult = await deleteChatApi(chat)
    if (apiResult.success) {
      // Add delay after API call to avoid automation detection
      await sleep(jitter(delay))
      return apiResult
    }

    log(`deleteChat: API failed, falling back to DOM for "${chat.title}"`)

    // Fallback: DOM simulation
    const domResult = await deleteChatDom(chat, delay)
    return domResult
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[ChatGPT Cleaner] Error deleting chat: ${chat.title}`, error)
    await pressEscape()
    return { success: false, error: msg }
  }
}

const BATCH_SIZE = 22
const BATCH_COOLDOWN_MIN_MS = 45_000
const BATCH_COOLDOWN_MAX_MS = 75_000
const BASE_DELAY_WITHIN_BATCH = 5000

/**
 * Delete multiple chats with progress tracking.
 * Processes in batches of ~22 with long cooldowns between batches
 * to stay under ChatGPT's rate limit.
 */
export async function deleteChats(
  chats: Chat[],
  delay: number = 5000,
  onProgress?: (progress: DeletionProgress) => void,
  shouldContinue?: () => boolean
): Promise<DeletionProgress> {
  log(`deleteChats: starting ${chats.length} chats in batches of ${BATCH_SIZE}`)

  const progress: DeletionProgress = {
    total: chats.length,
    completed: 0,
    failed: 0,
    status: 'deleting',
  }

  const totalBatches = Math.ceil(chats.length / BATCH_SIZE)

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    if (shouldContinue && !shouldContinue()) {
      log('deleteChats: cancelled before batch', batchIdx + 1)
      break
    }

    const batchStart = batchIdx * BATCH_SIZE
    const batchEnd = Math.min(batchStart + BATCH_SIZE, chats.length)
    const batch = chats.slice(batchStart, batchEnd)
    const batchStartTime = Date.now()

    log(`deleteChats: === BATCH ${batchIdx + 1}/${totalBatches} (${batch.length} chats) ===`)

    for (let i = 0; i < batch.length; i++) {
      const globalIndex = batchStart + i
      const chat = batch[i]

      if (shouldContinue && !shouldContinue()) {
        log('deleteChats: cancelled')
        break
      }

      progress.currentChat = `[${globalIndex + 1}/${chats.length}] ${chat.title}`
      progress.batchNumber = batchIdx + 1
      progress.batchTotal = totalBatches
      progress.batchElapsedMs = Date.now() - batchStartTime
      onProgress?.(progress)

      log(`deleteChats: [${globalIndex + 1}/${chats.length}] deleting "${chat.title}"`)
      const result = await deleteChat(chat, delay)
      progress.currentChatError = result.error

      if (result.success) {
        progress.completed++
      } else {
        progress.failed++
        if (result.rateLimited) {
          progress.rateLimited = true
        }
      }

      progress.batchElapsedMs = Date.now() - batchStartTime
      onProgress?.(progress)

      // Delay within batch: base delay + progressive increase
      if (i < batch.length - 1) {
        const progressiveIncrease = Math.floor(i / 5) * 500
        const withinBatchDelay = jitter(BASE_DELAY_WITHIN_BATCH + progressiveIncrease)
        await sleep(withinBatchDelay)
      }
    }

    // Cooldown between batches (not after the last batch)
    if (batchIdx < totalBatches - 1 && (shouldContinue?.() ?? true)) {
      const cooldown = BATCH_COOLDOWN_MIN_MS + Math.random() * (BATCH_COOLDOWN_MAX_MS - BATCH_COOLDOWN_MIN_MS)
      log(`deleteChats: batch ${batchIdx + 1} done — cooling down ${Math.round(cooldown / 1000)}s before next batch (${progress.completed} ok, ${progress.failed} fail)`)
      progress.currentChat = `Cooldown ${Math.round(cooldown / 1000)}s...`
      progress.batchElapsedMs = Date.now() - batchStartTime
      onProgress?.(progress)
      await sleep(cooldown)
    }
  }

  progress.status = 'completed'
  progress.currentChat = undefined
  onProgress?.(progress)

  log(`deleteChats: all done — ${progress.completed} succeeded, ${progress.failed} failed`)
  return progress
}

/**
 * Delete all chats that match a filter (with cancellation support)
 */
export async function deleteFilteredChats(
  chatsToDelete: Chat[],
  delay: number = 5000,
  onProgress?: (progress: DeletionProgress) => void
): Promise<{ progress: DeletionProgress; cancel: () => void }> {
  let cancelled = false

  const shouldContinue = () => !cancelled
  const cancel = () => { cancelled = true }

  const progress = await deleteChats(chatsToDelete, delay, onProgress, shouldContinue)

  return { progress, cancel }
}
