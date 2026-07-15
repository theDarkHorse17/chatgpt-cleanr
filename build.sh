#!/bin/bash

# Clean dist folder
rm -rf dist

# Build popup with Vite
echo "Building popup..."
npx vite build

# Build content script as IIFE
echo "Building content script..."
npx vite build --config vite.content.config.ts

# Build background script as IIFE
echo "Building background script..."
npx vite build --config vite.background.config.ts

# Copy manifest
cp manifest.json dist/

echo "✓ Build complete!"
