import * as fs from "fs";
import * as path from "path";

export interface Account {
  id: string;
  email: string;
  lastUsed: string | null;
}

export interface AccountsConfig {
  accounts: Account[];
}

const ACCOUNTS_FILE = path.join(__dirname, "..", "accounts.json");

export function loadAccounts(): AccountsConfig {
  const raw = fs.readFileSync(ACCOUNTS_FILE, "utf-8");
  return JSON.parse(raw) as AccountsConfig;
}

export function saveAccounts(config: AccountsConfig): void {
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(config, null, 2) + "\n");
}

export function getLeastRecentlyUsed(config: AccountsConfig): Account {
  const sorted = [...config.accounts].sort((a, b) => {
    if (a.lastUsed === null && b.lastUsed === null) return 0;
    if (a.lastUsed === null) return -1;
    if (b.lastUsed === null) return 1;
    return new Date(a.lastUsed).getTime() - new Date(b.lastUsed).getTime();
  });
  return sorted[0];
}

export function getAccountById(
  config: AccountsConfig,
  id: string
): Account | undefined {
  return config.accounts.find((a) => a.id === id);
}

export function markAccountUsed(config: AccountsConfig, id: string): void {
  const account = config.accounts.find((a) => a.id === id);
  if (account) {
    account.lastUsed = new Date().toISOString();
    saveAccounts(config);
  }
}
