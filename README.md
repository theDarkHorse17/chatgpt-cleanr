# ChatGPT Cleaner

A Chrome extension that bulk deletes ChatGPT conversations while preserving project and pinned messages.

## Features

- **Bulk Delete**: Select and delete multiple ChatGPT conversations at once
- **Auto Delete**: One-click scan + delete of all conversations that match your filters
- **Smart Filtering**: Automatically identifies and preserves:
  - Pinned chats
  - Project-based chats
  - Recent chats (configurable)
- **Overlay Panel**: Injected floating panel on ChatGPT for easy management
- **Popup UI**: Quick actions and settings from the extension popup
- **Configurable**: Set custom filters for what to keep/delete

## Installation

### Development Setup

1. **Clone or download this repository**

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the extension**
   ```bash
   npm run build
   ```

4. **Load in Chrome**
   - Open Chrome and go to `chrome://extensions`
   - Enable **Developer mode** (top right)
   - Click **Load unpacked**
   - Select the `dist` folder from this project

5. **Pin the extension**
   - Click the puzzle piece icon in Chrome's toolbar
   - Find "ChatGPT Cleaner" and click the pin icon

### Usage

1. **Open ChatGPT**
   - Navigate to [chatgpt.com](https://chatgpt.com) or [chat.openai.com](https://chat.openai.com)

2. **Use the Overlay Panel**
   - The overlay panel will appear automatically (if enabled in settings)
   - Or press `Ctrl+Shift+G` to toggle it

3. **Scan Chats**
   - Click the **Scan** button to load all your chats
   - The extension will scroll the sidebar to load all conversations

4. **Select Chats to Delete**
   - Use the filter tags to view specific chat types
   - Click on chats to select/deselect them
   - Use **Select All** to select all deletable chats

5. **Delete Chats**
   - Click the **Delete** button
   - Confirm the deletion in the dialog
   - Watch the progress as chats are deleted

6. **Auto Delete**
   - Click the **Auto Delete** button in the popup or overlay
   - The extension scans your chats, selects every conversation your filters allow to delete, and shows a confirmation
   - Confirm once to delete them all automatically
   - Turn off "Confirm before auto-delete" in Settings to skip the confirmation

### Settings

Access settings by clicking the **Settings** tab in the popup:

- **Keep pinned chats**: Preserve all pinned conversations
- **Keep project chats**: Preserve project-based conversations
- **Keep recent chats (days)**: Keep chats newer than X days
- **Deletion delay (ms)**: Time between deletions (default: 1500ms)
- **Show overlay on ChatGPT**: Auto-show the overlay panel
- **Confirm before auto-delete**: Show confirmation dialog before auto-delete runs
- **Keep keywords**: Comma-separated keywords to preserve
- **Delete keywords**: Comma-separated keywords to force deletion

## Development

### Tech Stack

- **Vite** - Build tool
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Chrome Extension Manifest V3**

### Project Structure

```
chatgpt-cleaner/
├── src/
│   ├── popup/          # Extension popup UI
│   ├── content/        # Injected into ChatGPT
│   ├── background/     # Service worker
│   └── shared/         # Shared types and utilities
├── manifest.json       # Chrome extension manifest
├── vite.config.ts      # Vite configuration
└── package.json
```

### Commands

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run lint` - Run linter

### How It Works

1. **Content Script** (`src/content/`)
   - Injected into ChatGPT pages
   - Scans the sidebar to extract chat metadata
   - Simulates UI clicks to delete conversations
   - Injects the overlay panel

2. **Popup** (`src/popup/`)
   - Provides quick actions and settings
   - Communicates with content script via Chrome messaging

3. **Background** (`src/background/`)
   - Service worker for extension lifecycle
   - Handles settings persistence

### ChatGPT Selectors

The extension uses multiple fallback selectors to handle ChatGPT's frequently changing DOM:

- Sidebar navigation
- Chat items in the list
- Pin indicators
- Project indicators
- Delete buttons and confirmation dialogs

## Important Notes

- **Deletion is permanent**: ChatGPT doesn't have an undo for deleted conversations
- **Rate limiting**: The extension adds delays between deletions to avoid being flagged
- **DOM changes**: ChatGPT updates its UI frequently, which may break selectors
- **Backup first**: Consider exporting important conversations before bulk deletion

## Privacy

- No data is sent to external servers
- All operations happen locally in your browser
- The extension only accesses ChatGPT pages
- Settings are stored in Chrome's sync storage

## License

MIT
