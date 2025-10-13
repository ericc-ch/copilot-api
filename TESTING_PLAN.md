# Enterprise Support Testing Plan

## Overview
Comprehensive test plan to validate GitHub Enterprise Server/Cloud support in copilot-api.

## Test Categories

### 1. Unit Tests (Automated)
- [x] URL normalization helpers
- [x] githubBaseUrl with/without enterprise
- [x] githubApiBaseUrl with/without enterprise
- [x] looksLikeHost validation

### 2. Integration Tests (Manual + Automated)

#### 2.1 File System Persistence
**Test**: Enterprise URL persistence
- [ ] Write enterprise URL to file
- [ ] Read enterprise URL from file
- [ ] Verify file permissions (0600)
- [ ] Handle empty/missing file gracefully

**Test**: Token and enterprise URL coordination
- [ ] Token persisted alongside enterprise URL
- [ ] Both files created in APP_DIR
- [ ] Files survive process restart

#### 2.2 OAuth Flow with Enterprise
**Test**: Device code endpoint
- [ ] Mock fetch to verify URL: `https://{enterprise}/login/device/code`
- [ ] Verify client_id and scope in request body
- [ ] Handle response correctly

**Test**: Access token endpoint
- [ ] Mock fetch to verify URL: `https://{enterprise}/login/oauth/access_token`
- [ ] Verify device_code and grant_type in request body
- [ ] Poll correctly with enterprise URL

**Test**: Without enterprise (backwards compatibility)
- [ ] Device code uses `https://github.com/login/device/code`
- [ ] Access token uses `https://github.com/login/oauth/access_token`

#### 2.3 Copilot API with Enterprise
**Test**: Copilot token fetch
- [ ] Mock fetch to verify URL: `https://api.{enterprise}/copilot_internal/v2/token`
- [ ] Verify authorization header with GitHub token
- [ ] Handle token response

**Test**: Copilot usage fetch
- [ ] Mock fetch to verify URL: `https://api.{enterprise}/copilot_internal/user`
- [ ] Verify headers and response handling

**Test**: Get GitHub user
- [ ] Mock fetch to verify URL: `https://api.{enterprise}/user`
- [ ] Verify authorization header

**Test**: Token refresh
- [ ] Verify refresh interval uses enterprise URL
- [ ] State.enterpriseUrl persists across refresh

**Test**: Without enterprise (backwards compatibility)
- [ ] Copilot token uses `https://api.github.com/copilot_internal/v2/token`
- [ ] Usage uses `https://api.github.com/copilot_internal/user`

#### 2.4 CLI Argument Parsing
**Test**: auth command with --enterprise-url
- [ ] Parse flag correctly
- [ ] Pass to setupGitHubToken
- [ ] Persist to file

**Test**: auth command without flag (interactive)
- [ ] Prompt: "Are you using GitHub Enterprise?"
- [ ] If yes, prompt for host
- [ ] Normalize and persist host

**Test**: start command with --enterprise-url
- [ ] Parse flag correctly
- [ ] Override persisted value if present
- [ ] Set state.enterpriseUrl

**Test**: start command without flag
- [ ] Load persisted enterprise URL if present
- [ ] Use github.com if not present

#### 2.5 End-to-End Scenarios

**Scenario 1**: Fresh auth with enterprise (interactive)
```bash
bun run dev auth
# User prompted: "Are you using GitHub Enterprise?" -> y
# User prompted: "Enter host:" -> ghe.example.com
# Expected: Writes ghe.example.com to enterprise_url file
# Expected: Device code flow uses https://ghe.example.com/...
```

**Scenario 2**: Fresh auth with enterprise (CLI flag)
```bash
bun run dev auth --enterprise-url https://ghe.company.com/
# Expected: Normalizes to ghe.company.com
# Expected: Writes to enterprise_url file
# Expected: Device code flow uses https://ghe.company.com/...
```

**Scenario 3**: Start server with persisted enterprise
```bash
# Assume enterprise_url file contains "ghe.example.com"
bun run dev start
# Expected: Loads ghe.example.com from file
# Expected: All API calls use enterprise endpoints
```

**Scenario 4**: Start server with override
```bash
# Assume enterprise_url file contains "old.ghe.com"
bun run dev start --enterprise-url new.ghe.com
# Expected: Uses new.ghe.com for this run
# Expected: Does NOT overwrite persisted file (only auth writes)
```

**Scenario 5**: Backwards compatibility (no enterprise)
```bash
# No enterprise_url file present
bun run dev start
# Expected: All endpoints use github.com/api.github.com
```

**Scenario 6**: URL normalization variations
- Input: `https://ghe.example.com/` -> `ghe.example.com`
- Input: `http://ghe.example.com` -> `ghe.example.com`
- Input: `ghe.example.com` -> `ghe.example.com`
- Input: `ghe.example.com/` -> `ghe.example.com`

### 3. Mock-Based Integration Tests (to add)

Create `tests/enterprise-integration.test.ts`:

```typescript
import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test"
import { setupGitHubToken } from "../src/lib/token"
import { state } from "../src/lib/state"

describe("Enterprise OAuth Flow", () => {
  beforeEach(() => {
    // Reset state
    state.enterpriseUrl = undefined
  })

  it("should use enterprise URL for device code", async () => {
    const fetchMock = mock((url: string) => {
      expect(url).toBe("https://ghe.example.com/login/device/code")
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          device_code: "test",
          user_code: "ABCD-1234",
          verification_uri: "https://ghe.example.com/login/device",
          expires_in: 900,
          interval: 5
        })
      })
    })

    global.fetch = fetchMock as any

    state.enterpriseUrl = "ghe.example.com"
    // Test device code fetch
    // ...
  })
})
```

## Test Execution Plan

### Phase 1: Automated Tests (Current)
- [x] Run existing unit tests: `bun test`
- [x] Verify all 38 tests pass

### Phase 2: Add Mock Integration Tests
- [ ] Create `tests/enterprise-integration.test.ts`
- [ ] Mock fetch for OAuth flows
- [ ] Mock fetch for Copilot API calls
- [ ] Verify correct URLs called
- [ ] Run: `bun test`

### Phase 3: Manual CLI Testing
- [ ] Test auth interactive flow
- [ ] Test auth with --enterprise-url flag
- [ ] Test start with persisted enterprise
- [ ] Test start with override
- [ ] Test backwards compatibility

### Phase 4: Real Enterprise Testing (if available)
- [ ] Test with actual GitHub Enterprise Server instance
- [ ] Complete full auth flow
- [ ] Verify Copilot token fetch
- [ ] Verify Copilot usage fetch
- [ ] Test server startup and API calls

## Test Results Log

### Automated Tests (Phase 1)
```
✅ bun test - 38 tests pass
✅ URL normalization tests pass
✅ Build succeeds
✅ Typecheck passes
```

### Integration Tests (Phase 2)
- Status: Pending

### Manual Tests (Phase 3)
- Status: Pending

### Real Enterprise Tests (Phase 4)
- Status: Pending (requires GHE instance)

## Known Limitations
- Cannot test against real GHE without access to instance
- Mock tests verify URL construction but not actual API compatibility
- Interactive prompt testing requires manual verification

## Next Steps
1. Create comprehensive mock-based integration tests
2. Add test for file system persistence
3. Manual CLI testing with mocked server responses
4. Document findings and any issues
