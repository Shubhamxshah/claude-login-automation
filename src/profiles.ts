import * as fs from "fs";
import * as path from "path";
import { chromium } from "playwright";
import { Account } from "./accounts";
import { findChrome } from "./browser";

const PROFILES_DIR = path.join(__dirname, "..", "profiles");

export function getProfileDir(accountId: string): string {
  return path.join(PROFILES_DIR, accountId);
}

export function getUserDataDir(accountId: string): string {
  return path.join(getProfileDir(accountId), "user-data");
}

export function profileExists(accountId: string): boolean {
  return fs.existsSync(getUserDataDir(accountId));
}

export async function setupProfile(account: Account): Promise<void> {
  const profileDir = getProfileDir(account.id);
  fs.mkdirSync(profileDir, { recursive: true });

  console.log(`\nSetting up profile for ${account.email} (${account.id})`);
  console.log("A browser window will open. Please:");
  console.log("  1. Go to https://accounts.google.com and sign in");
  console.log("  2. Then go to https://claude.ai and sign in with Google");
  console.log("  3. Close the browser window when done\n");

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

  const page = context.pages()[0] || (await context.newPage());
  await page.goto("https://accounts.google.com");

  // Wait for the user to close the browser
  await new Promise<void>((resolve) => {
    context.on("close", () => resolve());
  });

  console.log(`Profile saved for ${account.email}`);
}
