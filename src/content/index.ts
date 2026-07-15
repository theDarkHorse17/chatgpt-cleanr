import type { Message, Settings, Chat, DeletionProgress } from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/types'
import { filterChatsForDeletion, sleep, getEffectiveTier, incrementUsage, canDeleteMore } from '../shared/utils'
import { showOverlay, hideOverlay, toggleOverlay, removeOverlay } from './overlay'
import { scanChats } from './scanner'
import { deleteChats } from './deleter'

// Content script state
let settings: Settings = { ...DEFAULT_SETTINGS }
let isOverlayVisible = false
let scannedChats: Chat[] = []

// Active deletion state for cancellation and progress broadcasts
let activeDeletion: { cancel: () => void } | null = null
let isDeleting = false

/**
 * Initialize the content script
 */
function init(): void {
  console.log('[ChatGPT Cleaner] Content script loaded')

  // Load settings
  loadSettings()

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener(handleMessage)

  // Show overlay if enabled
  if (settings.showOverlay) {
    setTimeout(() => {
      showOverlay()
      isOverlayVisible = true
    }, 2000)
  }

  // Add keyboard shortcut listener
  document.addEventListener('keydown', handleKeydown)
}

/**
 * Load settings from chrome.storage
 */
function loadSettings(): void {
  chrome.storage.sync.get('settings', (result) => {
    if (result.settings) {
      settings = { ...DEFAULT_SETTINGS, ...result.settings }
    }
  })
}

/**
 * Broadcast progress to popup and overlay listeners.
 */
function broadcastProgress(progress: DeletionProgress): void {
  try {
    chrome.runtime.sendMessage({
      type: 'DELETE_PROGRESS',
      payload: { progress: serializeProgress(progress) },
    })
  } catch {
    // Popup may be closed; ignore
  }
}

/**
 * Broadcast completion to popup and overlay listeners.
 */
function broadcastComplete(progress: DeletionProgress): void {
  try {
    chrome.runtime.sendMessage({
      type: 'DELETE_COMPLETE',
      payload: { progress: serializeProgress(progress) },
    })
  } catch {
    // Popup may be closed; ignore
  }
}

function serializeProgress(progress: DeletionProgress) {
  return {
    total: progress.total,
    completed: progress.completed,
    failed: progress.failed,
    currentChat: progress.currentChat,
    currentChatError: progress.currentChatError,
    status: progress.status,
    batchNumber: progress.batchNumber,
    batchTotal: progress.batchTotal,
    batchElapsedMs: progress.batchElapsedMs,
    rateLimited: progress.rateLimited,
  }
}

/**
 * Run a deletion batch with cancellation support and live progress broadcasts.
 */
async function runDeletion(
  chatsToDelete: Chat[],
  delay: number
): Promise<DeletionProgress> {
  if (isDeleting && activeDeletion) {
    activeDeletion.cancel()
    await sleep(500)
  }

  isDeleting = true
  let cancelled = false

  const cancel = () => {
    cancelled = true
  }
  activeDeletion = { cancel }

  const shouldContinue = () => !cancelled

  try {
    const progress = await deleteChats(
      chatsToDelete,
      delay,
      (p) => {
        broadcastProgress(p)
      },
      shouldContinue
    )

    broadcastComplete(progress)
    return progress
  } finally {
    isDeleting = false
    activeDeletion = null
  }
}

/**
 * Handle messages from popup/background
 */
function handleMessage(
  message: Message,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
): boolean {
  switch (message.type) {
    case 'SHOW_OVERLAY':
      showOverlay()
      isOverlayVisible = true
      sendResponse({ success: true })
      return true

    case 'HIDE_OVERLAY':
      hideOverlay()
      isOverlayVisible = false
      sendResponse({ success: true })
      return true

    case 'GET_SETTINGS':
      sendResponse({ settings })
      return true

    case 'SETTINGS_UPDATED':
      if (message.payload && typeof message.payload === 'object') {
        settings = { ...settings, ...(message.payload as Partial<Settings>) }
      }
      sendResponse({ success: true })
      return true

    case 'SCAN_CHATS':
      scanChats()
        .then((chats) => {
          scannedChats = chats
          const serializedChats = chats.map((chat) => ({
            id: chat.id,
            title: chat.title,
            lastModified: chat.lastModified.toISOString(),
            isPinned: chat.isPinned,
            isProject: chat.isProject,
            projectId: chat.projectId,
            href: chat.href,
          }))
          sendResponse({ chats: serializedChats })
        })
        .catch((error) => {
          console.error('[ChatGPT Cleaner] Scan error:', error)
          sendResponse({ error: error.message })
        })
      return true

    case 'DELETE_CHATS':
      if (message.payload && typeof message.payload === 'object') {
        const payload = message.payload as { chatIds: string[]; delay?: number }
        const chatIds = payload.chatIds
        const delay = payload.delay || 5000

        const chatsToDelete = scannedChats.filter((chat) => chatIds.includes(chat.id))

        if (chatsToDelete.length === 0) {
          sendResponse({ success: false, error: 'No matching chats found. Please scan again.' })
          return true
        }

        // Check daily limit for free tier (async, fire-and-forget with sendResponse)
        canDeleteMore().then(({ allowed, remaining, tier }) => {
          if (!allowed) {
            sendResponse({
              success: false,
              error: `Daily limit reached (${remaining} remaining). Upgrade to Pro for unlimited deletions.`,
              upgradeRequired: true,
            })
            return
          }

          // Enforce limit: only delete up to remaining
          const capped = tier === 'free' ? chatsToDelete.slice(0, remaining) : chatsToDelete

          runDeletion(capped, delay)
            .then((progress) => {
              incrementUsage(progress.completed).then(() => {
                sendResponse({ success: true, progress })
              })
            })
            .catch((error) => {
              console.error('[ChatGPT Cleaner] Delete error:', error)
              sendResponse({ success: false, error: error.message })
            })
        })
      } else {
        sendResponse({ success: false, error: 'Invalid payload' })
      }
      return true

    case 'AUTO_DELETE_CHATS':
      {
        // Auto-delete is a Pro feature (async check)
        getEffectiveTier().then((tier) => {
          if (tier !== 'pro') {
            sendResponse({
              success: false,
              error: 'Auto Delete is a Pro feature. Upgrade to unlock.',
              upgradeRequired: true,
            })
            return
          }

          const payload = (message.payload && typeof message.payload === 'object'
            ? message.payload
            : {}) as { confirmed?: boolean; delay?: number; skipConfirmation?: boolean }
          const delay = payload.delay || settings.deletionDelay || 5000
          const skipConfirmation = payload.skipConfirmation ?? !settings.confirmBeforeDelete

          scanChats()
            .then((chats) => {
              scannedChats = chats
              const chatsToDelete = filterChatsForDeletion(chats, settings.filterConfig)

              if (chatsToDelete.length === 0) {
                sendResponse({ success: true, deleted: 0, message: 'No deletable chats found.' })
                return
              }

              if (!payload.confirmed && !skipConfirmation) {
                sendResponse({
                  success: true,
                  requiresConfirmation: true,
                  count: chatsToDelete.length,
                  chats: chatsToDelete.map((chat) => ({
                    id: chat.id,
                    title: chat.title,
                    lastModified: chat.lastModified.toISOString(),
                    isPinned: chat.isPinned,
                    isProject: chat.isProject,
                  })),
                })
                return
              }

              runDeletion(chatsToDelete, delay)
                .then((progress) => {
                  incrementUsage(progress.completed).then(() => {
                    sendResponse({ success: true, progress })
                  })
                })
                .catch((error) => {
                  console.error('[ChatGPT Cleaner] Auto-delete error:', error)
                  sendResponse({ success: false, error: error.message })
                })
            })
            .catch((error) => {
              console.error('[ChatGPT Cleaner] Auto-delete scan error:', error)
              sendResponse({ success: false, error: error.message })
            })
        })
      }
      return true

    case 'CANCEL_DELETE':
      if (activeDeletion) {
        activeDeletion.cancel()
        activeDeletion = null
        isDeleting = false
        sendResponse({ success: true, message: 'Deletion cancelled' })
      } else {
        sendResponse({ success: false, message: 'No active deletion to cancel' })
      }
      return true

    default:
      sendResponse({ error: 'Unknown message type' })
      return true
  }
}

/**
 * Handle keyboard shortcuts
 */
function handleKeydown(e: KeyboardEvent): void {
  if (e.ctrlKey && e.shiftKey && e.key === 'G') {
    e.preventDefault()
    toggleOverlay()
    isOverlayVisible = !isOverlayVisible
  }
}

/**
 * Cleanup when content script is unloaded
 */
function cleanup(): void {
  removeOverlay()
  document.removeEventListener('keydown', handleKeydown)
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}

// Cleanup on page unload
window.addEventListener('unload', cleanup)
