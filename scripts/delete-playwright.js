#!/usr/bin/env node

/**
 * ChatGPT Cleaner — Playwright Fallback
 *
 * Connects to your running Chrome browser via CDP (Chrome DevTools Protocol)
 * and deletes chats by clicking through the UI. Bypasses API rate limits
 * because it interacts with the DOM directly like a human.
 *
 * PREREQUISITES:
 *   1. Close all Chrome windows
 *   2. Relaunch Chrome with remote debugging:
 *
 *      macOS:
 *        /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
 *
 *      Windows:
 *        "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
 *
 *      Linux:
 *        google-chrome --remote-debugging-port=9222
 *
 *   3. Log into ChatGPT in that Chrome window
 *   4. Run this script:  node scripts/delete-playwright.js
 *
 * OPTIONS:
 *   --port=9222          Chrome debugging port (default: 9222)
 *   --delay=3000         Delay between deletions in ms (default: 3000)
 *   --batch-size=20      Chats per batch before cooldown (default: 20)
 *   --batch-cooldown=60  Cooldown between batches in seconds (default: 60)
 *   --dry-run            Show what would be deleted without deleting
 *   --keep-pinned        Skip pinned chats (default: true)
 *   --keep-recent=7      Skip chats newer than N days (default: 7)
 *   --max=0              Max deletions, 0=unlimited (default: 0)
 */

import { chromium } from 'playwright';

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.split('=')[1] : fallback;
}
function hasFlag(name) {
  return args.includes(`--${name}`);
}

const CDP_PORT = getArg('port', '9222');
const DELAY_MS = parseInt(getArg('delay', '3000'), 10);
const BATCH_SIZE = parseInt(getArg('batch-size', '20'), 10);
const BATCH_COOLDOWN_S = parseInt(getArg('batch-cooldown', '60'), 10);
const DRY_RUN = hasFlag('dry-run');
const KEEP_PINNED = !hasFlag('no-keep-pinned');
const KEEP_RECENT_DAYS = parseInt(getArg('keep-recent', '7'), 10);
const MAX_DELETIONS = parseInt(getArg('max', '0'), 10);

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(baseMs) {
  const v = baseMs * 0.25;
  return baseMs + (Math.random() * v * 2 - v);
}

// ── Scroll sidebar to load all chats ─────────────────────────────────────────

async function scrollSidebar(page) {
  log('Scrolling sidebar to load all chats...');

  let prevCount = 0;
  let stableRounds = 0;

  while (stableRounds < 6) {
    const count = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/c/"], a[href*="/g/"]');
      return links.length;
    });

    if (count === prevCount) {
      stableRounds++;
    } else {
      stableRounds = 0;
      prevCount = count;
    }

    await page.evaluate(() => {
      const sidebar =
        document.querySelector('nav[aria-label="Chat history"]') ||
        document.querySelector('nav[role="navigation"]') ||
        document.querySelector('#history') ||
        document.querySelector('aside nav');
      if (!sidebar) return;
      const allEls = sidebar.querySelectorAll('*');
      for (const el of allEls) {
        const style = window.getComputedStyle(el);
        if (
          (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight
        ) {
          el.scrollTop = el.scrollHeight;
          return;
        }
      }
      sidebar.scrollTop = sidebar.scrollHeight;
    });

    await sleep(400);
  }

  // Scroll back to top
  await page.evaluate(() => {
    const sidebar =
      document.querySelector('nav[aria-label="Chat history"]') ||
      document.querySelector('nav[role="navigation"]');
    if (sidebar) sidebar.scrollTop = 0;
  });

  await sleep(300);

  const finalCount = await page.evaluate(() => {
    const links = document.querySelectorAll('a[href*="/c/"], a[href*="/g/"]');
    return links.length;
  });
  log(`Loaded ${finalCount} chats`);
}

// ── Get chat list from sidebar ───────────────────────────────────────────────

async function getChatList(page) {
  return page.evaluate(() => {
    const chats = [];
    const links = document.querySelectorAll('a[href*="/c/"], a[href*="/g/"]');

    links.forEach((link, i) => {
      const href = link.href || link.getAttribute('href') || '';
      if (!href.includes('/c/') && !href.includes('/g/')) return;

      const titleEl = link.querySelector('span[class*="truncate"], div[class*="title"], span');
      const title = titleEl?.textContent?.trim() || link.textContent?.trim() || 'Untitled';

      const isPinned = !!(
        link.querySelector('[data-testid="pin-icon"]') ||
        link.querySelector('[class*="pinned"]') ||
        link.querySelector('[aria-label*="Pinned"]') ||
        link.closest('[class*="pinned"]')
      );

      chats.push({ index: i, title, href, isPinned });
    });

    return chats;
  });
}

// ── Delete a single chat via DOM clicks ──────────────────────────────────────

async function deleteChatViaDOM(page, chatIndex) {
  try {
    const chatLinks = await page.$$('a[href*="/c/"], a[href*="/g/"]');
    if (chatIndex >= chatLinks.length) {
      return { success: false, error: 'Index out of range' };
    }

    const chatLink = chatLinks[chatIndex];
    const title = await chatLink.textContent();
    log(`  Deleting: "${title?.trim()}"`);

    // Hover over the chat item to reveal the menu button
    const parentRow = await chatLink.evaluateHandle((el) => {
      return el.closest('div, li') || el;
    });
    await parentRow.asElement()?.hover();
    await sleep(500);

    // Find the "More" button (three dots)
    const moreButton = await parentRow.asElement()?.$(
      'button[aria-label="More"], button[aria-label="Options"], button[aria-label="More options"], button[aria-label="Chat menu"], button[aria-label="Sidebar button"], button[aria-label="Open menu"]'
    );

    if (!moreButton) {
      // Fallback: find any icon-only button in the row
      const buttons = await parentRow.asElement()?.$$('button');
      if (!buttons || buttons.length === 0) {
        return { success: false, error: 'No buttons found in chat row' };
      }

      let clicked = false;
      for (let i = buttons.length - 1; i >= 0; i--) {
        const btn = buttons[i];
        const hasSvg = await btn.$('svg');
        const text = (await btn.textContent()) || '';
        const ariaLabel = (await btn.getAttribute('aria-label')) || '';

        if (hasSvg && text.trim() === '' && !ariaLabel.toLowerCase().includes('pin')) {
          await btn.click();
          clicked = true;
          break;
        }
      }

      if (!clicked) {
        return { success: false, error: 'Could not find more-options button' };
      }
    } else {
      await moreButton.click();
    }

    await sleep(1200);

    // Find the "Delete" option in the dropdown menu
    const deleteOption = await page.$(
      '[role="menuitem"]:has-text("Delete"), [data-testid="menu-item-delete"], button:has-text("Delete chat"), button:has-text("Delete conversation"), button:has-text("Move to trash")'
    );

    if (!deleteOption) {
      const menuItems = await page.$$('[role="menuitem"], [role="option"], li, button');
      let foundDelete = false;
      for (const item of menuItems) {
        const text = ((await item.textContent()) || '').trim().toLowerCase();
        if (text.includes('delete') && !text.includes('delete all') && text.length < 40) {
          await item.click();
          foundDelete = true;
          break;
        }
      }

      if (!foundDelete) {
        await page.keyboard.press('Escape');
        return { success: false, error: 'Delete option not found in menu' };
      }
    } else {
      await deleteOption.click();
    }

    await sleep(jitter(3000));

    // Find and click the confirm button in the dialog
    const confirmButton = await page.$(
      '[role="dialog"] button:has-text("Delete"), [role="alertdialog"] button:has-text("Delete"), button[data-variant="danger"]:has-text("Delete"), button:has-text("Confirm"), button:has-text("Yes")'
    );

    if (!confirmButton) {
      const dialog = await page.$('[role="dialog"], [role="alertdialog"]');
      if (dialog) {
        const dialogButtons = await dialog.$$('button');
        for (const btn of dialogButtons) {
          const text = ((await btn.textContent()) || '').trim().toLowerCase();
          if (
            text.includes('delete') ||
            text.includes('confirm') ||
            text.includes('yes') ||
            text.includes('ok')
          ) {
            await btn.click();
            await sleep(DELAY_MS);
            return { success: true };
          }
        }
      }

      await page.keyboard.press('Escape');
      return { success: false, error: 'Confirm button not found' };
    }

    await confirmButton.click();
    await sleep(DELAY_MS);

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('=== ChatGPT Cleaner — Playwright Fallback ===');
  console.log('');

  if (DRY_RUN) {
    log('DRY RUN MODE — no chats will be deleted');
    console.log('');
  }

  log(`Connecting to Chrome on port ${CDP_PORT}...`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
  } catch (err) {
    console.error('');
    console.error('ERROR: Could not connect to Chrome.');
    console.error('');
    console.error('Make sure Chrome is running with remote debugging enabled:');
    console.error('');
    console.error('  1. Close all Chrome windows');
    console.error('  2. Relaunch Chrome:');
    console.error('');
    console.error('     macOS:');
    console.error('       /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222');
    console.error('');
    console.error('     Windows:');
    console.error('       "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222');
    console.error('');
    console.error('     Linux:');
    console.error('       google-chrome --remote-debugging-port=9222');
    console.error('');
    console.error('  3. Log into ChatGPT');
    console.error('  4. Run this script again');
    console.error('');
    process.exit(1);
  }

  log('Connected to Chrome');

  // Find the ChatGPT tab
  const contexts = browser.contexts();
  let chatgptPage = null;

  for (const ctx of contexts) {
    for (const page of ctx.pages()) {
      if (page.url().includes('chatgpt.com')) {
        chatgptPage = page;
        break;
      }
    }
    if (chatgptPage) break;
  }

  if (!chatgptPage) {
    console.error('ERROR: No ChatGPT tab found. Open https://chatgpt.com in Chrome first.');
    process.exit(1);
  }

  log(`Found ChatGPT tab: ${chatgptPage.url()}`);
  await chatgptPage.bringToFront();
  await sleep(1000);

  // Step 1: Scroll to load all chats
  await scrollSidebar(chatgptPage);

  // Step 2: Get list of chats
  const allChats = await getChatList(chatgptPage);
  log(`Found ${allChats.length} chats in sidebar`);

  if (allChats.length === 0) {
    log('No chats found. Make sure you are logged in and the sidebar is visible.');
    process.exit(0);
  }

  // Step 3: Filter chats
  let toDelete = allChats;

  if (KEEP_PINNED) {
    const pinned = toDelete.filter((c) => c.isPinned);
    toDelete = toDelete.filter((c) => !c.isPinned);
    log(`Skipping ${pinned.length} pinned chats`);
  }

  if (KEEP_RECENT_DAYS > 0) {
    log('Note: Date filtering not available in Playwright mode. Use the extension for date-based filtering.');
  }

  if (MAX_DELETIONS > 0 && toDelete.length > MAX_DELETIONS) {
    toDelete = toDelete.slice(0, MAX_DELETIONS);
    log(`Capped at ${MAX_DELETIONS} deletions`);
  }

  log(`Will delete ${toDelete.length} chats`);

  if (DRY_RUN) {
    toDelete.forEach((c, i) => {
      console.log(`  ${i + 1}. ${c.title} ${c.isPinned ? '(pinned)' : ''}`);
    });
    log('Dry run complete. No chats were deleted.');
    process.exit(0);
  }

  // Step 4: Delete chats in batches
  let deleted = 0;
  let failed = 0;
  const totalBatches = Math.ceil(toDelete.length / BATCH_SIZE);

  for (let batch = 0; batch < totalBatches; batch++) {
    const batchStart = batch * BATCH_SIZE;
    const batchEnd = Math.min(batchStart + BATCH_SIZE, toDelete.length);
    const batchChats = toDelete.slice(batchStart, batchEnd);

    log('');
    log(`--- Batch ${batch + 1}/${totalBatches} (${batchChats.length} chats) ---`);

    for (let i = 0; i < batchChats.length; i++) {
      const chat = batchChats[i];

      // Re-find the chat by href after each deletion (sidebar re-renders)
      const currentChats = await getChatList(chatgptPage);
      const targetIdx = currentChats.findIndex((c) => c.href === chat.href);

      if (targetIdx === -1) {
        log(`  [${deleted + failed + 1}/${toDelete.length}] SKIP: "${chat.title}" (no longer in sidebar)`);
        failed++;
        continue;
      }

      const result = await deleteChatViaDOM(chatgptPage, targetIdx);

      if (result.success) {
        deleted++;
        log(`  [${deleted + failed}/${toDelete.length}] OK: "${chat.title}"`);
      } else {
        failed++;
        log(`  [${deleted + failed}/${toDelete.length}] FAIL: "${chat.title}" — ${result.error}`);
      }

      if (i < batchChats.length - 1) {
        const delay = jitter(DELAY_MS);
        await sleep(delay);
      }
    }

    // Cooldown between batches
    if (batch < totalBatches - 1) {
      const cooldown = jitter(BATCH_COOLDOWN_S * 1000);
      log(`Cooling down ${Math.round(cooldown / 1000)}s before next batch...`);
      await sleep(cooldown);

      // Re-scroll to load any new chats that appeared after deletions
      await scrollSidebar(chatgptPage);
    }
  }

  // Summary
  log('');
  log('=== DONE ===');
  log(`Deleted: ${deleted}`);
  log(`Failed:  ${failed}`);
  log(`Total:   ${toDelete.length}`);
  console.log('');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
