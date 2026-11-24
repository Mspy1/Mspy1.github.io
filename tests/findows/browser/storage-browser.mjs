/* WebKit entry point for the full Gate 2 storage contract harness.
   Usage: node tests/findows/browser/storage-browser.mjs [--browser=webkit] [--port=8835]
   Set FINDOWS_PLAYWRIGHT_MODULE to the local Playwright package. Dev-only. */
import { runStorageBrowser } from "../storage-browser.mjs";

const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

try {
  const result = await runStorageBrowser({
    browserName: arg("browser", "webkit"),
    port: Number(arg("port", "8835")),
  });
  process.exitCode = result.failures ? 1 : 0;
} catch (error) {
  console.error(`STORAGE BROWSER ENTRY FAILED: ${error?.stack || error}`);
  process.exitCode = 1;
}
