/* App definitions and lazy loading. */

const HELP = {
  id: "help",
  title: "Help",
  keywords: ["about", "keyboard", "touch", "mobile", "storage", "exit", "guide"],
  icon: "help",
  singleton: true,
  accepts: [],
  minSize: { width: 320, height: 200 },
  pinned: true,
  load: () => import("./apps/help.mjs"),
};

const CALCULATOR = {
  id: "calculator",
  title: "Calculator",
  keywords: ["math", "arithmetic", "calc", "numbers"],
  icon: "calculator",
  singleton: true,
  accepts: [],
  minSize: { width: 320, height: 320 },
  pinned: true,
  load: () => import("./apps/calculator.mjs"),
};

function valid(def) {
  return Boolean(
    def &&
      typeof def.id === "string" && /^[a-z0-9-]+$/.test(def.id) &&
      typeof def.title === "string" && def.title &&
      Array.isArray(def.keywords) &&
      typeof def.icon === "string" && def.icon &&
      Array.isArray(def.accepts) &&
      def.minSize && Number.isFinite(def.minSize.width) && Number.isFinite(def.minSize.height) &&
      typeof def.load === "function",
  );
}

const additionalApps = [
  { id: "files", title: "Files", keywords: ["explorer", "folders", "recycle bin"], pinned: true, minSize: { width: 390, height: 300 }, load: () => import("./apps/files.mjs") },
  { id: "notepad", title: "Notepad", keywords: ["text", "notes", "editor", "drafts"], pinned: true, singleton: false, accepts: ["text/plain"], minSize: { width: 360, height: 275 }, load: () => import("./apps/notepad.mjs") },
  { id: "clock", title: "Clock", keywords: ["time", "stopwatch", "timer"], minSize: { width: 330, height: 300 }, load: () => import("./apps/clock.mjs") },
  { id: "settings", title: "Settings", keywords: ["appearance", "wallpaper", "theme", "preferences"], minSize: { width: 360, height: 300 }, load: () => import("./apps/settings.mjs") },
  { id: "diagnostics", title: "Diagnostics", keywords: ["system information", "version", "connection", "window count"], minSize: { width: 320, height: 320 }, load: () => import("./apps/diagnostics.mjs") },
  { id: "minesweeper", title: "Minesweeper", keywords: ["game", "flags", "puzzle"], minSize: { width: 385, height: 465 }, load: () => import("./apps/minesweeper.mjs") },
  { id: "sticky-notes", title: "Sticky Notes", keywords: ["memo", "pin", "stickies"], minSize: { width: 340, height: 330 }, load: () => import("./apps/sticky-notes.mjs") },
  { id: "paint", title: "Paint", keywords: ["drawing", "art", "image editor", "canvas"], pinned: true, singleton: false, accepts: ["image/png", "image/jpeg", "image/webp"], minSize: { width: 450, height: 375 }, load: () => import("./apps/paint.mjs") },
  { id: "photo-viewer", title: "Photo Viewer", keywords: ["images", "pictures", "photos"], singleton: false, accepts: ["image/png", "image/jpeg", "image/webp"], minSize: { width: 380, height: 320 }, load: () => import("./apps/photo-viewer.mjs") },
  { id: "unit-converter", title: "Unit Converter", keywords: ["convert", "measurement", "metric"], minSize: { width: 360, height: 320 }, load: () => import("./apps/unit-converter.mjs") },
  { id: "json-formatter", title: "JSON Formatter", keywords: ["json", "format", "pretty", "validate", "tree", "minify"], minSize: { width: 420, height: 340 }, load: () => import("./apps/json-formatter.mjs") },
  { id: "base64-codec", title: "Base64 & URL Codec", keywords: ["base64", "url", "encode", "decode", "codec"], minSize: { width: 380, height: 330 }, load: () => import("./apps/base64-codec.mjs") },
  { id: "hash-tool", title: "Hash Tool", keywords: ["sha256", "checksum", "digest", "hash"], minSize: { width: 380, height: 340 }, load: () => import("./apps/hash-tool.mjs") },
  { id: "date-calculator", title: "Date Calculator", keywords: ["date", "days", "calendar math", "duration"], minSize: { width: 380, height: 340 }, load: () => import("./apps/date-calculator.mjs") },
  { id: "world-clock", title: "World Clock", keywords: ["time", "zone", "world", "dst", "international"], minSize: { width: 320, height: 320 }, load: () => import("./apps/world-clock.mjs") },
  { id: "color-tools", title: "Color Tools", keywords: ["color", "hex", "rgb", "hsl", "contrast", "palette"], minSize: { width: 400, height: 360 }, load: () => import("./apps/color-tools.mjs") },
  { id: "text-toolkit", title: "Text Toolkit", keywords: ["text", "sort", "case", "count", "lines"], minSize: { width: 380, height: 340 }, load: () => import("./apps/text-toolkit.mjs") },
  { id: "character-map", title: "Character Map", keywords: ["unicode", "glyph", "symbols", "chars"], minSize: { width: 360, height: 360 }, load: () => import("./apps/character-map.mjs") },
  { id: "markdown-preview", title: "Markdown Preview", keywords: ["markdown", "md", "preview", "format"], minSize: { width: 420, height: 340 }, load: () => import("./apps/markdown-preview.mjs") },
  { id: "read-aloud", title: "Read Aloud", keywords: ["speech", "voice", "tts", "narrator"], accepts: ["text/plain"], minSize: { width: 360, height: 420 }, load: () => import("./apps/read-aloud.mjs") },
  { id: "snake", title: "Snake", keywords: ["game", "arcade"], minSize: { width: 370, height: 440 }, load: () => import("./apps/snake.mjs") },
  { id: "nonogram", title: "Nonogram", keywords: ["game", "picross", "puzzle", "picture", "grid"], minSize: { width: 400, height: 480 }, load: () => import("./apps/nonogram.mjs") },
  { id: "fifteen-puzzle", title: "Fifteen Puzzle", keywords: ["game", "sliding tiles", "puzzle"], minSize: { width: 370, height: 450 }, load: () => import("./apps/fifteen-puzzle.mjs") },
  { id: "game-of-life", title: "Game of Life", keywords: ["game", "cellular", "conway", "simulation"], minSize: { width: 420, height: 400 }, load: () => import("./apps/game-of-life.mjs") },
  { id: "tone-generator", title: "Tone Generator", keywords: ["audio", "sound", "oscillator", "frequency"], minSize: { width: 380, height: 360 }, load: () => import("./apps/tone-generator.mjs") },
  { id: "sokoban", title: "Sokoban", keywords: ["game", "boxes", "puzzle", "levels"], minSize: { width: 400, height: 460 }, load: () => import("./apps/sokoban.mjs") },
  { id: "block-drop", title: "Block Drop", keywords: ["game", "tetromino", "arcade", "blocks"], minSize: { width: 420, height: 470 }, load: () => import("./apps/block-drop.mjs") },
  { id: "hangman", title: "Hangman", keywords: ["game", "words", "letters", "guessing"], minSize: { width: 370, height: 450 }, load: () => import("./apps/hangman.mjs") },
  { id: "mastermind", title: "Mastermind", keywords: ["game", "code", "colors", "puzzle"], minSize: { width: 380, height: 440 }, load: () => import("./apps/mastermind.mjs") },
].map((def) => ({ icon: def.id, singleton: true, accepts: [], ...def }));

export function createRegistry(apps = [HELP, CALCULATOR, ...additionalApps]) {
  const byId = new Map();
  const cache = new Map();

  function registerApp(def) {
    if (!valid(def)) throw new Error("Invalid app definition: required fields missing");
    const id = def.id.toLowerCase();
    if (byId.has(id)) throw new Error(`Duplicate app id: ${id}`);
    const frozen = Object.freeze({
      ...def,
      id,
      keywords: Object.freeze([...def.keywords]),
      accepts: Object.freeze([...def.accepts]),
      minSize: Object.freeze({ ...def.minSize }),
      load: () => {
        if (!cache.has(id)) {
          cache.set(id, Promise.resolve().then(def.load).catch((error) => {
            cache.delete(id);
            throw error;
          }));
        }
        return cache.get(id);
      },
    });
    byId.set(id, frozen);
    return frozen;
  }

  for (const app of apps) registerApp(app);

  return {
    registerApp,
    getApp(id) {
      if (typeof id !== "string") return null;
      return byId.get(id.toLowerCase()) || null;
    },
    list() {
      return Object.freeze([...byId.values()]);
    },
    search(query = "") {
      const q = String(query).trim().toLowerCase();
      if (!q) return Object.freeze([...byId.values()]);
      const parts = q.split(/\s+/);
      return Object.freeze(
        [...byId.values()].filter((app) => {
          const haystack = [app.title, ...app.keywords].join(" ").toLowerCase();
          return parts.every((part) => haystack.includes(part));
        }),
      );
    },
  };
}
