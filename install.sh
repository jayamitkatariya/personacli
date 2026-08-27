#!/usr/bin/env bash
set -e

# Persona CLI installer for macOS
# Usage: curl -fsSL https://raw.githubusercontent.com/jayamitkatariya/personacli/main/install.sh | bash

REPO_URL="https://github.com/jayamitkatariya/personacli.git"
INSTALL_DIR="$HOME/.personacli"
MIN_NODE_VERSION=20

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Persona CLI Installer"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
  echo -e "${RED}Error: This installer is for macOS only.${NC}"
  echo "Please see https://github.com/jayamitkatariya/personacli for other platforms."
  exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
  echo -e "${RED}Error: Node.js is not installed.${NC}"
  echo ""
  echo "Install Node.js with Homebrew:"
  echo "  brew install node"
  echo ""
  echo "Or download from https://nodejs.org"
  exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt "$MIN_NODE_VERSION" ]; then
  echo -e "${RED}Error: Node.js $MIN_NODE_VERSION or higher is required.${NC}"
  echo "Current version: $(node -v)"
  echo ""
  echo "Update Node.js:"
  echo "  brew upgrade node"
  exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
  echo -e "${RED}Error: npm is not installed.${NC}"
  exit 1
fi

echo -e "${GREEN}✓${NC} Node.js $(node -v) detected"
echo -e "${GREEN}✓${NC} npm $(npm -v) detected"
echo ""

# Check if persona is already installed
if command -v persona &> /dev/null; then
  echo -e "${YELLOW}⚠${NC}  persona command already exists at: $(which persona)"
  echo ""
  
  # Check if stdin is a TTY (interactive) or a pipe (curl|bash)
  if [ -t 0 ]; then
    # Interactive: prompt user, read from /dev/tty
    read -p "Update existing installation? (y/n) " -n 1 -r < /dev/tty
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Installation cancelled."
      exit 0
    fi
  else
    # Non-interactive (curl|bash): auto-update
    echo "Updating existing installation..."
  fi
  echo ""
fi

# Remove existing directory if it exists
if [ -d "$INSTALL_DIR" ]; then
  echo "Removing existing installation at $INSTALL_DIR..."
  rm -rf "$INSTALL_DIR"
fi

# Clone the repository
echo "Cloning Persona CLI..."
if ! git clone --depth 1 "$REPO_URL" "$INSTALL_DIR" 2>&1; then
  echo -e "${RED}Error: Failed to clone repository.${NC}"
  echo "Please check your internet connection and try again."
  exit 1
fi

cd "$INSTALL_DIR"

echo ""
echo "Installing dependencies..."
# Run npm install with --allow-scripts flag (required for npm 11.16+)
if ! npm install --allow-scripts=persona --loglevel=error 2>&1; then
  echo -e "${RED}Error: npm install failed.${NC}"
  echo "Check the error messages above and try again."
  exit 1
fi

echo ""
echo "Installing persona command globally..."
# Install globally
if ! npm install -g . --allow-scripts=persona --loglevel=error 2>&1; then
  echo -e "${RED}Error: Global install failed.${NC}"
  echo ""
  echo "This usually happens if npm's prefix isn't writable."
  echo "Try installing Node.js via Homebrew:"
  echo "  brew install node"
  echo ""
  echo "Or use nvm: https://github.com/nvm-sh/nvm"
  exit 1
fi

echo ""

# Verify installation
if ! command -v persona &> /dev/null; then
  echo -e "${RED}Error: persona command not found after installation.${NC}"
  echo ""
  echo "The installation completed but 'persona' isn't on your PATH."
  echo "Check that your npm prefix is on PATH:"
  echo "  echo \$PATH"
  echo "  npm config get prefix"
  echo ""
  echo "You may need to add npm's bin directory to your PATH."
  echo "For example, add this to your ~/.zshrc or ~/.bash_profile:"
  echo "  export PATH=\"\$(npm config get prefix)/bin:\$PATH\""
  exit 1
fi

echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ✓ Persona CLI installed successfully!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Start Persona:"
echo -e "  ${GREEN}persona${NC}"
echo ""
echo "Or try:"
echo "  persona doctor   # health check"
echo "  persona --help   # see all commands"
echo ""
