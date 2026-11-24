import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function loadPlaywright(moduleId = process.env.FINDOWS_PLAYWRIGHT_MODULE || "playwright") {
  try {
    return require(moduleId);
  } catch (error) {
    throw new Error("Set FINDOWS_PLAYWRIGHT_MODULE to your local Playwright module, or install Playwright in a development environment.", { cause: error });
  }
}

export function browserType(name) {
  const playwright = loadPlaywright();
  if (!["chromium", "firefox", "webkit"].includes(name)) {
    throw new Error(`Unsupported test browser ${name}; choose chromium, firefox, or webkit.`);
  }
  return playwright[name];
}
