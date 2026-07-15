# 🧹 ChatGPT Cleaner

**Bulk delete ChatGPT conversations instantly. Keep what matters, nuke the rest.**

Tired of hundreds of old chats cluttering your ChatGPT sidebar? ChatGPT Cleaner lets you select and delete conversations in bulk — with smart protection for your pinned chats, project conversations, and recent work.

**🔗 [Download Now](https://chatgpt-cleaner.vercel.app)** — Free, no sign-up required

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **Bulk Delete** | Select multiple chats and delete them all at once |
| **Auto Delete** | One-click scan + delete everything that matches your filters |
| **Smart Protection** | Automatically skips pinned chats, project chats, and recent conversations |
| **Keyword Filtering** | Keep or delete chats based on title keywords (Pro) |
| **Rate-Limit Safe** | Built-in pacing and automatic fallback — won't get you banned |
| **Live Progress** | Real-time progress bar, ETA, and batch timer |
| **Dark Mode** | Looks great in both light and dark themes |

---

## 🚀 Install (30 seconds)

### Option A: Direct Download (Recommended)

1. **Download** the latest release: [chatgpt-cleaner-v1.0.0.zip](https://github.com/theDarkHorse17/chatgpt-cleanr/releases/latest)
2. **Unzip** the file
3. Open Chrome → `chrome://extensions/`
4. Enable **Developer mode** (top right toggle)
5. Click **Load unpacked** → select the `dist` folder
6. Pin the extension to your toolbar

### Option B: Build from Source

```bash
git clone https://github.com/theDarkHorse17/chatgpt-cleanr.git
cd chatgpt-cleanr
npm install
npm run build
```

Then load the `dist` folder as above.

---

## 📖 How to Use

1. Go to [chatgpt.com](https://chatgpt.com)
2. Click the **ChatGPT Cleaner** icon in your toolbar
3. The extension auto-scans your sidebar and shows all chats
4. **Select** the chats you want to delete (or use filters)
5. Click **Delete** — done

### Filters

| Filter | What it does |
|--------|-------------|
| **All** | Shows every chat |
| **Deletable** | Shows only chats that can be deleted |
| **Pinned** | Shows only pinned chats |
| **Project** | Shows only project-based chats |
| **Recent** | Shows chats from the last 7 days |

### Settings

Click the **Settings** tab to configure:

- **Keep pinned chats** — never delete pinned conversations
- **Keep project chats** — preserve project-based work
- **Keep recent chats** — set how many days back to protect
- **Deletion delay** — time between deletions (default: 5s)
- **Keywords** — (Pro) keep or delete by title keywords

---

## 🆓 Free vs Pro

| | Free | Pro |
|---|------|-----|
| Bulk delete | ✅ | ✅ |
| Smart protection | ✅ | ✅ |
| Daily deletes | 10/day | 75/day |
| Auto Delete | ❌ | ✅ |
| Keyword filtering | ❌ | ✅ |
| **Price** | **$0** | **$3.99/mo** |

Get Pro at [chatgptcleaner.com/pricing](https://chatgptcleaner.com/pricing)

---

## 🔒 Privacy

- **No data leaves your browser** — everything runs locally
- **No accounts required** — just install and use
- **Only accesses ChatGPT** — no other websites tracked
- **Settings sync** via Chrome's built-in sync storage

---

## ⚠️ Important Notes

- **Keep the ChatGPT tab open** while deleting — the extension needs the page loaded
- **Deletion is permanent** — ChatGPT has no undo for deleted conversations
- **Back up important chats** before bulk deletion
- **Rate limiting** — the extension auto-paces deletions and falls back to DOM mode if needed

---

## 🛠️ For Developers

```bash
npm install          # Install dependencies
npm run dev          # Start dev server
npm run build        # Build for production
npm run lint         # Run linter
```

### Tech Stack

- **Vite** — Build tool
- **React 19** — UI framework
- **TypeScript** — Type safety
- **Tailwind CSS** — Styling
- **Chrome Extension Manifest V3**

### Project Structure

```
src/
├── popup/          # Extension popup UI (React)
├── content/        # Injected into ChatGPT (DOM manipulation)
├── background/     # Service worker
└── shared/         # Types, utils, license validation
```

---

## 📄 License

MIT

---

<p align="center">
  <a href="https://chatgpt-cleaner.vercel.app">Download</a> &bull;
  <a href="https://github.com/theDarkHorse17/chatgpt-cleanr/releases/latest">GitHub Release</a> &bull;
  <a href="https://github.com/theDarkHorse17/chatgpt-cleanr/issues">Report a Bug</a>
</p>
