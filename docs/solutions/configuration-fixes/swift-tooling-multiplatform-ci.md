---
title: "CI workflow failing: swiftformat not found on Linux/Windows runners"
category: configuration-fixes
tags:
  - CI
  - swiftformat
  - protocol-generation
  - cross-platform
  - github-actions
  - runner-configuration
module: CI/GitHub Actions
symptom: "CI pipeline fails with 'sh: 1: swiftformat: not found' error on ubuntu-latest and windows-latest runners"
root_cause: "Platform-specific tool (swiftformat) added to script that runs on cross-platform CI runners"
date: 2026-02-01
---

# CI Workflow Failing: swiftformat not found on Linux/Windows Runners

## Problem Statement

After updating the `protocol:check` npm script to include `swiftformat` for Swift code formatting, CI started failing on Linux and Windows runners with:

```
sh: 1: swiftformat: not found
ELIFECYCLE  Command failed.
```

The protocol check passed locally on macOS but failed in CI because:
- The `protocol:check` task was in the CI matrix for `ubuntu-latest` and `windows-latest` runners
- `swiftformat` is a macOS/Swift-specific tool not available on Linux or Windows

## Investigation Steps

1. **Initial symptom**: CI run shows `swiftformat: not found` in the `checks (node, protocol)` job
2. **Checked the protocol:check script** in `package.json`:
   ```json
   "protocol:check": "pnpm protocol:gen && pnpm protocol:gen:swift && swiftformat ... && git diff --exit-code ..."
   ```
3. **Identified the issue**: The script includes `swiftformat` which is only available on macOS
4. **Checked CI workflow**: The `protocol` task was in both `checks` (ubuntu) and `checks-windows` matrices

## Root Cause

**Platform-specific tool in cross-platform CI workflow.**

The `protocol:check` script requires `swiftformat` (a Swift formatter installed via Homebrew on macOS), but the CI workflow ran this check on all platforms including Linux and Windows where the tool isn't available.

This is a common pattern when:
1. A script works locally (on macOS where Swift tooling exists)
2. The CI matrix runs the same script on all platforms
3. Platform-specific tools aren't available on other runners

## Solution

### Step 1: Remove protocol check from Linux/Windows runners

In `.github/workflows/ci.yml`, remove the protocol task from cross-platform matrices:

**Before (in `checks` matrix on ubuntu-latest):**
```yaml
matrix:
  include:
    - runtime: node
      task: protocol
      command: pnpm protocol:check  # REMOVE THIS
```

**Before (in `checks-windows` matrix):**
```yaml
matrix:
  include:
    - runtime: node
      task: protocol
      command: pnpm protocol:check  # REMOVE THIS
```

### Step 2: Add protocol check to macOS-only job

Add the protocol task to the `checks-macos` job which only runs on `macos-latest`:

```yaml
checks-macos:
  if: github.event_name == 'pull_request'
  runs-on: macos-latest
  strategy:
    fail-fast: false
    matrix:
      include:
        - task: test
          command: pnpm test
        - task: protocol              # ADD
          command: pnpm protocol:check  # ADD
```

### Step 3: Ensure swiftformat is installed

Add installation step to the `checks-macos` job:

```yaml
steps:
  # ... checkout, node setup, pnpm setup ...

  - name: Install SwiftFormat
    run: brew install swiftformat

  # ... rest of steps ...
```

## Verification

1. Push the changes and verify CI passes
2. Check that `checks-macos (protocol)` job runs and succeeds
3. Verify `checks` and `checks-windows` jobs no longer include protocol task

## Prevention Strategies

### Before Adding Tools to CI Scripts

1. **Check tool availability**: Is this tool available on all target platforms?
2. **Platform-specific tools**: Move to platform-specific CI jobs
3. **Cross-platform alternatives**: Consider if a cross-platform tool exists

### CI Organization Pattern

```
Tier 1 (Cross-Platform - ubuntu, windows):
├── lint (oxlint - cross-platform)
├── format (oxfmt - cross-platform)
├── build (tsc - cross-platform)
└── test (vitest - cross-platform)

Tier 2 (Platform-Specific - macos-only):
├── protocol (requires swiftformat)
├── macos-app-lint (swiftlint, swiftformat)
├── macos-app-build (swift build)
└── macos-app-test (swift test)
```

### Quick Check Before Committing

```bash
# Does the script use platform-specific tools?
grep -E "(swiftformat|swiftlint|xcrun|xcodebuild)" package.json

# Is the task in cross-platform CI jobs?
grep -A5 "task: protocol" .github/workflows/ci.yml
```

## Related Files

- `.github/workflows/ci.yml` - CI workflow configuration
- `package.json` - `protocol:check` script definition
- `scripts/protocol-gen-swift.ts` - Swift protocol generator
- `apps/macos/Sources/OpenClawProtocol/GatewayModels.swift` - Generated Swift models
- `docs/gateway/protocol.md` - Protocol documentation

## Key Insight

> **Platform-specific tools should only run on platform-specific CI jobs.**
>
> When adding new tools to CI scripts, always verify they're available on all runners where the script will execute, or move the task to a platform-specific job.
