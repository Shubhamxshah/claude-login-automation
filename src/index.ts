import * as fs from "fs";
import {
  loadAccounts,
  getLeastRecentlyUsed,
  getAccountById,
  markAccountUsed,
} from "./accounts";
import { setupProfile, profileExists, getUserDataDir } from "./profiles";
import { performOAuthFlow } from "./auth";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || !["setup", "switch"].includes(command)) {
    console.log("Usage:");
    console.log("  npx ts-node src/index.ts setup                  # Set up browser profiles");
    console.log("  npx ts-node src/index.ts setup --force           # Re-setup all profiles");
    console.log("  npx ts-node src/index.ts switch                 # Switch to LRU account");
    console.log("  npx ts-node src/index.ts switch --account <id>  # Switch to specific account");
    process.exit(1);
  }

  const config = loadAccounts();

  if (command === "setup") {
    const force = args.includes("--force");
    await runSetup(config, force);
  } else if (command === "switch") {
    const accountIdx = args.indexOf("--account");
    const accountId = accountIdx !== -1 ? args[accountIdx + 1] : undefined;
    await runSwitch(config, accountId);
  }
}

async function runSetup(config: ReturnType<typeof loadAccounts>, force: boolean) {
  console.log("Setting up browser profiles for all accounts...\n");

  for (const account of config.accounts) {
    if (profileExists(account.id)) {
      if (force) {
        console.log(`Removing existing profile for ${account.email} (${account.id})...`);
        fs.rmSync(getUserDataDir(account.id), { recursive: true, force: true });
      } else {
        console.log(`Profile already exists for ${account.email} (${account.id}). Skipping.`);
        console.log("  (Use --force to re-setup)\n");
        continue;
      }
    }

    await setupProfile(account);
  }

  console.log("\nSetup complete!");
}

async function runSwitch(
  config: ReturnType<typeof loadAccounts>,
  accountId?: string
) {
  let account;

  if (accountId) {
    account = getAccountById(config, accountId);
    if (!account) {
      console.error(`Account "${accountId}" not found in accounts.json`);
      console.error(
        "Available accounts:",
        config.accounts.map((a) => a.id).join(", ")
      );
      process.exit(1);
    }
  } else {
    account = getLeastRecentlyUsed(config);
  }

  if (!profileExists(account.id)) {
    console.error(
      `No browser profile found for ${account.email} (${account.id}).`
    );
    console.error('Run "npx ts-node src/index.ts setup" first.');
    process.exit(1);
  }

  console.log(`Selected account: ${account.email} (${account.id})`);
  console.log(
    `Last used: ${account.lastUsed ? new Date(account.lastUsed).toLocaleString() : "never"}`
  );

  const success = await performOAuthFlow(account);

  if (success) {
    markAccountUsed(config, account.id);
    console.log(`\nAccount ${account.email} is now active.`);
    console.log(
      `Updated lastUsed timestamp in accounts.json`
    );
  } else {
    console.error("\nFailed to switch account. Please try again.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
