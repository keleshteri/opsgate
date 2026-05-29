#!/usr/bin/env bash
# Install SSHive globally on Linux/macOS
set -e

echo "Installing SSHive..."

# Install dependencies
npm install --production

# Make entry point executable
chmod +x src/index.js

# Link globally
npm link

echo ""
echo "✓ SSHive installed! Run: sshive"
