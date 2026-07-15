import type { Chat, FilterConfig, Settings } from '../shared/types'
import { DEFAULT_FILTER_CONFIG, DEFAULT_SETTINGS } from '../shared/types'
import { shouldKeepChat, formatRelativeTime, sleep } from '../shared/utils'
import { scanChats } from './scanner'
import { deleteChats } from './deleter'
import { findChatItems, getChatHref, getChatTitle, findMoreOptionsButton } from './selectors'

function loadSettings(): Promise<Settings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get('settings', (result) => {
      resolve({ ...DEFAULT_SETTINGS, ...(result.settings || {}) })
    })
  })
}

const OVERLAY_ID = 'gcc-overlay'
const OVERLAY_CONTAINER_ID = 'gcc-overlay-container'

/**
 * Create and inject the overlay panel into the ChatGPT page
 */
export function createOverlay(): void {
  // Check if overlay already exists
  if (document.getElementById(OVERLAY_ID)) {
    return
  }

  // Create container for React app
  const container = document.createElement('div')
  container.id = OVERLAY_CONTAINER_ID
  document.body.appendChild(container)

  // Create overlay element
  const overlay = document.createElement('div')
  overlay.id = OVERLAY_ID
  overlay.innerHTML = `
    <div class="gcc-header gcc-drag-handle">
      <h3>ChatGPT Cleaner</h3>
      <button class="gcc-close" id="gcc-close">×</button>
    </div>
    <div class="gcc-stats" id="gcc-stats">
      <div class="gcc-stat">
        <span class="gcc-stat-value" id="gcc-total">0</span>
        <span class="gcc-stat-label">Total</span>
      </div>
      <div class="gcc-stat">
        <span class="gcc-stat-value" id="gcc-pinned">0</span>
        <span class="gcc-stat-label">Pinned</span>
      </div>
      <div class="gcc-stat">
        <span class="gcc-stat-value" id="gcc-project">0</span>
        <span class="gcc-stat-label">Project</span>
      </div>
      <div class="gcc-stat">
        <span class="gcc-stat-value" id="gcc-deletable">0</span>
        <span class="gcc-stat-label">Deletable</span>
      </div>
    </div>
    <div class="gcc-filters" id="gcc-filters">
      <span class="gcc-filter-tag active" data-filter="all">All</span>
      <span class="gcc-filter-tag" data-filter="deletable">Deletable</span>
      <span class="gcc-filter-tag" data-filter="pinned">Pinned</span>
      <span class="gcc-filter-tag" data-filter="project">Project</span>
      <span class="gcc-filter-tag" data-filter="recent">Recent</span>
    </div>
    <div class="gcc-chat-list" id="gcc-chat-list">
      <div class="gcc-status">Click "Scan" to load chats</div>
    </div>
    <div class="gcc-action-bar">
      <button class="gcc-btn gcc-btn-secondary" id="gcc-scan">Scan</button>
      <button class="gcc-btn gcc-btn-secondary" id="gcc-select-all">Select All</button>
      <button class="gcc-btn gcc-btn-secondary" id="gcc-clear">Clear</button>
      <button class="gcc-btn gcc-btn-danger" id="gcc-auto-delete" disabled>Auto Delete</button>
      <button class="gcc-btn gcc-btn-danger" id="gcc-delete" disabled>Delete</button>
    </div>
  `

  document.body.appendChild(overlay)

  // Initialize overlay functionality
  initOverlay()
}

/**
 * Initialize overlay event handlers and functionality
 */
function initOverlay(): void {
  let chats: Chat[] = []
  let selectedChats: Set<string> = new Set()
  let currentFilter: string = 'all'
  let filterConfig: FilterConfig = { ...DEFAULT_FILTER_CONFIG }

  const overlay = document.getElementById(OVERLAY_ID)
  if (!overlay) return

  // Close button
  const closeBtn = document.getElementById('gcc-close')
  closeBtn?.addEventListener('click', () => {
    hideOverlay()
  })

  // Scan button
  const scanBtn = document.getElementById('gcc-scan')
  scanBtn?.addEventListener('click', async () => {
    const chatList = document.getElementById('gcc-chat-list')
    if (chatList) {
      chatList.innerHTML = '<div class="gcc-status"><div class="gcc-spinner"></div> Scanning chats...</div>'
    }

    chats = await scanChats((loaded) => {
      if (chatList) {
        chatList.innerHTML = `<div class="gcc-status">Loaded ${loaded} chats...</div>`
      }
    })

    updateStats()
    renderChatList()
  })

  // Select All button
  const selectAllBtn = document.getElementById('gcc-select-all')
  selectAllBtn?.addEventListener('click', () => {
    const filteredChats = getFilteredChats()
    filteredChats.forEach((chat) => selectedChats.add(chat.id))
    renderChatList()
    updateDeleteButton()
  })

  // Clear button
  const clearBtn = document.getElementById('gcc-clear')
  clearBtn?.addEventListener('click', () => {
    selectedChats.clear()
    renderChatList()
    updateDeleteButton()
  })

  // Delete button
  const deleteBtn = document.getElementById('gcc-delete')
  deleteBtn?.addEventListener('click', async () => {
    const chatsToDelete = chats.filter((chat) => selectedChats.has(chat.id))
    if (chatsToDelete.length === 0) return

    if (!confirm(`Are you sure you want to delete ${chatsToDelete.length} chats?`)) {
      return
    }

    deleteBtn.textContent = 'Deleting...'
    ;(deleteBtn as HTMLButtonElement).disabled = true

    await deleteChats(chatsToDelete, 5000, (progress) => {
      renderProgress(progress.total, progress.completed, progress.failed, progress.currentChatError)
    })

    // Rescan after deletion
    selectedChats.clear()
    deleteBtn.textContent = 'Delete'
    scanBtn?.click()
  })

  // Auto Delete button
  const autoDeleteBtn = document.getElementById('gcc-auto-delete')
  autoDeleteBtn?.addEventListener('click', async () => {
    const settings = await loadSettings()

    const chatList = document.getElementById('gcc-chat-list')
    if (chatList) {
      chatList.innerHTML = '<div class="gcc-status"><div class="gcc-spinner"></div> Scanning for deletable chats...</div>'
    }

    chats = await scanChats((loaded) => {
      if (chatList) {
        chatList.innerHTML = `<div class="gcc-status">Loaded ${loaded} chats...</div>`
      }
    })
    updateStats()

    const chatsToDelete = chats.filter((chat) => {
      const { keep } = shouldKeepChat(chat, filterConfig)
      return !keep
    })

    if (chatsToDelete.length === 0) {
      if (chatList) chatList.innerHTML = '<div class="gcc-status">No deletable chats found.</div>'
      renderChatList()
      return
    }

    if (settings.confirmBeforeDelete) {
      const preview = chatsToDelete.slice(0, 5).map((c) => `• ${c.title}`).join('\n')
      const more = chatsToDelete.length > 5 ? `\n...and ${chatsToDelete.length - 5} more` : ''
      const confirmed = confirm(
        `Auto-delete ${chatsToDelete.length} chats?\n\n${preview}${more}\n\nThis cannot be undone.`
      )
      if (!confirmed) {
        renderChatList()
        return
      }
    }

    ;(autoDeleteBtn as HTMLButtonElement).disabled = true
    autoDeleteBtn.textContent = 'Deleting...'

    await deleteChats(chatsToDelete, settings.deletionDelay, (progress) => {
      renderProgress(progress.total, progress.completed, progress.failed, progress.currentChatError)
    })

    autoDeleteBtn.textContent = 'Auto Delete'
    selectedChats.clear()
    scanBtn?.click()
  })

  // Filter tags
  const filterTags = overlay.querySelectorAll('.gcc-filter-tag')
  filterTags.forEach((tag) => {
    tag.addEventListener('click', () => {
      filterTags.forEach((t) => t.classList.remove('active'))
      tag.classList.add('active')
      currentFilter = tag.getAttribute('data-filter') || 'all'
      renderChatList()
    })
  })

  // Make overlay draggable
  makeDraggable(overlay)

  function getFilteredChats(): Chat[] {
    switch (currentFilter) {
      case 'deletable':
        return chats.filter((chat) => {
          const { keep } = shouldKeepChat(chat, filterConfig)
          return !keep
        })
      case 'pinned':
        return chats.filter((chat) => chat.isPinned)
      case 'project':
        return chats.filter((chat) => chat.isProject)
      case 'recent':
        return chats.filter((chat) => {
          const daysSinceModified = (Date.now() - chat.lastModified.getTime()) / (1000 * 60 * 60 * 24)
          return daysSinceModified <= 7
        })
      default:
        return chats
    }
  }

  function updateStats(): void {
    const total = chats.length
    const pinned = chats.filter((c) => c.isPinned).length
    const project = chats.filter((c) => c.isProject).length
    const deletable = chats.filter((c) => {
      const { keep } = shouldKeepChat(c, filterConfig)
      return !keep
    }).length

    const totalEl = document.getElementById('gcc-total')
    const pinnedEl = document.getElementById('gcc-pinned')
    const projectEl = document.getElementById('gcc-project')
    const deletableEl = document.getElementById('gcc-deletable')

    if (totalEl) totalEl.textContent = total.toString()
    if (pinnedEl) pinnedEl.textContent = pinned.toString()
    if (projectEl) projectEl.textContent = project.toString()
    if (deletableEl) deletableEl.textContent = deletable.toString()
  }

  function renderChatList(): void {
    const chatList = document.getElementById('gcc-chat-list')
    if (!chatList) return

    const filteredChats = getFilteredChats()

    if (filteredChats.length === 0) {
      chatList.innerHTML = '<div class="gcc-status">No chats found</div>'
      return
    }

    chatList.innerHTML = filteredChats
      .map((chat) => {
        const isSelected = selectedChats.has(chat.id)
        const { keep, reason } = shouldKeepChat(chat, filterConfig)
        const classes = [
          'gcc-chat-item',
          isSelected ? 'selected' : '',
          chat.isPinned ? 'pinned' : '',
          chat.isProject ? 'project' : '',
        ]
          .filter(Boolean)
          .join(' ')

        return `
          <div class="${classes}" data-chat-id="${chat.id}">
            <div class="gcc-checkbox ${isSelected ? 'checked' : ''}"></div>
            <div style="flex: 1; min-width: 0;">
              <div style="font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${chat.title}
              </div>
              <div style="font-size: 12px; color: var(--gcc-text-secondary); display: flex; gap: 8px;">
                <span>${formatRelativeTime(chat.lastModified)}</span>
                ${chat.isPinned ? '<span style="color: var(--gcc-primary);">📌 Pinned</span>' : ''}
                ${chat.isProject ? '<span style="color: #8b5cf6;">📁 Project</span>' : ''}
              </div>
            </div>
            ${!keep ? `<div style="font-size: 11px; color: var(--gcc-danger);">${reason}</div>` : ''}
            <button class="gcc-dots-btn" data-chat-id="${chat.id}" title="Open menu">⋮</button>
          </div>
        `
      })
      .join('')

    // Add click handlers for chat items
    chatList.querySelectorAll('.gcc-chat-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        const chatId = item.getAttribute('data-chat-id')
        if (!chatId) return

        // Ignore clicks on the dots button
        if ((e.target as HTMLElement).closest('.gcc-dots-btn')) return

        if (selectedChats.has(chatId)) {
          selectedChats.delete(chatId)
        } else {
          selectedChats.add(chatId)
        }

        renderChatList()
        updateDeleteButton()
      })
    })

    // Add 3-dots button handlers — opens ChatGPT's native menu
    chatList.querySelectorAll('.gcc-dots-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const chatId = btn.getAttribute('data-chat-id')
        if (!chatId) return

        const chat = chats.find((c) => c.id === chatId)
        if (!chat) return

        await openNativeMenu(chat)
      })
    })

    updateDeleteButton()
  }

  function updateDeleteButton(): void {
    const deleteBtn = document.getElementById('gcc-delete') as HTMLButtonElement
    if (deleteBtn) {
      deleteBtn.disabled = selectedChats.size === 0
      deleteBtn.textContent = selectedChats.size > 0 ? `Delete (${selectedChats.size})` : 'Delete'
    }

    const autoDeleteBtn = document.getElementById('gcc-auto-delete') as HTMLButtonElement
    if (autoDeleteBtn) {
      autoDeleteBtn.disabled = chats.length === 0
    }
  }

  function renderProgress(total: number, completed: number, failed: number, currentChatError?: string, currentChat?: string): void {
    const chatList = document.getElementById('gcc-chat-list')
    if (!chatList) return
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0
    const remaining = total - completed - failed
    chatList.innerHTML = `
      <div class="gcc-progress-card">
        <div class="gcc-progress-header">
          <div class="gcc-status">
            Deleting chats: ${completed}/${total} completed
          </div>
          <div class="gcc-progress-percentage">${percentage}%</div>
        </div>
        <div class="gcc-progress-details">
          <div class="gcc-stat-row">
            <span>Completed</span>
            <span style="color: var(--gcc-primary);">${completed}</span>
          </div>
          <div class="gcc-stat-row">
            <span>Failed</span>
            <span style="color: var(--gcc-danger);">${failed}</span>
          </div>
          <div class="gcc-stat-row">
            <span>Remaining</span>
            <span>${remaining}</span>
          </div>
        </div>
        <div class="gcc-progress">
          <div class="gcc-progress-bar" style="width: ${percentage}%"></div>
        </div>
        ${currentChat ? `<div class="gcc-current-chat">Currently deleting: ${currentChat}</div>` : ''}
        ${currentChatError ? `<div class="gcc-error-message">Error: ${currentChatError}</div>` : ''}
        <div class="gcc-cancel-container">
          <button class="gcc-btn gcc-btn-danger gcc-cancel-btn" id="gcc-cancel-delete">Cancel Deletion</button>
        </div>
      </div>
    `
    
    // Add cancel button handler
    const cancelBtn = document.getElementById('gcc-cancel-delete')
    cancelBtn?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'CANCEL_DELETE' }, () => {
        renderChatList()
        updateDeleteButton()
      })
    })
  }
}

/**
 * Find a chat element in ChatGPT's actual sidebar DOM.
 */
function findChatElement(chat: Chat): Element | null {
  const items = findChatItems()

  // Pass 1: match by href
  if (chat.href) {
    for (const item of items) {
      const href = getChatHref(item)
      if (href === chat.href) return item
    }
  }

  // Pass 2: exact title match
  for (const item of items) {
    const title = getChatTitle(item)
    if (title === chat.title) return item
  }

  // Pass 3: partial title match
  const shortTitle = chat.title.substring(0, 20)
  if (shortTitle.length >= 10) {
    for (const item of items) {
      const title = getChatTitle(item)
      if (title.includes(shortTitle) || chat.title.includes(title)) return item
    }
  }

  return null
}



/**
 * Open ChatGPT's native 3-dots menu for a chat.
 * Finds the chat in the sidebar, hovers it, then clicks the 3-dots button.
 */
async function openNativeMenu(chat: Chat): Promise<void> {
  const target = findChatElement(chat)
  if (!target || !document.body.contains(target)) {
    console.warn('[ChatGPT Cleaner] Could not find chat element:', chat.title)
    return
  }

  // Scroll into view and hover
  target.scrollIntoView({ behavior: 'smooth', block: 'center' })
  await sleep(400)

  const rect = target.getBoundingClientRect()
  const hoverInit: MouseEventInit = { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }
  target.dispatchEvent(new MouseEvent('mouseenter', hoverInit))
  target.dispatchEvent(new MouseEvent('mouseover', hoverInit))
  target.dispatchEvent(new MouseEvent('mousemove', hoverInit))
  await sleep(500)

  // Find and click the 3-dots button
  let moreBtn = findMoreOptionsButton(target)
  if (!moreBtn) {
    await sleep(500)
    moreBtn = findMoreOptionsButton(target)
  }
  if (!moreBtn) {
    console.warn('[ChatGPT Cleaner] 3-dots button not found for:', chat.title)
    return
  }
  ;(moreBtn as HTMLElement).dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
  await sleep(200)
  ;(moreBtn as HTMLElement).click()
}

/**
 * Make an element draggable
 */
function makeDraggable(element: HTMLElement): void {
  const handle = element.querySelector('.gcc-drag-handle') as HTMLElement
  if (!handle) return

  let isDragging = false
  let startX: number
  let startY: number
  let offsetX: number
  let offsetY: number

  handle.addEventListener('mousedown', (e) => {
    isDragging = true
    startX = e.clientX
    startY = e.clientY
    offsetX = element.offsetLeft
    offsetY = element.offsetTop
    element.style.transition = 'none'
  })

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return

    const dx = e.clientX - startX
    const dy = e.clientY - startY

    element.style.left = `${offsetX + dx}px`
    element.style.top = `${offsetY + dy}px`
    element.style.right = 'auto'
  })

  document.addEventListener('mouseup', () => {
    isDragging = false
    element.style.transition = ''
  })
}

/**
 * Show the overlay
 */
export function showOverlay(): void {
  const overlay = document.getElementById(OVERLAY_ID)
  if (overlay) {
    overlay.style.display = 'flex'
  } else {
    createOverlay()
  }
}

/**
 * Hide the overlay
 */
export function hideOverlay(): void {
  const overlay = document.getElementById(OVERLAY_ID)
  if (overlay) {
    overlay.style.display = 'none'
  }
}

/**
 * Toggle the overlay visibility
 */
export function toggleOverlay(): void {
  const overlay = document.getElementById(OVERLAY_ID)
  if (overlay) {
    if (overlay.style.display === 'none') {
      showOverlay()
    } else {
      hideOverlay()
    }
  } else {
    createOverlay()
  }
}

/**
 * Remove the overlay from DOM
 */
export function removeOverlay(): void {
  const overlay = document.getElementById(OVERLAY_ID)
  const container = document.getElementById(OVERLAY_CONTAINER_ID)
  if (overlay) overlay.remove()
  if (container) container.remove()
}
