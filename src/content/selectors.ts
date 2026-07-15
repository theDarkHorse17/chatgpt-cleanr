/**
 * ChatGPT DOM Selectors — resilient text + structure based approach
 * ChatGPT's DOM changes frequently, so we rely on text content and
 * structural patterns rather than data-testid attributes.
 */

const DEBUG = true

function log(...args: unknown[]): void {
  if (DEBUG) console.log('[ChatGPT Cleaner]', ...args)
}

// ── Generic helpers ──────────────────────────────────────────────────────────

/** Try multiple selectors and return the first match */
export function findElement(selectors: string[], parent: Element | Document = document): Element | null {
  for (const selector of selectors) {
    try {
      const el = parent.querySelector(selector)
      if (el) return el
    } catch { /* invalid selector */ }
  }
  return null
}

/** Find all matching elements across multiple selectors (deduplicated) */
export function findAllElements(selectors: string[], parent: Element | Document = document): Element[] {
  const elements = new Set<Element>()
  for (const selector of selectors) {
    try {
      parent.querySelectorAll(selector).forEach((el) => elements.add(el))
    } catch { /* skip */ }
  }
  return Array.from(elements)
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

export const SIDEBAR_SELECTORS = [
  'nav[aria-label="Chat history"]',
  'nav[role="navigation"]',
  '#history',
  'aside nav',
  '[data-testid="chat-history"]',
]

export function findSidebar(): Element | null {
  return findElement(SIDEBAR_SELECTORS)
}

// ── Chat items ───────────────────────────────────────────────────────────────

export const CHAT_ITEM_SELECTORS = [
  'a[href*="/c/"]',
  'a[href*="/g/"]',
  '[role="grid"] [role="row"]',
  'li a',
  'div[class*="conversation"]',
  '[data-testid="conversation-turn"]',
  '[data-testid="history-item"]',
  '[data-testid="chat-history-item"]',
  'nav a[href]',
  'nav [role="listitem"]',
  'aside a[href]',
]

export function findChatItems(): Element[] {
  const sidebar = findSidebar()
  if (!sidebar) {
    log('findChatItems: no sidebar found')
    return []
  }
  const items = findAllElements(CHAT_ITEM_SELECTORS, sidebar)
  log(`findChatItems: found ${items.length} items`)
  return items
}

// ── Chat title ───────────────────────────────────────────────────────────────

export const CHAT_TITLE_SELECTORS = [
  'span[class*="truncate"]',
  'div[class*="title"]',
  'span',
  'p',
]

export function getChatTitle(chatItem: Element): string {
  for (const selector of CHAT_TITLE_SELECTORS) {
    try {
      const titleEl = chatItem.querySelector(selector)
      if (titleEl?.textContent) return titleEl.textContent.trim()
    } catch { /* skip */ }
  }
  return 'Untitled'
}

// ── Chat href ────────────────────────────────────────────────────────────────

export function getChatHref(chatItem: Element): string | undefined {
  const href = chatItem.getAttribute('href')
  if (href && (href.includes('/c/') || href.includes('/g/'))) {
    return chatItem instanceof HTMLAnchorElement ? chatItem.href : href
  }
  const link = chatItem.querySelector('a[href*="/c/"], a[href*="/g/"]') as HTMLAnchorElement
  return link?.href
}

// ── Pin / Project detection ──────────────────────────────────────────────────

export const PIN_INDICATORS = [
  '[data-testid="pin-icon"]',
  'svg[class*="pin"]',
  '[aria-label="Pinned"]',
  '[class*="pinned"]',
  'button[aria-label*="Unpin"]',
]

export const PROJECT_INDICATORS = [
  '[data-testid="project-icon"]',
  '[data-testid="project"]',
  '[class*="project"]',
  '[class*="Project"]',
  '[aria-label="Project"]',
  '[aria-label="project"]',
  'a[href*="/g/"]',
  'svg[class*="folder"]',
  '[class*="folder"]',
]

export function isChatPinned(chatItem: Element): boolean {
  for (const selector of PIN_INDICATORS) {
    try {
      if (chatItem.querySelector(selector)) return true
    } catch { /* skip */ }
  }
  if (chatItem.getAttribute('aria-label')?.includes('Pinned')) return true
  if (chatItem.querySelector('[aria-label*="Pinned"]')) return true
  return false
}

export function isChatProject(chatItem: Element): boolean {
  const selfHref = chatItem.getAttribute('href')
  if (selfHref && selfHref.includes('/g/')) return true
  for (const selector of PROJECT_INDICATORS) {
    try {
      if (chatItem.querySelector(selector)) return true
    } catch { /* skip */ }
  }
  if (chatItem.querySelector('a[href*="/g/"]')) return true
  return false
}

// ── Scroll container ─────────────────────────────────────────────────────────
// ChatGPT renders the scrollable chat list inside the sidebar <nav>.
// We detect any element with overflow-y: auto|scroll that has scrollable content.

export const SCROLL_CONTAINER_SELECTORS = [
  '[role="navigation"] > div',
  '#history',
  'nav > div',
  '[data-testid="chat-history"] > div',
]

function isScrollable(el: Element): boolean {
  const style = window.getComputedStyle(el)
  const overflowY = style.overflowY
  return (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight
}

export function findScrollContainer(): Element | null {
  // 1. Try known selectors
  const bySelector = findElement(SCROLL_CONTAINER_SELECTORS)
  if (bySelector && isScrollable(bySelector)) {
    log('findScrollContainer: found by selector')
    return bySelector
  }

  // 2. Search inside the sidebar for any scrollable element
  const sidebar = findSidebar()
  if (sidebar) {
    const allElements = sidebar.querySelectorAll('*')
    for (const el of allElements) {
      if (isScrollable(el)) {
        log('findScrollContainer: found scrollable element in sidebar')
        return el
      }
    }

    // 3. The sidebar itself might be scrollable
    if (isScrollable(sidebar)) {
      log('findScrollContainer: sidebar itself is scrollable')
      return sidebar
    }
  }

  // 4. Last resort: find ANY scrollable element that contains chat links
  const allDivs = document.querySelectorAll('div, nav, aside')
  for (const el of allDivs) {
    if (isScrollable(el) && el.querySelector('a[href*="/c/"]')) {
      log('findScrollContainer: found scrollable container with chat links')
      return el
    }
  }

  log('findScrollContainer: NOT FOUND')
  return null
}

// ── More options button (three dots) ─────────────────────────────────────────
// Strategy: find any button inside/near the chat item that has an SVG icon
// (ChatGPT always uses an SVG for the three-dot icon).

export const MORE_OPTIONS_SELECTORS = [
  'button[aria-label="More"]',
  'button[aria-label="Options"]',
  'button[aria-label="More options"]',
  'button[aria-label="Chat menu"]',
  'button[aria-label="Sidebar button"]',
  'button[aria-label="Open options"]',
  'button[aria-label="Open menu"]',
  '[data-testid="more-button"]',
  '[data-testid="conversation-menu-button"]',
  '[data-testid="chat-menu-button"]',
]

export function findMoreOptionsButton(chatItem: Element): Element | null {
  // 1. Try known selectors inside the chat item
  const bySelector = findElement(MORE_OPTIONS_SELECTORS, chatItem)
  if (bySelector && isVisible(bySelector)) {
    log('findMoreOptionsButton: found by selector')
    return bySelector
  }

  // 2. Try parent elements too (hover buttons may be in a wrapper)
  let parent: Element | null = chatItem
  while (parent && parent !== document.body) {
    const byParent = findElement(MORE_OPTIONS_SELECTORS, parent)
    if (byParent && isVisible(byParent)) {
      log('findMoreOptionsButton: found in parent')
      return byParent
    }
    parent = parent.parentElement
  }

  // 3. Fallback: find icon-only buttons, but EXCLUDE pin/project buttons.
  //    The "more options" button is typically the LAST icon button in the row.
  const searchRoot = chatItem.closest('div, li') || chatItem
  const buttons = Array.from(searchRoot.querySelectorAll('button'))

  // Collect all icon-only buttons (SVG + no text), excluding known non-target buttons
  const iconButtons = buttons.filter((btn) => {
    if (!isVisible(btn)) return false
    const hasSvg = btn.querySelector('svg')
    const textContent = btn.textContent?.trim() || ''
    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase()

    // Must have SVG and no text
    if (!hasSvg || textContent.length > 0) return false

    // EXCLUDE pin/unpin buttons
    if (ariaLabel.includes('pin') || ariaLabel.includes('unpin')) return false

    // EXCLUDE project/folder buttons
    if (ariaLabel.includes('project') || ariaLabel.includes('folder')) return false

    // EXCLUDE share/duplicate buttons
    if (ariaLabel.includes('share') || ariaLabel.includes('copy') || ariaLabel.includes('duplicate')) return false

    return true
  })

  if (iconButtons.length > 0) {
    // The more-options button is usually the LAST icon button (rightmost)
    const lastIcon = iconButtons[iconButtons.length - 1]
    log('findMoreOptionsButton: found last icon button (likely more-options)')
    return lastIcon
  }

  // 4. Last resort: any button with aria-label matching menu/more/options
  for (const btn of buttons) {
    if (!isVisible(btn)) continue
    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase()
    if (ariaLabel.includes('more') || ariaLabel.includes('option') || ariaLabel.includes('menu')) {
      log('findMoreOptionsButton: found by aria-label fuzzy match')
      return btn
    }
  }

  // 5. Search whole document for a visible more-options button (last resort)
  const allButtons = document.querySelectorAll('button')
  for (const btn of allButtons) {
    if (!isVisible(btn)) continue
    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase()
    if (ariaLabel.includes('more options') || ariaLabel.includes('chat menu') || ariaLabel.includes('open menu')) {
      log('findMoreOptionsButton: found by global search')
      return btn
    }
  }

  log('findMoreOptionsButton: NOT FOUND')
  return null
}

// ── Delete option in context menu ────────────────────────────────────────────
// Strategy: find the menu item whose text says "Delete". ChatGPT renders the
// context menu as a popover/dropdown — the items are typically buttons or
// divs with role="menuitem".

function isDeleteText(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  // Exact matches and command-style matches
  const deleteTexts = [
    'delete',
    'delete chat',
    'delete conversation',
    'delete this chat',
    'move to trash',
    'trash',
  ]
  return deleteTexts.some(
    (t) =>
      normalized === t ||
      normalized.startsWith(t + ' ') ||
      normalized.endsWith(' ' + t) ||
      normalized.startsWith(t + '\n')
  )
}

export function findDeleteOption(): Element | null {
  // 1. Try data-testid / common selectors first
  const selectors = [
    '[data-testid="menu-item-delete"]',
    '[data-testid="delete-chat-menu-item"]',
    '[role="menuitem"][data-testid*="delete"]',
  ]
  for (const selector of selectors) {
    const el = document.querySelector(selector)
    if (el && isVisible(el)) {
      log('findDeleteOption: found by selector', selector)
      return el
    }
  }

  // 2. Search ALL clickable elements for text matching "delete"
  //    The context menu may be rendered in a portal (outside the sidebar DOM)
  const candidates = document.querySelectorAll(
    'button, [role="menuitem"], [role="menuitemradio"], [role="option"], div[role="menuitem"], a, li'
  )

  // First pass: exact/starts-with match and visible
  for (const el of candidates) {
    if (!isVisible(el)) continue
    const text = getElementText(el)
    if (isDeleteText(text)) {
      log(`findDeleteOption: found by text "${text}"`)
      return el
    }
  }

  // Second pass: fuzzy includes "delete", exclude dialog buttons and "delete all"
  for (const el of candidates) {
    if (!isVisible(el)) continue
    // Skip elements inside a confirmation dialog
    if (el.closest('[role="dialog"], [role="alertdialog"]')) continue
    const text = getElementText(el)
    if (text.includes('delete') && !text.includes('delete all') && !text.includes('delete account') && text.length < 40) {
      log(`findDeleteOption: found by fuzzy text "${text}"`)
      return el
    }
  }

  log('findDeleteOption: NOT FOUND')
  return null
}

// ── Pin / Unpin option in context menu ───────────────────────────────────────

export function findPinOption(): Element | null {
  const candidates = document.querySelectorAll(
    'button, [role="menuitem"], [role="menuitemradio"], [role="option"], div[role="menuitem"], a'
  )
  for (const el of candidates) {
    const text = el.textContent?.trim().toLowerCase() || ''
    if (text === 'pin' || text === 'pin chat' || text === 'unpin' || text === 'unpin chat') {
      log(`findPinOption: found by text "${el.textContent?.trim()}"`)
      return el
    }
  }

  const allClickable = document.querySelectorAll('button, [role="menuitem"], [role="menuitemradio"], [role="option"], [tabindex]')
  for (const el of allClickable) {
    const text = el.textContent?.trim().toLowerCase() || ''
    if ((text.includes('pin') || text.includes('unpin')) && text.length < 25) {
      log(`findPinOption: found by fuzzy text "${el.textContent?.trim()}"`)
      return el
    }
  }

  log('findPinOption: NOT FOUND')
  return null
}

// ── Rename option in context menu ────────────────────────────────────────────

export function findRenameOption(): Element | null {
  const candidates = document.querySelectorAll(
    'button, [role="menuitem"], [role="menuitemradio"], [role="option"], div[role="menuitem"], a'
  )
  for (const el of candidates) {
    const text = el.textContent?.trim().toLowerCase() || ''
    if (text === 'rename' || text === 'rename chat' || text === 'edit title') {
      log(`findRenameOption: found by text "${el.textContent?.trim()}"`)
      return el
    }
  }

  const allClickable = document.querySelectorAll('button, [role="menuitem"], [role="menuitemradio"], [role="option"], [tabindex]')
  for (const el of allClickable) {
    const text = el.textContent?.trim().toLowerCase() || ''
    if (text.includes('rename') && text.length < 25) {
      log(`findRenameOption: found by fuzzy text "${el.textContent?.trim()}"`)
      return el
    }
  }

  log('findRenameOption: NOT FOUND')
  return null
}

// ── Visibility helpers ───────────────────────────────────────────────────────

export function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return true
  const rect = element.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return false
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
  return true
}

function getElementText(element: Element): string {
  // Use aria-label if present, otherwise full text content from the element and its children
  const ariaLabel = element.getAttribute('aria-label')
  if (ariaLabel) return ariaLabel.trim().toLowerCase()
  return (element.textContent || '').trim().toLowerCase()
}

function isConfirmText(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  const confirmTexts = [
    'delete',
    'confirm',
    'yes',
    'ok',
    'remove',
    'delete chat',
    'delete conversation',
    'delete forever',
    'move to trash',
    'got it',
  ]
  return confirmTexts.some(
    (t) =>
      normalized === t ||
      normalized.startsWith(t + ' ') ||
      normalized.endsWith(' ' + t) ||
      normalized.startsWith(t + '\n')
  )
}

// ── Confirm dialog & button ──────────────────────────────────────────────────
// We only want true modal dialogs, not dropdown menus / popovers.
// A real confirmation dialog has role="dialog" or aria-modal="true" or
// contains explicit confirmation text.

export function findConfirmDialog(): Element | null {
  // 1. Strict modal selectors first
  const strictSelectors = [
    '[role="dialog"][aria-modal="true"]',
    '[role="alertdialog"]',
    '[data-testid="confirm-dialog"]',
    '[data-testid="modal"]',
  ]
  const strict = findElement(strictSelectors)
  if (strict) {
    log('findConfirmDialog: found strict modal')
    return strict
  }

  // 2. Any role="dialog" that contains confirmation text
  const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]')
  for (const dialog of dialogs) {
    const text = dialog.textContent?.trim().toLowerCase() || ''
    if (
      text.includes('delete') ||
      text.includes('remove') ||
      text.includes('confirm') ||
      text.includes('are you sure')
    ) {
      log('findConfirmDialog: found dialog with confirmation text')
      return dialog
    }
  }

  // 3. Last resort: any visible container that looks like a centered modal
  //    (not a sidebar popover). We exclude elements inside the sidebar.
  const sidebar = findSidebar()
  const candidates = document.querySelectorAll(
    '[class*="dialog"], [class*="Dialog"], [class*="modal"], [class*="Modal"]'
  )
  for (const candidate of candidates) {
    if (sidebar && sidebar.contains(candidate)) continue
    if (!isVisible(candidate)) continue
    const text = candidate.textContent?.trim().toLowerCase() || ''
    if (text.includes('delete') || text.includes('confirm') || text.includes('are you sure')) {
      log('findConfirmDialog: found modal-like container')
      return candidate
    }
  }

  log('findConfirmDialog: NOT FOUND')
  return null
}

export function findConfirmButton(): Element | null {
  const dialog = findConfirmDialog()

  if (dialog) {
    log('findConfirmButton: found dialog, searching inside only')

    // 1a. Try data-testid
    const testIdSelectors = [
      '[data-testid="confirm-button"]',
      '[data-testid="delete-button"]',
      '[data-testid="confirm-delete-button"]',
    ]
    for (const selector of testIdSelectors) {
      const byTestId = dialog.querySelector(selector)
      if (byTestId && isVisible(byTestId)) {
        log('findConfirmButton: found by selector in dialog', selector)
        return byTestId
      }
    }

    // 1b. Search buttons in dialog for confirm text
    const buttons = Array.from(dialog.querySelectorAll('button, [role="button"], [role="menuitem"]'))
    // Prefer visible buttons with confirm/danger text
    for (const btn of buttons) {
      if (!isVisible(btn)) continue
      const text = getElementText(btn)
      if (isConfirmText(text)) {
        log(`findConfirmButton: found by text "${text}" in dialog`)
        return btn
      }
    }

    // 1c. Danger/primary styled button in dialog
    const styledSelectors = [
      'button[data-variant="danger"]',
      'button[data-variant="primary"]',
      'button[type="submit"]',
      'button[class*="danger"]',
      'button[class*="red"]',
      'button[class*="destructive"]',
    ]
    for (const selector of styledSelectors) {
      const styledBtn = dialog.querySelector(selector)
      if (styledBtn && isVisible(styledBtn)) {
        log('findConfirmButton: found styled button in dialog', selector)
        return styledBtn
      }
    }

    // 1d. Any visible button in the dialog that is NOT cancel/close/no (fallback)
    for (const btn of buttons) {
      if (!isVisible(btn)) continue
      const text = getElementText(btn)
      if (text && !text.includes('cancel') && !text.includes('close') && !text.includes('no')) {
        log(`findConfirmButton: falling back to visible button "${text}" in dialog`)
        return btn
      }
    }

    // If we found a dialog but no button inside it, do NOT fall back to the
    // global search — that would click the original menu item.
    log('findConfirmButton: dialog found but no button inside')
    return null
  }

  // 2. No dialog found — search whole document for a standalone confirm button
  const allButtons = document.querySelectorAll('button, [role="button"]')
  for (const btn of allButtons) {
    if (!isVisible(btn)) continue
    const text = getElementText(btn)
    if (isConfirmText(text)) {
      log(`findConfirmButton: found by text "${text}" globally`)
      return btn
    }
  }

  log('findConfirmButton: NOT FOUND')
  return null
}

// ── Cancel button ────────────────────────────────────────────────────────────

export function findCancelButton(): Element | null {
  const dialog = findConfirmDialog()
  const searchRoot = dialog || document

  const buttons = searchRoot.querySelectorAll('button, [role="button"]')
  for (const btn of buttons) {
    const text = btn.textContent?.trim().toLowerCase() || ''
    if (text === 'cancel' || text === 'no' || text === 'close') {
      return btn
    }
  }
  return null
}
