import { build } from 'vite'
import { resolve } from 'path'

async function buildContentScript() {
  await build({
    configFile: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: resolve(__dirname, 'src/content/index.ts'),
        formats: ['iife'],
        name: 'ChatGPTCleaner',
      },
      rollupOptions: {
        output: {
          entryFileNames: 'content.js',
        },
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
  })
  console.log('✓ Content script built')
}

async function buildBackgroundScript() {
  await build({
    configFile: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: resolve(__dirname, 'src/background/index.ts'),
        formats: ['iife'],
        name: 'ChatGPTCleanerBackground',
      },
      rollupOptions: {
        output: {
          entryFileNames: 'background.js',
        },
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
  })
  console.log('✓ Background script built')
}

async function main() {
  await Promise.all([buildContentScript(), buildBackgroundScript()])
  console.log('✓ All scripts built')
}

main().catch(console.error)
