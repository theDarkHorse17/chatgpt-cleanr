import type { Message, Settings } from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/types'

// Extension state
let settings: Settings = { ...DEFAULT_SETTINGS }

/**
 * Initialize the background script
 */
function init(): void {
  console.log('[ChatGPT Cleaner] Background script loaded')

  // Load settings
  loadSettings()

  // Listen for messages
  chrome.runtime.onMessage.addListener(handleMessage)

  // Listen for extension installation
  chrome.runtime.onInstalled.addListener(handleInstalled)
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
 * Save settings to chrome.storage
 */
function saveSettings(newSettings: Settings): void {
  settings = newSettings
  chrome.storage.sync.set({ settings })
}

/**
 * Handle messages from content script/popup
 */
function handleMessage(
  message: Message,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
): boolean {
  // Handle async responses
  switch (message.type) {
    case 'GET_SETTINGS':
      sendResponse({ settings })
      return true

    case 'SETTINGS_UPDATED':
      if (message.payload && typeof message.payload === 'object') {
        saveSettings({ ...settings, ...(message.payload as Partial<Settings>) })
      }
      sendResponse({ success: true })
      return true

    case 'SHOW_OVERLAY':
    case 'HIDE_OVERLAY':
      // Forward to content script
      forwardToContentScript(message, sender.tab?.id)
        .then(sendResponse)
        .catch((error) => sendResponse({ error: error.message }))
      return true

    default:
      return false
  }
}

/**
 * Forward a message to the content script in a specific tab
 */
async function forwardToContentScript(
  message: Message,
  tabId?: number
): Promise<unknown> {
  if (!tabId) {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      throw new Error('No active tab found')
    }
    tabId = tab.id
  }

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId!, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
      } else {
        resolve(response)
      }
    })
  })
}

/**
 * Handle extension installation
 */
function handleInstalled(details: chrome.runtime.InstalledDetails): void {
  if (details.reason === 'install') {
    console.log('[ChatGPT Cleaner] Extension installed')
    // Set default settings
    saveSettings(DEFAULT_SETTINGS)
  } else if (details.reason === 'update') {
    console.log('[ChatGPT Cleaner] Extension updated')
  }
}

// Initialize
init()
