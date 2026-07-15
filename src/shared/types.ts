// Chat metadata extracted from the sidebar
export interface Chat {
  id: string
  title: string
  lastModified: Date
  isPinned: boolean
  isProject: boolean
  projectId?: string
  element: HTMLElement
  href?: string
}

// Filter configuration
export interface FilterConfig {
  // Keep chats newer than this (in days)
  keepRecentDays: number
  // Keep pinned chats
  keepPinned: boolean
  // Keep project chats
  keepProjectChats: boolean
  // Keywords to keep (chat titles containing these won't be deleted)
  keepKeywords: string[]
  // Keywords to delete (chat titles containing these will be deleted)
  deleteKeywords: string[]
  // Maximum age of chats to delete (in days, 0 = no limit)
  maxAgeDays: number
}

// Deletion progress
export interface DeletionProgress {
  total: number
  completed: number
  failed: number
  currentChat?: string
  currentChatError?: string
  status: 'idle' | 'scanning' | 'deleting' | 'completed' | 'error'
  error?: string
}

// Subscription tier
export type Tier = 'free' | 'pro'

// License data stored in chrome.storage
export interface LicenseData {
  key: string       // raw license key string
  tier: Tier
  email: string
  validUntil: number // timestamp (ms), 0 = lifetime
  activatedAt: number // timestamp (ms)
}

// Daily usage tracking
export interface UsageData {
  date: string       // YYYY-MM-DD
  deletions: number  // chats deleted today
}

// Extension settings
export interface Settings {
  filterConfig: FilterConfig
  autoScan: boolean
  showOverlay: boolean
  deletionDelay: number // ms between deletions
  confirmBeforeDelete: boolean // show confirmation before auto-delete
}

// Message types for communication between content script and popup
export type MessageType =
  | 'SCAN_CHATS'
  | 'SCAN_RESULT'
  | 'DELETE_CHATS'
  | 'AUTO_DELETE_CHATS'
  | 'CANCEL_DELETE'
  | 'DELETE_PROGRESS'
  | 'DELETE_COMPLETE'
  | 'GET_SETTINGS'
  | 'SETTINGS_UPDATED'
  | 'SHOW_OVERLAY'
  | 'HIDE_OVERLAY'

export interface Message {
  type: MessageType
  payload?: unknown
}

// Default settings
export const DEFAULT_SETTINGS: Settings = {
  filterConfig: {
    keepRecentDays: 30,
    keepPinned: true,
    keepProjectChats: true,
    keepKeywords: [],
    deleteKeywords: [],
    maxAgeDays: 0,
  },
  autoScan: true,
  showOverlay: true,
  deletionDelay: 5000,
  confirmBeforeDelete: true,
}

// Default filter config
export const DEFAULT_FILTER_CONFIG: FilterConfig = {
  keepRecentDays: 30,
  keepPinned: true,
  keepProjectChats: true,
  keepKeywords: [],
  deleteKeywords: [],
  maxAgeDays: 0,
}

// Free tier constants
export const FREE_DAILY_DELETE_LIMIT = 10
export const PRO_DAILY_DELETE_LIMIT = Infinity
