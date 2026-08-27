#!/usr/bin/env bash
# Test script for the installer - does NOT do global install
set -e

TEST_DIR="/tmp/persona-install-test-$$"
REPO_URL="https://github.com/jayamitkatariya/personacli.git"

echo "Testing Persona installer..."
echo "Test directory: $TEST_DIR"
echo ""

# Create test directory
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

# Test 1: Clone repository
echo "Test 1: Cloning repository..."
if git clone --depth 1 "$REPO_URL" persona-test; then
  echo "✓ Clone successful"
else
  echo "✗ Clone failed"
  exit 1
fi

cd persona-test

# Test 2: Check package.json exists and has correct structure
echo ""
echo "Test 2: Checking package.json..."
if [ -f "package.json" ]; then
  echo "✓ package.json exists"
  
  # Check for bin entry
  if grep -q '"persona":' package.json; then
    echo "✓ persona binary defined"
  else
    echo "✗ persona binary not found in package.json"
    exit 1
  fi
  
  # Check for prepare script
  if grep -q '"prepare":' package.json; then
    echo "✓ prepare script exists"
  else
    echo "✗ prepare script not found"
    exit 1
  fi
else
  echo "✗ package.json not found"
  exit 1
fi

# Test 3: Run npm install (this will trigger the prepare script)
echo ""
echo "Test 3: Running npm install..."
if npm install --allow-scripts=persona --loglevel=error; then
  echo "✓ npm install successful"
else
  echo "✗ npm install failed"
  exit 1
fi

# Test 4: Check if build artifacts exist
echo ""
echo "Test 4: Checking build artifacts..."
if [ -d "dist" ]; then
  echo "✓ dist directory exists"
else
  echo "✗ dist directory not found"
  exit 1
fi

if [ -f "dist/cli/index.js" ]; then
  echo "✓ CLI entry point exists"
else
  echo "✗ CLI entry point not found"
  exit 1
fi

# Test 5: Verify the CLI can be executed
echo ""
echo "Test 5: Testing CLI execution..."
if node dist/cli/index.js --version; then
  echo "✓ CLI executes successfully"
else
  echo "✗ CLI execution failed"
  exit 1
fi

# Cleanup
echo ""
echo "Cleaning up..."
cd /
rm -rf "$TEST_DIR"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✓ All tests passed!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
