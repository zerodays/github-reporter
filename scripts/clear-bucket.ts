import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig } from "../src/config.js";
import { createStorageClient, describeStorage } from "../src/storage.js";

async function main() {
  const config = loadConfig();
  const prefix = (process.env.CLEAR_BUCKET_PREFIX ?? config.output.prefix).trim();
  if (!prefix) {
    console.error("Refusing to clear: prefix is empty.");
    process.exit(1);
  }

  const storage = createStorageClient(config.storage);
  const summary = describeStorage(config.storage);

  const rl = createInterface({ input, output });
  const prompt = [
    "WARNING: This will delete ALL objects under the prefix:",
    `  ${prefix}`,
    "Storage:",
    `  ${JSON.stringify(summary)}`,
    "Type 'Y' and press Enter to continue:"
  ].join("\n");
  const answer = await rl.question(`${prompt} `);
  rl.close();

  if (answer.trim() !== "Y") {
    console.log("Aborted.");
    process.exit(0);
  }

  const keys = await storage.list(prefix);
  if (keys.length === 0) {
    console.log("Nothing to delete.");
    return;
  }

  console.log(`Deleting ${keys.length} objects...`);
  for (const key of keys) {
    await storage.delete(key);
  }
  console.log("Done.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
