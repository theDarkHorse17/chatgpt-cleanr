import { useState, useEffect, useCallback } from 'react'
import type { Settings, FilterConfig, DeletionProgress } from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/types'
import { shouldKeepChat, formatRelativeTime } from '../shared/utils'

interface ChatPreview {
  id: string
  title: string
  lastModified: Date
  isPinned: boolean
  isProject: boolean
  keep?: boolean
  reason?: string
}

function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [chats, setChats] = useState<ChatPreview[]>([])
  const [selectedChats, setSelectedChats] = useState<Set<string>>(new Set())
  const [isScanning, setIsScanning] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isAutoDeleting, setIsAutoDeleting] = useState(false)
  const [status, setStatus] = useState<{ text: string; type: 'info' | 'error' | 'success' } | null>(null)
  const [activeTab, setActiveTab] = useState<'chats' | 'settings'>('chats')
  const [currentFilter, setCurrentFilter] = useState<string>('all')
  const [deletionProgress, setDeletionProgress] = useState<DeletionProgress | null>(null)

  // Load settings on mount
  useEffect(() => {
    chrome.storage.sync.get('settings', (result) => {
      if (result.settings) {
        setSettings({ ...DEFAULT_SETTINGS, ...result.settings })
      }
    })
  }, [])

  // Save settings when they change
  useEffect(() => {
    chrome.storage.sync.set({ settings })
  }, [settings])

  // Listen for deletion progress messages
  useEffect(() => {
    const listener = (message: { type: string; payload?: { progress?: DeletionProgress } }) => {
      if (message.type === 'DELETE_PROGRESS' && message.payload?.progress) {
        setDeletionProgress(message.payload.progress)
        setIsDeleting(true)
        setIsAutoDeleting(true)
      } else if (message.type === 'DELETE_COMPLETE' && message.payload?.progress) {
        setDeletionProgress(message.payload.progress)
        setTimeout(() => {
          setDeletionProgress(null)
          setIsDeleting(false)
          setIsAutoDeleting(false)
          handleScan()
        }, 2000)
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  const showStatus = useCallback((text: string, type: 'info' | 'error' | 'success' = 'info') => {
    setStatus({ text, type })
    if (type !== 'error') {
      setTimeout(() => setStatus(null), 4000)
    }
  }, [])

  // Scan chats
  const handleScan = async () => {
    setIsScanning(true)
    showStatus('Scanning chats...')

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) {
        showStatus('No active tab', 'error')
        setIsScanning(false)
        return
      }

      chrome.tabs.sendMessage(tab.id, { type: 'SCAN_CHATS' }, (response) => {
        if (chrome.runtime.lastError) {
          showStatus('Could not connect to ChatGPT', 'error')
          setIsScanning(false)
          return
        }

        if (response?.chats) {
          const chatPreviews: ChatPreview[] = response.chats.map((chat: any) => ({
            ...chat,
            lastModified: new Date(chat.lastModified),
          }))

          const withFilter = chatPreviews.map((chat) => {
            const chatObj = { ...chat, lastModified: new Date(chat.lastModified) }
            const { keep, reason } = shouldKeepChat(
              { ...chatObj, element: document.createElement('div') } as any,
              settings.filterConfig
            )
            return { ...chat, keep, reason }
          })

          setChats(withFilter)
          showStatus(`Found ${withFilter.length} chats`, 'success')
        } else {
          showStatus('No chats found', 'info')
        }

        setIsScanning(false)
      })
    } catch {
      showStatus('Error scanning chats', 'error')
      setIsScanning(false)
    }
  }

  const toggleChatSelection = (chatId: string) => {
    setSelectedChats((prev) => {
      const next = new Set(prev)
      if (next.has(chatId)) next.delete(chatId)
      else next.add(chatId)
      return next
    })
  }

  const handleSelectAll = () => {
    const visibleIds = filteredChats.map((c) => c.id)
    setSelectedChats(new Set(visibleIds))
  }

  const handleSelectNone = () => setSelectedChats(new Set())

  const handleSelectDeletable = () => {
    const ids = filteredChats.filter((c) => !c.keep).map((c) => c.id)
    setSelectedChats(new Set(ids))
  }

  // Delete selected chats
  const handleDelete = async () => {
    if (selectedChats.size === 0) return
    const n = selectedChats.size
    if (!confirm(`Delete ${n} chat${n > 1 ? 's' : ''}? This cannot be undone.`)) return

    setIsDeleting(true)
    showStatus('Deleting...')

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) {
        showStatus('No active tab', 'error')
        setIsDeleting(false)
        return
      }

      const chatIdsToDelete = Array.from(selectedChats)
      chrome.tabs.sendMessage(
        tab.id,
        { type: 'DELETE_CHATS', payload: { chatIds: chatIdsToDelete, delay: settings.deletionDelay } },
        (response) => {
          if (chrome.runtime.lastError) {
            showStatus('Could not delete chats', 'error')
            setIsDeleting(false)
            return
          }

          if (response?.success) {
            const failed = response?.progress?.failed || 0
            const ok = n - failed
            showStatus(failed > 0 ? `Deleted ${ok} (${failed} failed)` : `Deleted ${ok} chats`, failed > 0 ? 'error' : 'success')
            setSelectedChats(new Set())
            handleScan()
          } else {
            showStatus(response?.error || 'Delete failed', 'error')
          }
          setIsDeleting(false)
        }
      )
    } catch {
      showStatus('Error deleting chats', 'error')
      setIsDeleting(false)
    }
  }

  // Auto-delete
  const handleAutoDelete = async () => {
    setIsAutoDeleting(true)
    showStatus('Scanning for deletable chats...')

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) {
        showStatus('No active tab', 'error')
        setIsAutoDeleting(false)
        return
      }

      const requestConfirmation = async () => {
        return new Promise<boolean>((resolve) => {
          chrome.tabs.sendMessage(
            tab.id!,
            { type: 'AUTO_DELETE_CHATS', payload: { confirmed: false, delay: settings.deletionDelay } },
            (response) => {
              if (chrome.runtime.lastError) {
                showStatus('Could not connect to ChatGPT', 'error')
                resolve(false)
                return
              }
              if (response?.requiresConfirmation && response?.count > 0) {
                const preview = (response.chats as { title: string }[])
                  .slice(0, 5)
                  .map((c) => `  ${c.title}`)
                  .join('\n')
                const more = response.count > 5 ? `\n  ...and ${response.count - 5} more` : ''
                resolve(confirm(`Auto-delete ${response.count} chats?\n\n${preview}${more}\n\nThis cannot be undone.`))
              } else {
                showStatus('No deletable chats found', 'info')
                resolve(false)
              }
            }
          )
        })
      }

      const confirmed = settings.confirmBeforeDelete ? await requestConfirmation() : true
      if (!confirmed) { setIsAutoDeleting(false); return }

      showStatus('Deleting...')
      chrome.tabs.sendMessage(
        tab.id,
        { type: 'AUTO_DELETE_CHATS', payload: { confirmed: true, delay: settings.deletionDelay } },
        (response) => {
          if (chrome.runtime.lastError) {
            showStatus('Could not delete chats', 'error')
            setIsAutoDeleting(false)
            return
          }
          if (response?.success) {
            const total = response?.progress?.total || response?.deleted || 0
            const completed = response?.progress?.completed || 0
            const failed = response?.progress?.failed || 0
            showStatus(
              failed > 0 ? `Deleted ${completed}/${total} (${failed} failed)` : `Deleted ${completed}/${total}`,
              failed > 0 ? 'error' : 'success'
            )
            setSelectedChats(new Set())
            handleScan()
          } else {
            showStatus(response?.error || 'Auto-delete failed', 'error')
          }
          setIsAutoDeleting(false)
        }
      )
    } catch {
      showStatus('Error auto-deleting', 'error')
      setIsAutoDeleting(false)
    }
  }

  const updateFilterConfig = (updates: Partial<FilterConfig>) => {
    setSettings((prev) => ({ ...prev, filterConfig: { ...prev.filterConfig, ...updates } }))
  }

  const filteredChats = chats.filter((chat) => {
    switch (currentFilter) {
      case 'deletable': return !chat.keep
      case 'pinned': return chat.isPinned
      case 'project': return chat.isProject
      case 'recent':
        return (Date.now() - chat.lastModified.getTime()) / 86400000 <= 7
      default: return true
    }
  })

  const totalChats = chats.length
  const pinnedChats = chats.filter((c) => c.isPinned).length
  const projectChats = chats.filter((c) => c.isProject).length
  const deletableChats = chats.filter((c) => !c.keep).length
  const isBusy = isScanning || isDeleting || isAutoDeleting

  const filterCounts = {
    all: totalChats,
    deletable: deletableChats,
    pinned: pinnedChats,
    project: projectChats,
    recent: chats.filter((c) => (Date.now() - c.lastModified.getTime()) / 86400000 <= 7).length,
  }

  const pct = deletionProgress && deletionProgress.total > 0
    ? Math.round((deletionProgress.completed / deletionProgress.total) * 100)
    : 0

  return (
    <div className="gcc-popup">
      {/* Header */}
      <div className="gcc-header">
        <div className="gcc-header-left">
          <div className="gcc-logo">CC</div>
          <span className="gcc-title">ChatGPT Cleaner</span>
        </div>
        <div className="gcc-tabs">
          <button
            className={`gcc-tab ${activeTab === 'chats' ? 'active' : ''}`}
            onClick={() => setActiveTab('chats')}
          >
            Chats
          </button>
          <button
            className={`gcc-tab ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            Settings
          </button>
        </div>
      </div>

      {/* Status toast */}
      {status && (
        <div className={`gcc-toast gcc-toast-${status.type}`}>
          {status.type === 'error' ? '!' : status.type === 'success' ? '\u2713' : '\u2022'} {status.text}
        </div>
      )}

      {activeTab === 'chats' ? (
        <>
          {/* Stats */}
          <div className="gcc-stats">
            <div className="gcc-stat-card">
              <div className="gcc-stat-value">{totalChats}</div>
              <div className="gcc-stat-label">Total</div>
            </div>
            <div className="gcc-stat-card gcc-stat-green">
              <div className="gcc-stat-value">{pinnedChats}</div>
              <div className="gcc-stat-label">Pinned</div>
            </div>
            <div className="gcc-stat-card gcc-stat-purple">
              <div className="gcc-stat-value">{projectChats}</div>
              <div className="gcc-stat-label">Projects</div>
            </div>
            <div className="gcc-stat-card gcc-stat-red">
              <div className="gcc-stat-value">{deletableChats}</div>
              <div className="gcc-stat-label">Deletable</div>
            </div>
          </div>

          {/* Filters */}
          <div className="gcc-filters">
            {(['all', 'deletable', 'pinned', 'project', 'recent'] as const).map((f) => (
              <button
                key={f}
                className={`gcc-filter ${currentFilter === f ? 'active' : ''}`}
                onClick={() => setCurrentFilter(f)}
              >
                {f}
                <span className="gcc-filter-count">{filterCounts[f]}</span>
              </button>
            ))}
          </div>

          {/* Chat list */}
          <div className="gcc-chat-list">
            {totalChats === 0 && !isScanning ? (
              <div className="gcc-empty">
                <div className="gcc-empty-icon">{'\u{1F50D}'}</div>
                <div className="gcc-empty-title">No chats loaded</div>
                <div className="gcc-empty-desc">Click <strong>Scan</strong> to find your ChatGPT conversations</div>
              </div>
            ) : filteredChats.length === 0 && !isScanning ? (
              <div className="gcc-empty">
                <div className="gcc-empty-icon">{'\u2713'}</div>
                <div className="gcc-empty-title">Nothing here</div>
                <div className="gcc-empty-desc">No chats match the current filter</div>
              </div>
            ) : (
              filteredChats.map((chat) => (
                <div
                  key={chat.id}
                  className={`gcc-chat-item ${selectedChats.has(chat.id) ? 'selected' : ''} ${chat.isPinned ? 'pinned' : ''} ${chat.isProject ? 'project' : ''}`}
                  onClick={() => toggleChatSelection(chat.id)}
                >
                  <div className={`gcc-checkbox ${selectedChats.has(chat.id) ? 'checked' : ''}`} />
                  <div className="gcc-chat-body">
                    <div className="gcc-chat-title">{chat.title}</div>
                    <div className="gcc-chat-meta">
                      <span className="gcc-chat-time">{formatRelativeTime(chat.lastModified)}</span>
                      {chat.isPinned && <span className="gcc-badge gcc-badge-green">Pinned</span>}
                      {chat.isProject && <span className="gcc-badge gcc-badge-purple">Project</span>}
                      {!chat.keep && <span className="gcc-badge gcc-badge-red">{chat.reason}</span>}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Selection bar */}
          {totalChats > 0 && (
            <div className="gcc-selection-bar">
              <div className="gcc-selection-info">
                {selectedChats.size > 0
                  ? <>{selectedChats.size} selected</>
                  : <>{filteredChats.length} visible</>
                }
              </div>
              <div className="gcc-selection-actions">
                <button className="gcc-link-btn" onClick={handleSelectAll} disabled={isBusy}>All</button>
                <button className="gcc-link-btn" onClick={handleSelectDeletable} disabled={isBusy}>Deletable</button>
                <button className="gcc-link-btn" onClick={handleSelectNone} disabled={isBusy}>None</button>
              </div>
            </div>
          )}

          {/* Action bar */}
          <div className="gcc-actions">
            <button className="gcc-btn gcc-btn-secondary" onClick={handleScan} disabled={isBusy}>
              {isScanning ? (
                <><span className="gcc-spinner" /> Scanning</>
              ) : (
                <>{'\u{1F504}'} Scan</>
              )}
            </button>
            <div className="gcc-actions-right">
              <button
                className="gcc-btn gcc-btn-danger"
                onClick={handleAutoDelete}
                disabled={isBusy || deletableChats === 0}
              >
                {isAutoDeleting ? (
                  <><span className="gcc-spinner" /> Deleting</>
                ) : (
                  <>Delete All ({deletableChats})</>
                )}
              </button>
              <button
                className="gcc-btn gcc-btn-primary"
                onClick={handleDelete}
                disabled={isBusy || selectedChats.size === 0}
              >
                {isDeleting ? (
                  <><span className="gcc-spinner" /> Deleting</>
                ) : (
                  <>Delete ({selectedChats.size})</>
                )}
              </button>
            </div>
          </div>

          {/* Progress panel */}
          {deletionProgress && (
            <div className="gcc-progress-panel">
              <div className="gcc-progress-header">
                <span className="gcc-progress-label">
                  {deletionProgress.currentChat?.startsWith('Cooldown')
                    ? 'Cooldown'
                    : 'Deleting'}
                </span>
                <span className="gcc-progress-pct">{pct}%</span>
              </div>

              <div className="gcc-progress-bar-track">
                <div
                  className="gcc-progress-bar-fill"
                  style={{ width: `${pct}%` }}
                />
              </div>

              <div className="gcc-progress-stats">
                <div className="gcc-progress-stat">
                  <span className="gcc-progress-stat-num gcc-green">{deletionProgress.completed}</span>
                  <span className="gcc-progress-stat-label">Done</span>
                </div>
                <div className="gcc-progress-stat">
                  <span className="gcc-progress-stat-num gcc-red">{deletionProgress.failed}</span>
                  <span className="gcc-progress-stat-label">Failed</span>
                </div>
                <div className="gcc-progress-stat">
                  <span className="gcc-progress-stat-num">
                    {deletionProgress.total - deletionProgress.completed - deletionProgress.failed}
                  </span>
                  <span className="gcc-progress-stat-label">Left</span>
                </div>
                <div className="gcc-progress-stat">
                  <span className="gcc-progress-stat-num">{deletionProgress.total}</span>
                  <span className="gcc-progress-stat-label">Total</span>
                </div>
              </div>

              {deletionProgress.currentChat && (
                <div className="gcc-progress-current">
                  {deletionProgress.currentChat}
                </div>
              )}

              {deletionProgress.currentChatError && (
                <div className="gcc-progress-error">
                  {deletionProgress.currentChatError}
                </div>
              )}

              <button
                className="gcc-btn gcc-btn-danger gcc-cancel-btn"
                onClick={() => {
                  chrome.runtime.sendMessage({ type: 'CANCEL_DELETE' }, () => {
                    setDeletionProgress(null)
                    setIsDeleting(false)
                    setIsAutoDeleting(false)
                  })
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </>
      ) : (
        /* Settings */
        <div className="gcc-settings">
          <div className="gcc-settings-group">
            <div className="gcc-settings-title">Protection</div>
            <label className="gcc-toggle">
              <input
                type="checkbox"
                checked={settings.filterConfig.keepPinned}
                onChange={(e) => updateFilterConfig({ keepPinned: e.target.checked })}
              />
              <span className="gcc-toggle-track"><span className="gcc-toggle-thumb" /></span>
              <span className="gcc-toggle-label">Keep pinned chats</span>
            </label>
            <label className="gcc-toggle">
              <input
                type="checkbox"
                checked={settings.filterConfig.keepProjectChats}
                onChange={(e) => updateFilterConfig({ keepProjectChats: e.target.checked })}
              />
              <span className="gcc-toggle-track"><span className="gcc-toggle-thumb" /></span>
              <span className="gcc-toggle-label">Keep project chats</span>
            </label>
            <div className="gcc-input-group">
              <label className="gcc-input-label">Keep recent chats (days)</label>
              <input
                type="number"
                value={settings.filterConfig.keepRecentDays}
                onChange={(e) => updateFilterConfig({ keepRecentDays: parseInt(e.target.value) || 0 })}
                className="gcc-input"
                min="0"
              />
            </div>
          </div>

          <div className="gcc-settings-group">
            <div className="gcc-settings-title">Timing</div>
            <div className="gcc-input-group">
              <label className="gcc-input-label">Deletion delay (ms)</label>
              <input
                type="number"
                value={settings.deletionDelay}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, deletionDelay: parseInt(e.target.value) || 5000 }))
                }
                className="gcc-input"
                min="500"
                step="100"
              />
              <div className="gcc-input-hint">Time between each deletion. Batches auto-pause 45-75s every 22 chats.</div>
            </div>
          </div>

          <div className="gcc-settings-group">
            <div className="gcc-settings-title">Keywords</div>
            <div className="gcc-input-group">
              <label className="gcc-input-label">Keep keywords</label>
              <input
                type="text"
                value={settings.filterConfig.keepKeywords.join(', ')}
                onChange={(e) =>
                  updateFilterConfig({
                    keepKeywords: e.target.value.split(',').map((k) => k.trim()).filter(Boolean),
                  })
                }
                placeholder="important, work, project"
                className="gcc-input"
              />
            </div>
            <div className="gcc-input-group">
              <label className="gcc-input-label">Delete keywords</label>
              <input
                type="text"
                value={settings.filterConfig.deleteKeywords.join(', ')}
                onChange={(e) =>
                  updateFilterConfig({
                    deleteKeywords: e.target.value.split(',').map((k) => k.trim()).filter(Boolean),
                  })
                }
                placeholder="test, temp, old"
                className="gcc-input"
              />
            </div>
          </div>

          <div className="gcc-settings-group">
            <div className="gcc-settings-title">Interface</div>
            <label className="gcc-toggle">
              <input
                type="checkbox"
                checked={settings.showOverlay}
                onChange={(e) => setSettings((prev) => ({ ...prev, showOverlay: e.target.checked }))}
              />
              <span className="gcc-toggle-track"><span className="gcc-toggle-thumb" /></span>
              <span className="gcc-toggle-label">Show overlay on ChatGPT</span>
            </label>
            <label className="gcc-toggle">
              <input
                type="checkbox"
                checked={settings.confirmBeforeDelete}
                onChange={(e) => setSettings((prev) => ({ ...prev, confirmBeforeDelete: e.target.checked }))}
              />
              <span className="gcc-toggle-track"><span className="gcc-toggle-thumb" /></span>
              <span className="gcc-toggle-label">Confirm before auto-delete</span>
            </label>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="gcc-footer">
        <kbd>Ctrl+Shift+G</kbd> toggle overlay
      </div>
    </div>
  )
}

export default App
