/* Gate 2 app-facing file service. Apps never touch IndexedDB or draft storage
   directly: they receive this object through `services.files` (name chosen at
   wiring time) and pass stable file IDs plus expected revisions.

   Responsibilities kept here rather than in apps:
   - one file-association table (folder/text/image) used by Files and Start;
   - per-editor draft ids and draft records;
   - recovery classification that never offers a silent overwrite. */

import { STORAGE_CODES, StorageError } from "./storage.mjs";

const fail = (code, message, details) => new StorageError(code, message, details ? { details } : undefined);

/** Supported logical kinds and media types for v1 (see plan §4 Import/export). */
export const ASSOCIATIONS = Object.freeze({
  folder: Object.freeze({ appId: "files", mode: "browse" }),
  "text/plain": Object.freeze({ appId: "notepad", mode: "edit" }),
  "image/png": Object.freeze({ appId: "paint", mode: "edit" }),
  "image/jpeg": Object.freeze({ appId: "paint", mode: "edit" }),
  "image/webp": Object.freeze({ appId: "paint", mode: "edit" }),
});

const IMAGE_MEDIA_TYPES = Object.freeze(["image/png", "image/jpeg", "image/webp"]);

export function isSupportedMediaType(mediaType) {
  return Boolean(ASSOCIATIONS[String(mediaType ?? "").trim().toLowerCase()]);
}

/**
 * Resolve `{ appId, mode }` for a stored entry.
 * With the read-only viewer available, Files opens images read-only; Paint
 * still opens its own generated files for editing.
 */
export function associationFor(entry, { photoViewer = false } = {}) {
  if (!entry || typeof entry !== "object") return null;
  if (entry.kind === "folder") return { ...ASSOCIATIONS.folder };
  const mediaType = String(entry.mediaType ?? "").trim().toLowerCase();
  if (photoViewer && entry.origin === "import" && IMAGE_MEDIA_TYPES.includes(mediaType)) {
    return { appId: "photo-viewer", mode: "view" };
  }
  const association = ASSOCIATIONS[mediaType];
  return association ? { ...association } : null;
}

const randomId = () =>
  globalThis.crypto?.randomUUID?.() ?? `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** A draft id belongs to one editor tab; never key drafts by saved file id. */
export function newDraftId(appId) {
  if (typeof appId !== "string" || !appId.trim()) throw fail(STORAGE_CODES.INVALID_DRAFT, "A draft needs an appId.");
  return `${appId.trim()}-${randomId()}`;
}

/** Build a draft record without writing it. */
export function createDraft({ appId, fileId = null, baseRevision = null, payload, updatedAt, draftId } = {}) {
  if (typeof appId !== "string" || !appId.trim()) throw fail(STORAGE_CODES.INVALID_DRAFT, "A draft needs an appId.");
  if (typeof draftId !== "string" || !draftId.trim()) draftId = newDraftId(appId);
  if (fileId !== null && (typeof fileId !== "string" || !fileId)) {
    throw fail(STORAGE_CODES.INVALID_DRAFT, "A draft fileId must be an id or null.");
  }
  if (fileId === null && baseRevision !== null) {
    throw fail(STORAGE_CODES.INVALID_DRAFT, "An untitled draft cannot have a baseRevision without a fileId.");
  }
  if (fileId !== null && (!Number.isInteger(baseRevision) || baseRevision < 1)) {
    throw fail(STORAGE_CODES.INVALID_DRAFT, "A draft for an existing file needs its baseRevision.");
  }
  if (payload === undefined) throw fail(STORAGE_CODES.INVALID_DRAFT, "A draft needs a payload.");
  return {
    draftId,
    appId: appId.trim(),
    fileId,
    baseRevision,
    payload,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  };
}

/**
 * Tell the recovery UI what a draft can safely do relative to the saved entry.
 * Stale never means overwrite: the saved content changed after baseRevision.
 */
export function draftRecovery(draft, entry) {
  if (!draft || typeof draft !== "object") throw fail(STORAGE_CODES.INVALID_DRAFT, "A draft record is required.");
  if (draft.fileId == null) return { state: "unsaved", action: "resume", currentRevision: null };
  if (!entry) return { state: "orphaned", action: "save-copy", currentRevision: null };
  if (draft.baseRevision !== entry.revision) return { state: "stale", action: "review", currentRevision: entry.revision };
  return { state: "current", action: "resume", currentRevision: entry.revision };
}

/**
 * Create the app-facing service around a storage instance.
 *
 * storage: created by createStorage() from ./storage.mjs
 * resolveApp: optional (entry) => { appId, mode } | null override
 * photoViewer: enable imported-image -> read-only viewer mapping
 */
export function createFileService({ storage, resolveApp, photoViewer = false, now = () => Date.now() } = {}) {
  if (!storage) throw new TypeError("createFileService needs a storage instance.");
  const resolve = resolveApp || ((entry) => associationFor(entry, { photoViewer }));
  const forward = (method) =>
    storage[method]
      ? (...args) => storage[method](...args)
      : () => {
          throw fail(STORAGE_CODES.UNAVAILABLE, `Storage does not provide ${method}().`);
        };

  return {
    storage,
    getStorageMode: () => storage.getStorageMode(),
    getModeReason: () => storage.getModeReason?.(),
    ready: () => storage.ready(),
    retry: () => storage.retry(),
    close: () => storage.close?.(),

    list: forward("list"),
    listTrash: forward("listTrash"),
    read: forward("read"),
    create: forward("create"),
    write: forward("write"),
    rename: forward("rename"),
    move: forward("move"),
    trash: forward("trash"),
    restore: forward("restore"),
    purge: forward("purge"),

    listDrafts: forward("listDrafts"),
    readDraft: forward("readDraft"),
    putDraft: forward("putDraft"),
    deleteDraft: forward("deleteDraft"),

    getAppForFile(entry) {
      return resolve(entry) ?? null;
    },

    /** Notepad-shaped convenience: UTF-8 text file, revision 1. */
    createText({ parentId, name, text, origin = "created" }, options = {}) {
      return storage.create({ parentId, name, kind: "file", mediaType: "text/plain", text, origin }, options);
    },

    /** Paint/import shape: original bytes stay in `blob`; origin metadata is explicit. */
    createImage({ parentId, name, blob, mediaType, image, origin = "import" }, options = {}) {
      return storage.create({ parentId, name, kind: "file", blob, mediaType, image, origin }, options);
    },

    newDraftId,
    createDraft: (input = {}) => createDraft({ updatedAt: now(), ...input }),
    draftRecovery,
  };
}
