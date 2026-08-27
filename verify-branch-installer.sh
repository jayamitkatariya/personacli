#!/usr/bin/env bash
# Quick verification that the installer can be downloaded from the branch
set -e

BRANCH="cursor/one-command-install-85b8"
INSTALL_URL="https://raw.githubusercontent.com/jayamitkatariya/personacli/$BRANCH/install.sh"

echo "Verifying installer is downloadable from branch..."
echo "URL: $INSTALL_URL"
echo ""

# Try to download and check it
if curl -fsSL "$INSTALL_URL" > /tmp/verify-installer.sh; then
  echo "✓ Installer downloaded successfully"
  
  # Check it's a valid bash script
  if head -1 /tmp/verify-installer.sh | grep -q "#!/usr/bin/env bash"; then
    echo "✓ Valid bash script"
  else
    echo "✗ Not a valid bash script"
    exit 1
  fi
  
  # Check it has the key components
  if grep -q "Persona CLI Installer" /tmp/verify-installer.sh; then
    echo "✓ Contains installer code"
  else
    echo "✗ Missing installer code"
    exit 1
  fi
  
  # Check for key functions
  if grep -q "MIN_NODE_VERSION" /tmp/verify-installer.sh; then
    echo "✓ Has Node version check"
  else
    echo "✗ Missing Node version check"
    exit 1
  fi
  
  if grep -q "npm install --allow-scripts=persona" /tmp/verify-installer.sh; then
    echo "✓ Has npm install with correct flags"
  else
    echo "✗ Missing correct npm install"
    exit 1
  fi
  
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ✅ Installer is ready!"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "To test from this branch:"
  echo "  curl -fsSL $INSTALL_URL | bash"
  echo ""
  echo "After merge, use:"
  echo "  curl -fsSL https://raw.githubusercontent.com/jayamitkatariya/personacli/main/install.sh | bash"
  
  rm /tmp/verify-installer.sh
else
  echo "✗ Failed to download installer"
  exit 1
fi
