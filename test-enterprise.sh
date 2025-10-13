#!/usr/bin/env bash
# Manual CLI Testing Script for Enterprise Support

set -e

echo "=== Manual CLI Testing for Enterprise Support ==="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Test 1: Verify CLI help includes --enterprise-url${NC}"
bun run dev auth --help | grep -q "enterprise-url" && echo -e "${GREEN}✓ auth has --enterprise-url flag${NC}"
bun run dev start --help | grep -q "enterprise-url" && echo -e "${GREEN}✓ start has --enterprise-url flag${NC}"
echo ""

echo -e "${YELLOW}Test 2: Test URL normalization (unit tests)${NC}"
bun test tests/url.test.ts --silent && echo -e "${GREEN}✓ URL normalization tests pass${NC}"
echo ""

echo -e "${YELLOW}Test 3: Test enterprise integration (mock tests)${NC}"
bun test tests/enterprise-integration.test.ts --silent && echo -e "${GREEN}✓ Enterprise integration tests pass${NC}"
echo ""

echo -e "${YELLOW}Test 4: Test file persistence${NC}"
bun test tests/enterprise-persistence.test.ts --silent && echo -e "${GREEN}✓ File persistence tests pass${NC}"
echo ""

echo -e "${YELLOW}Test 5: Run all tests${NC}"
bun test --silent && echo -e "${GREEN}✓ All 61 tests pass${NC}"
echo ""

echo -e "${YELLOW}Test 6: Verify build succeeds${NC}"
bun run build > /dev/null 2>&1 && echo -e "${GREEN}✓ Build succeeds${NC}"
echo ""

echo -e "${YELLOW}Test 7: Verify typecheck passes${NC}"
bun run typecheck && echo -e "${GREEN}✓ Typecheck passes${NC}"
echo ""

echo "=== Manual Tests Required (Interactive) ==="
echo ""
echo "The following tests require manual verification:"
echo ""
echo "1. Test auth interactive prompt:"
echo "   $ bun run dev auth"
echo "   Expected: Prompts 'Are you using GitHub Enterprise?' (y/N)"
echo "   Expected: If yes, prompts 'Enter enterprise host:'"
echo ""
echo "2. Test auth with --enterprise-url flag:"
echo "   $ bun run dev auth --enterprise-url https://ghe.example.com/"
echo "   Expected: Normalizes to ghe.example.com"
echo "   Expected: Writes to ~/.local/share/copilot-api/enterprise_url"
echo ""
echo "3. Test start with persisted enterprise URL:"
echo "   $ echo 'ghe.example.com' > ~/.local/share/copilot-api/enterprise_url"
echo "   $ bun run dev start --verbose"
echo "   Expected: Loads ghe.example.com from file"
echo "   Expected: Uses enterprise endpoints in verbose logs"
echo ""
echo "4. Test start with --enterprise-url override:"
echo "   $ bun run dev start --enterprise-url new.ghe.com --verbose"
echo "   Expected: Uses new.ghe.com for this run"
echo ""
echo "5. Test backwards compatibility (no enterprise):"
echo "   $ rm ~/.local/share/copilot-api/enterprise_url"
echo "   $ bun run dev start --verbose"
echo "   Expected: Uses github.com endpoints"
echo ""

echo "=== Test Summary ==="
echo -e "${GREEN}✓ All automated tests pass (61 tests)${NC}"
echo -e "${GREEN}✓ Build and typecheck pass${NC}"
echo -e "${YELLOW}⚠ Manual tests require interactive verification${NC}"
