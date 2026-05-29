#!/usr/bin/env bash
set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${CYAN}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║         ⚡  OpsGate — Setup              ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${NC}"

# ── Check Node.js ────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo -e "${RED}✗  Node.js is not installed. Install it from https://nodejs.org (v18+)${NC}"
  exit 1
fi

NODE_VERSION=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [ "$NODE_VERSION" -lt 18 ]; then
  echo -e "${RED}✗  Node.js v18+ is required (you have v${NODE_VERSION})${NC}"
  exit 1
fi

echo -e "${GREEN}✓  Node.js $(node -v) found${NC}"

# ── Install dependencies (npm ci = exact lockfile, no drift) ─────────────────
echo -e "\n${CYAN}→  Installing dependencies (locked versions)...${NC}"
cd "$INSTALL_DIR"

# Use npm ci if package-lock.json exists — guarantees exact versions from lockfile.
# Falls back to npm install only if lockfile is missing (first-time clone).
if [ -f "package-lock.json" ]; then
  npm ci --omit=dev --silent
else
  echo -e "${YELLOW}  Warning: package-lock.json not found. Using npm install (less safe).${NC}"
  npm install --omit=dev --silent
fi

echo -e "${GREEN}✓  Dependencies installed${NC}"

# ── Security audit ────────────────────────────────────────────────────────────
echo -e "\n${CYAN}→  Running security audit...${NC}"
if npm audit --audit-level=moderate 2>&1 | grep -q "found 0 vulnerabilities"; then
  echo -e "${GREEN}✓  No vulnerabilities found${NC}"
else
  npm audit --audit-level=moderate || true
  echo -e "${YELLOW}  Warning: vulnerabilities found above. Run: npm audit fix${NC}"
  read -r -p "  Continue anyway? [y/N] " CONT
  if [[ ! "$CONT" =~ ^[Yy]$ ]]; then
    echo -e "${RED}  Aborted.${NC}"
    exit 1
  fi
fi

# ── Make entry point executable ───────────────────────────────────────────────
# Build TypeScript if dist/ is missing or outdated
if [ ! -f "$INSTALL_DIR/dist/index.js" ]; then
  echo -e "\n${CYAN}→  Building TypeScript...${NC}"
  npm run build
  echo -e "${GREEN}✓  Build complete${NC}"
fi

chmod +x "$INSTALL_DIR/dist/index.js"

# ── Try npm link first (cleanest) ─────────────────────────────────────────────
echo -e "\n${CYAN}→  Linking opsgate command...${NC}"

if npm link 2>/dev/null; then
  echo -e "${GREEN}✓  Installed globally via npm link${NC}"
  echo -e "${GREEN}✓  Run: ${YELLOW}opsgate${NC}"
  exit 0
fi

# ── Fallback: add alias to shell rc ───────────────────────────────────────────
echo -e "${YELLOW}  npm link failed (may need sudo). Adding shell alias instead...${NC}"

ALIAS_LINE="alias opsgate='node ${INSTALL_DIR}/src/index.js'"

add_alias() {
  local RC_FILE="$1"
  if [ -f "$RC_FILE" ]; then
    if grep -q "alias opsgate=" "$RC_FILE"; then
      # Update existing alias
      sed -i "s|alias opsgate=.*|${ALIAS_LINE}|" "$RC_FILE"
      echo -e "${GREEN}✓  Updated alias in ${RC_FILE}${NC}"
    else
      echo "" >> "$RC_FILE"
      echo "# OpsGate SSH Manager" >> "$RC_FILE"
      echo "$ALIAS_LINE" >> "$RC_FILE"
      echo -e "${GREEN}✓  Added alias to ${RC_FILE}${NC}"
    fi
    return 0
  fi
  return 1
}

ADDED=0

# Detect shell and add to the right rc file
if [ -n "$ZSH_VERSION" ] || [ "$SHELL" = "$(which zsh 2>/dev/null)" ]; then
  add_alias "$HOME/.zshrc" && ADDED=1
fi

if [ "$ADDED" -eq 0 ]; then
  add_alias "$HOME/.bashrc" && ADDED=1
fi

if [ "$ADDED" -eq 0 ]; then
  add_alias "$HOME/.bash_profile" && ADDED=1
fi

if [ "$ADDED" -eq 0 ]; then
  echo -e "${YELLOW}  Could not detect shell config. Add this line manually:${NC}"
  echo -e "  ${ALIAS_LINE}"
  exit 1
fi

echo ""
echo -e "${CYAN}  Reload your shell to use the alias:${NC}"
echo -e "  ${YELLOW}source ~/.bashrc${NC}   or   ${YELLOW}source ~/.zshrc${NC}"
echo ""
echo -e "${GREEN}  Then run: ${YELLOW}opsgate${NC}"
