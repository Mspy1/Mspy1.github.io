/* Pure helpers for the Files app. No DOM, no storage, no app registry.
   Everything here describes real entries or real typed errors; nothing invents
   a file, a folder or an application. */

/** Trash is a virtual list of trash roots, never a stored folder id. */
export const TRASH_ID = "__trash__";
export const isTrashId = (id) => id === TRASH_ID;

const SIZE_UNITS = Object.freeze(["KB", "MB", "GB", "TB"]);

/** Byte counts from the storage record, formatted without guessing content. */
export function formatSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "0 bytes";
  if (value < 1024) return `${Math.round(value)} bytes`;
  let scaled = value / 1024;
  let unit = 0;
  while (scaled >= 1024 && unit < SIZE_UNITS.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return `${scaled.toFixed(1)} ${SIZE_UNITS[unit]}`;
}

/** Logical type labels for the v1 association table; unknown stays "File". */
export function mediaTypeLabel(entry) {
  if (!entry || typeof entry !== "object") return "File";
  if (entry.kind === "folder") return "Folder";
  const mediaType = String(entry.mediaType ?? "").trim().toLowerCase();
  switch (mediaType) {
    case "text/plain": return "Text document";
    case "image/png": return "PNG image";
    case "image/jpeg": return "JPEG image";
    case "image/webp": return "WebP image";
    default: return "File";
  }
}

const EXTENSIONS = Object.freeze({
  "text/plain": "txt",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
});
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const EXTENSION_ALIASES = Object.freeze({ jpg: Object.freeze(["jpg", "jpeg"]) });

/** A download name that cannot escape a folder or smuggle control characters. */
export function safeFilename(name, mediaType) {
  const extension = EXTENSIONS[String(mediaType ?? "").trim().toLowerCase()] || "";
  let base = String(name ?? "")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f-\u009f]/g, "_")
    .trim()
    .replace(/^[._]+/, "")
    .replace(/\s+/g, "_")
    .slice(0, 180)
    .replace(/[. ]+$/, "");
  if (!base) base = "download";
  if (WINDOWS_RESERVED.test(base)) base = `_${base}`;
  const aliases = EXTENSION_ALIASES[extension] || [extension];
  if (extension && !aliases.some((suffix) => new RegExp(`\\.${suffix}$`, "i").test(base))) {
    base = `${base}.${extension}`;
  }
  return base.slice(0, 200);
}

/** Show the typed code next to the message; never flatten a code away. */
export function formatTypedError(error) {
  if (error == null) return "Something went wrong.";
  const message = typeof error.message === "string" && error.message ? error.message : "Something went wrong.";
  const code = typeof error.code === "string" ? error.code.trim() : "";
  return code ? `${code}: ${message}` : message;
}

/** Parent-id ancestry, root first. Unknown ancestors simply end the chain. */
export function buildCrumbs(byId, id) {
  const crumbs = [];
  const seen = new Set();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    crumbs.push({ id: current.id, name: current.name });
    current = current.parentId == null ? null : byId.get(current.parentId);
  }
  return crumbs.reverse();
}

/**
 * Destinations for Move. A folder cannot move into itself or its own subtree;
 * a file has no folder identity to exclude. Paths are built from parent ids.
 */
export function moveTargets(folders, { excludeId = null, includeRoot = true } = {}) {
  const byId = new Map(folders.filter((folder) => folder?.id).map((folder) => [folder.id, folder]));
  const pathFor = (folder) => {
    const names = [];
    const seen = new Set();
    let current = folder;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      names.unshift(current.name);
      current = current.parentId == null ? null : byId.get(current.parentId);
    }
    return names.join(" / ");
  };
  const blocked = (folder) => {
    if (!excludeId) return false;
    const seen = new Set();
    let current = folder;
    while (current && !seen.has(current.id)) {
      if (current.id === excludeId) return true;
      seen.add(current.id);
      current = current.parentId == null ? null : byId.get(current.parentId);
    }
    return false;
  };
  return folders
    .filter((folder) => !blocked(folder) && (includeRoot || folder.id !== "root"))
    .map((folder) => ({ id: folder.id, name: folder.name, path: pathFor(folder) }));
}
