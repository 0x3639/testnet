import { createAccount } from "./accounts.js";
import { readState } from "./storage.js";
import type { Role } from "../shared/types.js";

function valueAfter(flag: string, args: string[]): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "list") {
    const state = await readState();
    for (const user of state.users) {
      console.log(`${user.username}\t${user.role}\t${user.createdAt}`);
    }
    return;
  }

  if (command === "create-user" || command === "create-admin") {
    const username = valueAfter("--username", args);
    const suppliedPassword = valueAfter("--password", args);
    if (!username) {
      throw new Error("Missing --username");
    }

    const role: Role = command === "create-admin" ? "admin" : "user";
    const { user, password } = await createAccount(username, role, suppliedPassword);
    console.log(`Created ${user.role} account`);
    console.log(`Username: ${user.username}`);
    console.log(`Password: ${password}`);
    return;
  }

  console.log(`Usage:
  npm run account -- create-admin --username admin [--password value]
  npm run account -- create-user --username alice [--password value]
  npm run account -- list`);
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
