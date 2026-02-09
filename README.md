# Claude Code Account Switcher

Automate switching between multiple Claude Pro accounts when you get rate limited. Uses Playwright with saved browser profiles to complete the OAuth flow automatically.

## How It Works

1. **Setup**: Opens a real Chrome window for each account so you can log into Google/Claude manually. Browser sessions are saved locally.
2. **Switch**: Picks the least-recently-used account, opens the browser with that account's saved session, completes the OAuth PKCE flow, exchanges the code for tokens, and writes credentials to `~/.claude/.credentials.json`.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Google Chrome](https://www.google.com/chrome/) installed on your system
- Multiple [Claude Pro](https://claude.ai) accounts authenticated via Google

## Install

```bash
git clone https://github.com/YOUR_USERNAME/anthropic-automation.git
cd anthropic-automation
npm install
npx playwright install chromium
```

## Configure

```bash
cp accounts.example.json accounts.json
```

Edit `accounts.json` with your actual Google account emails:

```json
{
  "accounts": [
    { "id": "account-1", "email": "you@gmail.com", "lastUsed": null },
    { "id": "account-2", "email": "you-alt@gmail.com", "lastUsed": null }
  ]
}
```

## Usage

### One-time: Set up browser profiles

```bash
npx ts-node src/index.ts setup
```

A Chrome window opens for each account. Sign into Google, then sign into claude.ai, then close the browser. Sessions are saved to `profiles/`.

Use `--force` to re-setup existing profiles:

```bash
npx ts-node src/index.ts setup --force
```

### Switch accounts

Switch to the least-recently-used account:

```bash
npx ts-node src/index.ts switch
```

Switch to a specific account:

```bash
npx ts-node src/index.ts switch --account account-2
```

### Verify

```bash
claude "hello"
```

## What happens during switch

1. Generates PKCE challenge (code_verifier + code_challenge)
2. Opens Chrome with the selected account's saved Google session
3. Navigates to the Claude OAuth authorization URL
4. Clicks the "Allow" button automatically
5. Extracts the authorization code from the callback page
6. Exchanges the code for access + refresh tokens via `platform.claude.com/v1/oauth/token`
7. Writes tokens to `~/.claude/.credentials.json`
8. Updates `lastUsed` timestamp in `accounts.json`

## File Structure

```
├── src/
│   ├── index.ts       # CLI entry point (setup / switch commands)
│   ├── auth.ts        # OAuth PKCE flow + token exchange
│   ├── accounts.ts    # Account config loading, LRU selection
│   ├── profiles.ts    # Browser profile management
│   └── browser.ts     # System Chrome detection
├── accounts.json      # Your accounts config (gitignored)
├── profiles/          # Saved browser sessions (gitignored)
└── package.json
```

## Security Notes

- `profiles/` contains your Google session cookies — keep it private
- `accounts.json` contains your email addresses — gitignored by default
- Credentials are written to `~/.claude/.credentials.json` with `0600` permissions
