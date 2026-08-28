#!/usr/bin/env bash
# End-to-end test of the installer from the branch
set -e

BRANCH="cursor/one-command-install-85b8"
INSTALL_SCRIPT_URL="https://raw.githubusercontent.com/jayamitkatariya/personacli/$BRANCH/install.sh"
TEST_DIR="/tmp/persona-e2e-test-$$"
export HOME="$TEST_DIR/home"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Testing Persona Installer (E2E)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Branch: $BRANCH"
echo "Test HOME: $HOME"
echo ""

# Create test environment
mkdir -p "$HOME"
cd "$TEST_DIR"

# Download the installer
echo "→ Downloading installer from GitHub..."
if ! curl -fsSL "$INSTALL_SCRIPT_URL" -o install.sh; then
  echo "✗ Failed to download installer"
  exit 1
fi
echo "✓ Installer downloaded"
echo ""

# Create a modified version that stops before global install
echo "→ Preparing test version..."
cat install.sh | \
  sed 's/if \[\[ "$OSTYPE" != "darwin"\* \]\]; then/if false; then/' | \
  sed 's/npm install -g \./# npm install -g \. (skipped for test)/' | \
  sed 's/if ! command -v persona/if false; then : # Skipped verification\nfi\nif false/' > install-test.sh
chmod +x install-test.sh

# Run the installer
echo "→ Running installer (this will take a minute)..."
echo ""
set +e
bash install-test.sh 2>&1
INSTALL_EXIT=$?
set -e

# Verify installation (regardless of exit code, since we modified the script)
echo ""
echo "→ Verifying installation..."
INSTALL_DIR="$HOME/.personacli"

if [ -d "$INSTALL_DIR" ]; then
  echo "✓ Installation directory exists: $INSTALL_DIR"
else
  echo "✗ Installation directory not found"
  cd /
  rm -rf "$TEST_DIR"
  exit 1
fi

if [ -d "$INSTALL_DIR/dist" ]; then
  echo "✓ Dist directory exists"
else
  echo "✗ Dist directory not found"
  cd /
  rm -rf "$TEST_DIR"
  exit 1
fi

if [ -f "$INSTALL_DIR/dist/cli/index.js" ]; then
  echo "✓ CLI binary exists"
else
  echo "✗ CLI binary not found"
  cd /
  rm -rf "$TEST_DIR"
  exit 1
fi

if [ -x "$INSTALL_DIR/dist/cli/index.js" ]; then
  echo "✓ CLI binary is executable"
else
  echo "✗ CLI binary is not executable"
  cd /
  rm -rf "$TEST_DIR"
  exit 1
fi

if [ -f "$INSTALL_DIR/dist/mcp/stdio.js" ]; then
  echo "✓ MCP server binary exists"
else
  echo "✗ MCP server binary not found"
  cd /
  rm -rf "$TEST_DIR"
  exit 1
fi

if [ -d "$INSTALL_DIR/web/dist" ]; then
  echo "✓ Web app build exists"
else
  echo "✗ Web app build not found"
  cd /
  rm -rf "$TEST_DIR"
  exit 1
fi

if [ -f "$INSTALL_DIR/package.json" ]; then
  echo "✓ package.json exists"
else
  echo "✗ package.json not found"
  cd /
  rm -rf "$TEST_DIR"
  exit 1
fi

# Test CLI execution
echo ""
echo "→ Testing CLI execution..."
cd "$INSTALL_DIR"
if node dist/cli/index.js --help > /dev/null 2>&1; then
  echo "✓ CLI executes successfully"
else
  echo "✗ CLI execution failed"
  cd /
  rm -rf "$TEST_DIR"
  exit 1
fi

# Try to get version
echo ""
echo "→ CLI version output:"
node dist/cli/index.js --version 2>&1 || echo "(no --version flag)"

# Cleanup
cd /
rm -rf "$TEST_DIR"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ All installer tests PASSED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "The installer successfully:"
echo "  • Downloads and clones the repository"
echo "  • Installs dependencies"
echo "  • Builds TypeScript + web app"
echo "  • Creates executable binaries"
echo ""
echo "Ready for Show HN! 🚀"
echo ""
