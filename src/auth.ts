import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import * as https from "https";
import { chromium } from "playwright";
import { Account } from "./accounts";
import { getUserDataDir } from "./profiles";
import { findChrome } from "./browser";

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const REDIRECT_URI = "https://platform.claude.com/oauth/code/callback";
const SCOPES = "user:profile user:inference user:sessions:claude_code user:mcp_servers";

export async function performOAuthFlow(account: Account): Promise<boolean> {
  console.log(`\nSwitching to account: ${account.email} (${account.id})`);

  // Step 1: Generate PKCE parameters
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  // Step 2: Build the OAuth URL
  const params = new URLSearchParams({
    code: "true",
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });
  const oauthUrl = `${AUTHORIZE_URL}?${params.toString()}`;
  console.log("Opening browser for OAuth...");

  // Step 3: Complete OAuth in browser
  const authCode = await completeOAuthInBrowser(account, oauthUrl, state);
  if (!authCode) {
    console.error("Failed to complete OAuth flow in browser");
    return false;
  }
  console.log(`Got authorization code: ${authCode.substring(0, 20)}...`);

  // Step 4: Exchange code for tokens
  const tokens = await exchangeCodeForTokens(authCode, codeVerifier, state);
  if (!tokens) {
    console.error("Failed to exchange code for tokens");
    return false;
  }
  console.log("Got access token and refresh token");

  // Step 5: Save credentials
  saveCredentials(tokens);
  console.log(`Successfully switched to ${account.email}!`);
  return true;
}

function generateCodeVerifier(): string {
  return base64url(crypto.randomBytes(32));
}

function generateCodeChallenge(verifier: string): string {
  const hash = crypto.createHash("sha256").update(verifier).digest();
  return base64url(hash);
}

function generateState(): string {
  return base64url(crypto.randomBytes(32));
}

function base64url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function completeOAuthInBrowser(
  account: Account,
  oauthUrl: string,
  state: string
): Promise<string | null> {
  const executablePath = findChrome();
  const context = await chromium.launchPersistentContext(
    getUserDataDir(account.id),
    {
      headless: false,
      executablePath,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
        "--no-default-browser-check",
      ],
      viewport: { width: 1280, height: 800 },
      ignoreDefaultArgs: ["--enable-automation"],
    }
  );

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(oauthUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Wait for and click the approval button
    const approveSelectors = [
      'button:has-text("Allow")',
      'button:has-text("Approve")',
      'button:has-text("Accept")',
      'button:has-text("Authorize")',
      'button:has-text("Continue")',
    ];

    for (const selector of approveSelectors) {
      try {
        const button = await page.waitForSelector(selector, { timeout: 5000 });
        if (button) {
          console.log("Found approval button, clicking...");
          await button.click();
          break;
        }
      } catch {
        // Try next selector
      }
    }

    // Wait for redirect to the callback URL
    await page.waitForURL("**/oauth/code/callback**", { timeout: 60000 });
    await page.waitForTimeout(2000);

    // Extract the full auth code from the page
    // The callback page shows the code in format: <code>#<state>
    let authCode: string | null = null;

    // Try to get displayed code from page elements
    for (const selector of ["code", "pre", "input[readonly]", ".code", "[data-code]", "textarea"]) {
      try {
        const el = await page.$(selector);
        if (el) {
          const val = await el.inputValue().catch(() => null);
          const text = await el.textContent();
          const candidate = (val || text || "").trim();
          if (candidate.length > 10) {
            authCode = candidate;
            break;
          }
        }
      } catch {
        // continue
      }
    }

    // Try page text for code#state pattern
    if (!authCode) {
      const bodyText = await page.textContent("body");
      if (bodyText) {
        const codeMatch = bodyText.match(/([A-Za-z0-9_-]{20,}#[A-Za-z0-9_-]{20,})/);
        if (codeMatch) {
          authCode = codeMatch[1];
        }
      }
    }

    // Fallback: construct from URL params
    if (!authCode) {
      const fullUrl = await page.evaluate("location.href") as string;
      const hashIdx = fullUrl.indexOf("#");
      const urlWithoutHash = hashIdx >= 0 ? fullUrl.substring(0, hashIdx) : fullUrl;
      const fragment = hashIdx >= 0 ? fullUrl.substring(hashIdx + 1) : "";
      const urlParams = new URL(urlWithoutHash).searchParams;
      const code = urlParams.get("code");
      if (code) {
        const urlState = urlParams.get("state");
        if (urlState) {
          authCode = `${code}#${urlState}`;
        } else if (fragment) {
          authCode = `${code}#${fragment}`;
        } else {
          authCode = code;
        }
      }
    }

    // Extract just the code part (before #) for the token exchange
    // The # part is the state, which we already have
    if (authCode && authCode.includes("#")) {
      return authCode.split("#")[0];
    }
    return authCode;
  } finally {
    await context.close();
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  state: string
): Promise<TokenResponse | null> {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
      state,
    });

    const url = new URL(TOKEN_URL);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data) as TokenResponse);
          } catch {
            console.error("Failed to parse token response:", data);
            resolve(null);
          }
        } else {
          console.error(`Token exchange failed (${res.statusCode}):`, data);
          resolve(null);
        }
      });
    });

    req.on("error", (err) => {
      console.error("Token exchange request error:", err.message);
      resolve(null);
    });

    req.write(body);
    req.end();
  });
}

function saveCredentials(tokens: TokenResponse): void {
  const claudeDir = path.join(os.homedir(), ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });

  const credentialsPath = path.join(claudeDir, ".credentials.json");

  const credentials = {
    claudeAiOauth: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      scopes: (tokens.scope || SCOPES).split(" "),
    },
  };

  fs.writeFileSync(credentialsPath, JSON.stringify(credentials) + "\n", {
    mode: 0o600,
  });
  console.log(`Credentials saved to ${credentialsPath}`);
}
