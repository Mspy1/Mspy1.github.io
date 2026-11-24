/* Gate 2 persistence: the only module that talks to IndexedDB.
   Public contract: docs/superpowers/plans/2026-11-24-findows-durability-contract.md
   - Every mutation takes the caller's expected revision.
   - Success resolves on transaction.oncomplete, never on request success.
   - Trash is a virtual list of trash roots; purge is one atomic subtree delete.
   - Drafts are per editor and never overwrite saved content.
   - Failure is typed; blocked storage becomes explicit temporary mode. */

export const DB_NAME = "findows";
export const DB_VERSION = 1;

/** Store names in schema version 1. */
export const STORES = Object.freeze({
  ENTRIES: "entries",
  DRAFTS: "drafts",
  SETTINGS: "settings",
  STICKY_NOTES: "stickyNotes",
});

/** Reserved, immutable root and seed folder IDs. */
export const RESERVED = Object.freeze({
  ROOT: "root",
  DESKTOP: "desktop",
  DOCUMENTS: "documents",
  PICTURES: "pictures",
});

/** Safe, disclosed restore destination when an original parent is unavailable. */
export const SAFE_RESTORE_PARENT_ID = RESERVED.DOCUMENTS;

export const STORAGE_CODES = Object.freeze({
  UNAVAILABLE: "UNAVAILABLE",
  QUOTA: "QUOTA",
  REVISION_CONFLICT: "REVISION_CONFLICT",
  NAME_CONFLICT: "NAME_CONFLICT",
  MISSING: "MISSING",
  INVALID: "INVALID",
  INVALID_NAME: "INVALID_NAME",
  INVALID_PARENT: "INVALID_PARENT",
  INVALID_DRAFT: "INVALID_DRAFT",
  CYCLE: "CYCLE",
  RESERVED: "RESERVED",
  TRASHED: "TRASHED",
  NOT_TRASHED: "NOT_TRASHED",
  EXISTS: "EXISTS",
  READ_ONLY: "READ_ONLY",
  ABORTED: "ABORTED",
});

const CODES = STORAGE_CODES;
const MAX_NAME_LENGTH = 255;
const encoder = new TextEncoder();

export class StorageError extends Error {
  constructor(code, message, { cause, details } = {}) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "StorageError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const isStorageError = (value) => value instanceof StorageError;

const fail = (code, message, extra = {}) => new StorageError(code, message, extra);

function toStorageError(error) {
  if (error instanceof StorageError) return error;
  const domName = error?.name;
  if (domName === "QuotaExceededError") {
    return fail(CODES.QUOTA, "Browser storage is full. Nothing was saved; download a copy.", { cause: error });
  }
  if (domName === "AbortError") {
    return fail(CODES.ABORTED, "The storage transaction was aborted, so nothing was saved.", { cause: error });
  }
  if (domName === "DataCloneError") {
    return fail(CODES.INVALID, "That value cannot be stored in this browser.", { cause: error });
  }
  return fail(CODES.UNAVAILABLE, "Browser storage could not complete this operation.", { cause: error, details: { name: domName } });
}

/* ---------------------------------------------------------------- names ---- */

/** Comparison key: Unicode-normalized, case-insensitive, display spelling untouched. */
export function compareName(name) {
  return String(name ?? "").normalize("NFKC").trim().toLowerCase();
}

/** Validate and return the display name, or throw INVALID_NAME. */
export function validateName(name) {
  if (typeof name !== "string") throw fail(CODES.INVALID_NAME, "A name must be text.");
  const display = name.trim();
  if (!display) throw fail(CODES.INVALID_NAME, "A name cannot be empty.");
  if (display.length > MAX_NAME_LENGTH) throw fail(CODES.INVALID_NAME, `A name cannot exceed ${MAX_NAME_LENGTH} characters.`);
  if (/^\.+$/.test(display)) throw fail(CODES.INVALID_NAME, "A name cannot be only dots.");
  if (/[/\\\u0000-\u001f\u007f-\u009f]/.test(display)) {
    throw fail(CODES.INVALID_NAME, "A name cannot contain slashes or control characters.");
  }
  return display;
}

export function isReservedId(id) {
  return Object.values(RESERVED).includes(id);
}

const isFolder = (entry) => entry?.kind === "folder";
const isBlob = (value) =>
  (typeof Blob !== "undefined" && value instanceof Blob) || Object.prototype.toString.call(value) === "[object Blob]";

/* WebKit (webkit-2388) cannot Structured-Clone any Blob into IndexedDB:
   every put/add fails with UnknownError “Error preparing Blob/File data to be
   stored in object store”. Uint8Array of the same bytes stores fine. We store
   binary content as versioned cloneable bytes at the shared boundary and
   reconstruct a real Blob on the way out, so entry.blob / draft.payload.blob
   keep their public API in every browser. Records written by earlier runs with
   a real stored Blob are still decoded as-is. */
const BLOB_MARKER = "__findowsBlobV1";

const isEncodedBlob = (value) =>
  Boolean(
    value &&
      typeof value === "object" &&
      value[BLOB_MARKER] === true &&
      typeof value.type === "string" &&
      (value.bytes instanceof Uint8Array || value.bytes instanceof ArrayBuffer),
  );

async function encodeBlob(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { [BLOB_MARKER]: true, type: blob.type || "", size: blob.size, bytes };
}

function decodeBlob(value) {
  if (!isEncodedBlob(value)) return value;
  const bytes = value.bytes instanceof Uint8Array ? value.bytes : new Uint8Array(value.bytes);
  return new Blob([bytes], { type: value.type });
}

/** Deep-copy structured-cloneable values, converting Blobs to bytes. */
async function encodeBlobs(value, seen = new WeakMap()) {
  if (isBlob(value)) return encodeBlob(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value;
  if (value instanceof Map) {
    const copy = new Map();
    seen.set(value, copy);
    for (const [key, item] of value) copy.set(await encodeBlobs(key, seen), await encodeBlobs(item, seen));
    return copy;
  }
  if (value instanceof Set) {
    const copy = new Set();
    seen.set(value, copy);
    for (const item of value) copy.add(await encodeBlobs(item, seen));
    return copy;
  }
  if (Array.isArray(value)) {
    const copy = [];
    seen.set(value, copy);
    for (const item of value) copy.push(await encodeBlobs(item, seen));
    return copy;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype === Object.prototype || prototype === null) {
    const copy = {};
    seen.set(value, copy);
    for (const [key, item] of Object.entries(value)) copy[key] = await encodeBlobs(item, seen);
    return copy;
  }
  return value;
}

/** Mirror of encodeBlobs: bytes become Blobs, legacy Blobs pass through. */
function decodeBlobs(value, seen = new WeakMap()) {
  if (isEncodedBlob(value)) return decodeBlob(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value;
  if (value instanceof Map) {
    const copy = new Map();
    seen.set(value, copy);
    for (const [key, item] of value) copy.set(decodeBlobs(key, seen), decodeBlobs(item, seen));
    return copy;
  }
  if (value instanceof Set) {
    const copy = new Set();
    seen.set(value, copy);
    for (const item of value) copy.add(decodeBlobs(item, seen));
    return copy;
  }
  if (Array.isArray(value)) {
    const copy = [];
    seen.set(value, copy);
    for (const item of value) copy.push(decodeBlobs(item, seen));
    return copy;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype === Object.prototype || prototype === null) {
    const copy = {};
    seen.set(value, copy);
    for (const [key, item] of Object.entries(value)) copy[key] = decodeBlobs(item, seen);
    return copy;
  }
  return value;
}

/* Earlier Chromium-era records can hold a real Blob. WebKit refuses to clone
   any Blob back into IndexedDB, so a metadata-only mutation (rename/move/trash/
   restore) must convert it first. Byte reading happens outside the transaction;
   the revision check and put remain inside one readwrite transaction. */
async function preparedLegacyBlob(database, id) {
  const blob = await runTransaction(database, [STORES.ENTRIES], "readonly", async (context) => {
    const entry = await context.get(STORES.ENTRIES, id);
    return entry && isBlob(entry.blob) ? entry.blob : null;
  });
  return blob ? encodeBlob(blob) : null;
}

function entryForPut(entry, prepared) {
  if (!prepared || !isBlob(entry.blob)) return entry;
  if (entry.blob.size !== prepared.size || entry.blob.type !== prepared.type) return entry;
  return { ...entry, blob: { ...prepared } };
}

function compareEntries(a, b) {
  if (isFolder(a) !== isFolder(b)) return isFolder(a) ? -1 : 1;
  const left = compareName(a.name);
  const right = compareName(b.name);
  if (left < right) return -1;
  if (left > right) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function cloneEntry(entry) {
  const copy = { ...entry };
  if (copy.blob !== undefined && copy.blob !== null) copy.blob = decodeBlobs(copy.blob);
  return copy;
}

function cloneDraft(draft) {
  return { ...draft, payload: decodeBlobs(draft.payload) };
}

/* ------------------------------------------------------------ open/upgrade -- */

function upgradeSchema(db) {
  if (!db.objectStoreNames.contains(STORES.ENTRIES)) {
    const entries = db.createObjectStore(STORES.ENTRIES, { keyPath: "id" });
    entries.createIndex("parentId", "parentId", { unique: false });
    entries.createIndex("trashedAt", "trashedAt", { unique: false });
  }
  if (!db.objectStoreNames.contains(STORES.DRAFTS)) {
    const drafts = db.createObjectStore(STORES.DRAFTS, { keyPath: "draftId" });
    drafts.createIndex("fileId", "fileId", { unique: false });
    drafts.createIndex("appId", "appId", { unique: false });
  }
  if (!db.objectStoreNames.contains(STORES.SETTINGS)) db.createObjectStore(STORES.SETTINGS, { keyPath: "key" });
  if (!db.objectStoreNames.contains(STORES.STICKY_NOTES)) db.createObjectStore(STORES.STICKY_NOTES, { keyPath: "id" });
}

/**
 * Open the Findows database. Rejects with a typed StorageError; callers that
 * need a working editor regardless should use createStorage(), which reports
 * temporary mode instead of throwing.
 */
export function openDatabase({ name = DB_NAME, version = DB_VERSION, factory = globalThis.indexedDB, timeoutMs = 4_000 } = {}) {
  return new Promise((resolveOpen, rejectOpen) => {
    if (!factory || typeof factory.open !== "function") {
      rejectOpen(
        fail(CODES.UNAVAILABLE, "IndexedDB is not available in this browser. Keep editing and download a copy; nothing will be saved.", {
          details: { reason: "absent" },
        }),
      );
      return;
    }

    let settled = false;
    let timer = null;
    const settle = (method, value) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      method(value);
    };

    let request;
    try {
      request = factory.open(name, version);
    } catch (error) {
      settle(rejectOpen, toStorageError(error));
      return;
    }

    timer = setTimeout(() => {
      settle(
        rejectOpen,
        fail(CODES.UNAVAILABLE, "Browser storage did not open; it may be blocked. Keep editing and download a copy.", {
          details: { reason: "timeout" },
        }),
      );
    }, timeoutMs);

    request.onupgradeneeded = () => {
      try {
        upgradeSchema(request.result);
      } catch (error) {
        try {
          request.transaction?.abort();
        } catch {
          /* already aborting */
        }
        settle(rejectOpen, toStorageError(error));
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        try {
          db.close();
        } catch {
          /* already closed */
        }
        return;
      }
      db.onversionchange = () => {
        try {
          db.close();
        } catch {
          /* already closed */
        }
      };
      settle(resolveOpen, db);
    };
    request.onerror = () => settle(rejectOpen, toStorageError(request.error));
    request.onblocked = () =>
      settle(
        rejectOpen,
        fail(CODES.UNAVAILABLE, "Browser storage is blocked by another tab or setting. Keep editing and download a copy.", {
          details: { reason: "blocked" },
        }),
      );
  });
}

/* ------------------------------------------------------------ transaction -- */

/**
 * Run work inside one transaction and resolve only when it completes.
 * work receives request helpers that keep every required request on the
 * active transaction. Nothing is decoded, hashed or awaited outside it.
 */
function runTransaction(db, storeNames, mode, work) {
  return new Promise((resolveWork, rejectWork) => {
    let transaction;
    try {
      transaction = db.transaction(storeNames, mode);
    } catch (error) {
      rejectWork(toStorageError(error));
      return;
    }

    let settled = false;
    let failure = null;
    let outcome;

    const noteFailure = (error) => {
      if (!failure) failure = toStorageError(error);
      try {
        transaction.abort();
      } catch {
        /* transaction already finished */
      }
    };

    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      if (failure) rejectWork(failure);
      else resolveWork(outcome);
    };
    transaction.onabort = () => {
      if (settled) return;
      settled = true;
      rejectWork(failure || toStorageError(transaction.error || { name: "AbortError" }));
    };
    transaction.onerror = (event) => {
      if (!failure) failure = toStorageError(transaction.error || event?.target?.error);
    };

    const context = {
      store: (name) => transaction.objectStore(name),
      get(name, key) {
        return new Promise((resolveRequest, rejectRequest) => {
          const request = transaction.objectStore(name).get(key);
          request.onsuccess = () => resolveRequest(request.result);
          request.onerror = () => rejectRequest(request.error);
        });
      },
      getAll(name) {
        return new Promise((resolveRequest, rejectRequest) => {
          const request = transaction.objectStore(name).getAll();
          request.onsuccess = () => resolveRequest(request.result);
          request.onerror = () => rejectRequest(request.error);
        });
      },
      getAllByIndex(name, indexName, key) {
        return new Promise((resolveRequest, rejectRequest) => {
          const request = transaction.objectStore(name).index(indexName).getAll(key);
          request.onsuccess = () => resolveRequest(request.result);
          request.onerror = () => rejectRequest(request.error);
        });
      },
      put(name, value) {
        return new Promise((resolveRequest, rejectRequest) => {
          const request = transaction.objectStore(name).put(value);
          request.onsuccess = () => resolveRequest(request.result);
          request.onerror = () => rejectRequest(request.error);
        });
      },
      delete(name, key) {
        return new Promise((resolveRequest, rejectRequest) => {
          const request = transaction.objectStore(name).delete(key);
          request.onsuccess = () => resolveRequest(undefined);
          request.onerror = () => rejectRequest(request.error);
        });
      },
    };

    Promise.resolve()
      .then(() => work(context))
      .then(
        (value) => {
          outcome = value;
        },
        (error) => noteFailure(error),
      );
  });
}

/* ---------------------------------------------------------- tree helpers -- */

async function inTrashSubtree(context, entry) {
  let current = entry;
  const seen = new Set();
  while (current) {
    if (current.trashedAt != null) return true;
    if (current.parentId == null) return false;
    if (seen.has(current.id)) return true; // corrupt ancestry is treated as inaccessible
    seen.add(current.id);
    current = await context.get(STORES.ENTRIES, current.parentId);
  }
  return false;
}

async function isSelfOrDescendant(context, candidate, ancestorId) {
  let current = candidate;
  const seen = new Set();
  while (current) {
    if (current.id === ancestorId) return true;
    if (current.parentId == null) return false;
    if (seen.has(current.id)) return true;
    seen.add(current.id);
    current = await context.get(STORES.ENTRIES, current.parentId);
  }
  return false;
}

async function assertNameAvailable(context, parentId, name, exceptId) {
  const children = await context.getAllByIndex(STORES.ENTRIES, "parentId", parentId);
  const wanted = compareName(name);
  const clash = children.find((child) => child.id !== exceptId && child.trashedAt == null && compareName(child.name) === wanted);
  if (clash) {
    throw fail(CODES.NAME_CONFLICT, `“${name}” already exists in this folder. Choose another name.`, {
      details: { parentId, name, existingId: clash.id },
    });
  }
}

function assertRevision(expectedRevision, entry) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw fail(CODES.INVALID, "A current revision number is required for this change.");
  }
  if (entry.revision !== expectedRevision) {
    throw fail(CODES.REVISION_CONFLICT, "This item changed elsewhere. Reload it or save a copy; nothing was overwritten.", {
      details: { expectedRevision, currentRevision: entry.revision },
    });
  }
}

async function requireEntry(context, id, { allowTrashed = false } = {}) {
  if (typeof id !== "string" || !id) throw fail(CODES.MISSING, "No file or folder was identified.");
  const entry = await context.get(STORES.ENTRIES, id);
  if (!entry) throw fail(CODES.MISSING, "That file or folder no longer exists.");
  if (!allowTrashed && (await inTrashSubtree(context, entry))) {
    throw fail(CODES.MISSING, "That item is in the Recycle Bin.");
  }
  return entry;
}

async function requireMutable(context, id, expectedRevision) {
  const entry = await requireEntry(context, id);
  if (isReservedId(entry.id)) throw fail(CODES.RESERVED, "This system folder cannot be changed.");
  assertRevision(expectedRevision, entry);
  return entry;
}

function validateImageMetadata(image) {
  if (image == null) return undefined;
  const width = Number(image.width);
  const height = Number(image.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw fail(CODES.INVALID, "Image dimensions are invalid.");
  }
  return { width, height };
}

function normalizeOrigin(origin, fallback) {
  if (origin === undefined || origin === null) return fallback;
  if (typeof origin !== "string" || !origin.trim() || origin.length > 40) {
    throw fail(CODES.INVALID, "A file origin must be a short label.");
  }
  return origin.trim();
}

function normalizeDraft(record, now) {
  if (!record || typeof record !== "object") throw fail(CODES.INVALID_DRAFT, "A draft record is required.");
  const { draftId, appId } = record;
  if (typeof draftId !== "string" || !draftId.trim()) throw fail(CODES.INVALID_DRAFT, "A draft needs its own draftId.");
  if (typeof appId !== "string" || !appId.trim()) throw fail(CODES.INVALID_DRAFT, "A draft needs an appId.");
  const fileId = record.fileId ?? null;
  if (fileId !== null && (typeof fileId !== "string" || !fileId)) throw fail(CODES.INVALID_DRAFT, "A draft fileId must be an id or null.");
  const baseRevision = record.baseRevision ?? null;
  if (fileId === null && baseRevision !== null) throw fail(CODES.INVALID_DRAFT, "An untitled draft cannot have a baseRevision.");
  if (fileId !== null && (!Number.isInteger(baseRevision) || baseRevision < 1)) {
    throw fail(CODES.INVALID_DRAFT, "A draft for an existing file needs its baseRevision.");
  }
  if (!("payload" in record) || record.payload === undefined) throw fail(CODES.INVALID_DRAFT, "A draft needs a payload.");
  const updatedAt = Number.isFinite(record.updatedAt) ? record.updatedAt : now();
  return { draftId, appId, fileId, baseRevision, payload: record.payload, updatedAt };
}

/* -------------------------------------------------------------- storage ---- */

/**
 * Create the persistence boundary. Opening is attempted immediately; failures
 * never throw, they surface as explicit temporary mode. `ready()` resolves to
 * 'persistent' or 'temporary' and is safe to await before first paint.
 */
export function createStorage(options = {}) {
  const {
    name = DB_NAME,
    version = DB_VERSION,
    factory = globalThis.indexedDB,
    seed = true,
    now = () => Date.now(),
    idFactory = () =>
      globalThis.crypto?.randomUUID?.() ??
      `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    openTimeoutMs = 4_000,
  } = options;

  let db = null;
  let mode = "temporary";
  let reason = "opening";
  let readyPromise = null;

  const begin = async () => {
    reason = "opening";
    if (db) {
      try {
        db.close();
      } catch {
        /* already closed */
      }
      db = null;
    }
    let opened = null;
    try {
      opened = await openDatabase({ name, version, factory, timeoutMs: openTimeoutMs });
      if (seed) await seedRoots(opened, now);
      db = opened;
      mode = "persistent";
      reason = null;
    } catch (error) {
      if (opened) {
        try {
          opened.close();
        } catch {
          /* already closed */
        }
      }
      db = null;
      mode = "temporary";
      reason = isStorageError(error) ? error.code : CODES.UNAVAILABLE;
      if (isStorageError(error) && error.details?.reason) reason = `${reason}:${error.details.reason}`;
    }
    return mode;
  };

  const requireDb = () => {
    if (!db) {
      throw fail(CODES.UNAVAILABLE, "Not saved — browser storage is unavailable. Keep editing and download a copy.", {
        details: { mode, reason },
      });
    }
    return db;
  };

  readyPromise = begin();

  async function seedRoots(database, timestamp) {
    const at = timestamp();
    const seeds = [
      { id: RESERVED.ROOT, parentId: null, name: "Findows" },
      { id: RESERVED.DESKTOP, parentId: RESERVED.ROOT, name: "Desktop" },
      { id: RESERVED.DOCUMENTS, parentId: RESERVED.ROOT, name: "Documents" },
      { id: RESERVED.PICTURES, parentId: RESERVED.ROOT, name: "Pictures" },
    ];
    await runTransaction(database, [STORES.ENTRIES], "readwrite", async (context) => {
      for (const seed of seeds) {
        const existing = await context.get(STORES.ENTRIES, seed.id);
        if (existing) continue;
        await context.put(STORES.ENTRIES, {
          id: seed.id,
          parentId: seed.parentId,
          name: seed.name,
          kind: "folder",
          mediaType: null,
          size: 0,
          createdAt: at,
          updatedAt: at,
          revision: 1,
          trashedAt: null,
          origin: null,
        });
      }
      return true;
    });
  }

  const storage = {
    getStorageMode() {
      return mode;
    },
    getModeReason() {
      return reason;
    },
    ready() {
      return readyPromise;
    },
    retry() {
      readyPromise = begin();
      return readyPromise;
    },
    close() {
      if (db) {
        try {
          db.close();
        } catch {
          /* already closed */
        }
      }
      db = null;
      mode = "temporary";
      reason = "closed";
    },

    async list(parentId) {
      const database = requireDb();
      return runTransaction(database, [STORES.ENTRIES], "readonly", async (context) => {
        const parent = await context.get(STORES.ENTRIES, parentId);
        if (!parent) throw fail(CODES.MISSING, "That folder no longer exists.");
        if (!isFolder(parent)) throw fail(CODES.INVALID_PARENT, "Only a folder can be listed.");
        if (await inTrashSubtree(context, parent)) throw fail(CODES.MISSING, "That folder is in the Recycle Bin.");
        const children = await context.getAllByIndex(STORES.ENTRIES, "parentId", parentId);
        return children
          .filter((entry) => entry.trashedAt == null)
          .sort(compareEntries)
          .map(cloneEntry);
      });
    },

    async listTrash() {
      const database = requireDb();
      return runTransaction(database, [STORES.ENTRIES], "readonly", async (context) => {
        const all = await context.getAll(STORES.ENTRIES);
        const byId = new Map(all.map((entry) => [entry.id, entry]));
        return all
          .filter((entry) => {
            if (entry.trashedAt == null) return false;
            const parent = entry.parentId == null ? null : byId.get(entry.parentId);
            return !parent || parent.trashedAt == null;
          })
          .sort(compareEntries)
          .map(cloneEntry);
      });
    },

    async read(id) {
      const database = requireDb();
      return runTransaction(database, [STORES.ENTRIES], "readonly", async (context) => {
        const entry = await requireEntry(context, id);
        return cloneEntry(entry);
      });
    },

    async create(input, { draftId = null } = {}) {
      if (!input || typeof input !== "object") throw fail(CODES.INVALID, "A file or folder description is required.");
      const displayName = validateName(input.name);
      const parentId = input.parentId;
      if (typeof parentId !== "string" || !parentId) throw fail(CODES.INVALID_PARENT, "A parent folder is required.");
      const kind = input.kind ?? (input.text != null || input.blob != null ? "file" : "folder");
      if (kind !== "file" && kind !== "folder") throw fail(CODES.INVALID, "Kind must be “file” or “folder”.");

      const id = input.id ?? idFactory();
      if (typeof id !== "string" || !id) throw fail(CODES.INVALID, "An item needs a stable id.");
      if (isReservedId(id)) throw fail(CODES.RESERVED, "That id belongs to a system folder.");

      const timestamp = now();
      let record;
      if (kind === "folder") {
        if (input.text != null || input.blob != null || input.mediaType != null) {
          throw fail(CODES.INVALID, "A folder cannot have content.");
        }
        record = {
          id,
          parentId,
          name: displayName,
          kind: "folder",
          mediaType: null,
          size: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
          revision: 1,
          trashedAt: null,
          origin: null,
        };
      } else {
        const hasText = input.text !== undefined && input.text !== null;
        const hasBlob = input.blob !== undefined && input.blob !== null;
        if (hasText === hasBlob) throw fail(CODES.INVALID, "A file needs exactly one of text or blob content.");
        let mediaType = typeof input.mediaType === "string" ? input.mediaType.trim().toLowerCase() : "";
        let size;
        if (hasText) {
          if (typeof input.text !== "string") throw fail(CODES.INVALID, "Text content must be a string.");
          mediaType = mediaType || "text/plain";
          if (!mediaType.startsWith("text/")) throw fail(CODES.INVALID, "Text files must use a text media type.");
          size = encoder.encode(input.text).length;
        } else {
          if (!isBlob(input.blob)) throw fail(CODES.INVALID, "Binary content must be a Blob.");
          mediaType = mediaType || input.blob.type;
          if (!mediaType) throw fail(CODES.INVALID, "Binary files need a media type.");
          if (mediaType.startsWith("text/")) throw fail(CODES.INVALID, "Use text content for a text file.");
          size = input.blob.size;
        }
        record = {
          id,
          parentId,
          name: displayName,
          kind: "file",
          mediaType,
          size,
          createdAt: timestamp,
          updatedAt: timestamp,
          revision: 1,
          trashedAt: null,
          origin: normalizeOrigin(input.origin, "created"),
        };
        if (hasText) record.text = input.text;
        else record.blob = await encodeBlob(input.blob);
        const image = validateImageMetadata(input.image);
        if (image) record.image = image;
      }

      const database = requireDb();
      const stores = draftId ? [STORES.ENTRIES, STORES.DRAFTS] : [STORES.ENTRIES];
      return runTransaction(database, stores, "readwrite", async (context) => {
        if (await context.get(STORES.ENTRIES, id)) {
          throw fail(CODES.EXISTS, "An item with that identity already exists.");
        }
        const parent = await context.get(STORES.ENTRIES, parentId);
        if (!parent || !isFolder(parent)) throw fail(CODES.INVALID_PARENT, "The destination folder does not exist.");
        if (await inTrashSubtree(context, parent)) throw fail(CODES.TRASHED, "The destination is in the Recycle Bin.");
        await assertNameAvailable(context, parentId, displayName, null);
        await context.put(STORES.ENTRIES, record);
        if (draftId) await context.delete(STORES.DRAFTS, draftId);
        return cloneEntry(record);
      });
    },

    async write(id, payload, expectedRevision, { draftId = null } = {}) {
      if (!payload || typeof payload !== "object") throw fail(CODES.INVALID, "A content payload is required.");
      const hasText = "text" in payload && payload.text !== undefined;
      const hasBlob = "blob" in payload && payload.blob !== undefined;
      if (hasText === hasBlob) throw fail(CODES.INVALID, "Write either text or blob content.");
      let preparedBlob = null;
      if (hasBlob) {
        if (!isBlob(payload.blob)) throw fail(CODES.INVALID, "Binary content must be a Blob.");
        preparedBlob = await encodeBlob(payload.blob);
      }
      const database = requireDb();
      const stores = draftId ? [STORES.ENTRIES, STORES.DRAFTS] : [STORES.ENTRIES];
      return runTransaction(database, stores, "readwrite", async (context) => {
        const entry = await requireMutable(context, id, expectedRevision);
        if (entry.kind !== "file") throw fail(CODES.INVALID, "Only a file can be written.");
        if (entry.origin === "import" && String(entry.mediaType || "").startsWith("image/")) {
          throw fail(CODES.READ_ONLY, "Imported image originals are read-only. Use Save As to make an editable copy.");
        }

        const updated = {
          ...entry,
          updatedAt: now(),
          revision: entry.revision + 1,
        };
        if (hasText) {
          if (typeof payload.text !== "string") throw fail(CODES.INVALID, "Text content must be a string.");
          if (!String(entry.mediaType || "").startsWith("text/")) {
            throw fail(CODES.INVALID, "This file does not accept text content.");
          }
          delete updated.blob;
          updated.text = payload.text;
          updated.size = encoder.encode(payload.text).length;
        } else {
          if (String(entry.mediaType || "").startsWith("text/")) {
            throw fail(CODES.INVALID, "This file does not accept binary content.");
          }
          delete updated.text;
          updated.blob = preparedBlob;
          updated.size = payload.blob.size;
        }
        if (payload.image !== undefined) {
          const image = validateImageMetadata(payload.image);
          if (image) updated.image = image;
        }

        await context.put(STORES.ENTRIES, updated);
        if (draftId) await context.delete(STORES.DRAFTS, draftId);
        return cloneEntry(updated);
      });
    },

    async rename(id, name, expectedRevision) {
      const displayName = validateName(name);
      const database = requireDb();
      const legacyBlob = await preparedLegacyBlob(database, id);
      return runTransaction(database, [STORES.ENTRIES], "readwrite", async (context) => {
        const entry = await requireMutable(context, id, expectedRevision);
        if (compareName(entry.name) === compareName(displayName)) return cloneEntry(entry);
        await assertNameAvailable(context, entry.parentId, displayName, entry.id);
        const updated = entryForPut({ ...entry, name: displayName, updatedAt: now(), revision: entry.revision + 1 }, legacyBlob);
        await context.put(STORES.ENTRIES, updated);
        return cloneEntry(updated);
      });
    },

    async move(id, parentId, expectedRevision) {
      if (typeof parentId !== "string" || !parentId) throw fail(CODES.INVALID_PARENT, "A destination folder is required.");
      const database = requireDb();
      const legacyBlob = await preparedLegacyBlob(database, id);
      return runTransaction(database, [STORES.ENTRIES], "readwrite", async (context) => {
        const entry = await requireMutable(context, id, expectedRevision);
        if (entry.parentId === parentId) return cloneEntry(entry);
        const destination = await context.get(STORES.ENTRIES, parentId);
        if (!destination || !isFolder(destination)) throw fail(CODES.INVALID_PARENT, "The destination folder does not exist.");
        if (await inTrashSubtree(context, destination)) throw fail(CODES.TRASHED, "The destination is in the Recycle Bin.");
        if (await isSelfOrDescendant(context, destination, entry.id)) {
          throw fail(CODES.CYCLE, "A folder cannot be moved into itself or its own subtree.");
        }
        await assertNameAvailable(context, parentId, entry.name, entry.id);
        const updated = entryForPut({ ...entry, parentId, updatedAt: now(), revision: entry.revision + 1 }, legacyBlob);
        await context.put(STORES.ENTRIES, updated);
        return cloneEntry(updated);
      });
    },

    async trash(id, expectedRevision) {
      const database = requireDb();
      const legacyBlob = await preparedLegacyBlob(database, id);
      return runTransaction(database, [STORES.ENTRIES], "readwrite", async (context) => {
        const entry = await requireMutable(context, id, expectedRevision);
        if (entry.trashedAt != null) throw fail(CODES.TRASHED, "That item is already in the Recycle Bin.");
        const timestamp = now();
        const updated = entryForPut({ ...entry, trashedAt: timestamp, updatedAt: timestamp, revision: entry.revision + 1 }, legacyBlob);
        await context.put(STORES.ENTRIES, updated);
        return cloneEntry(updated);
      });
    },

    async restore(id, expectedRevision, { name } = {}) {
      const database = requireDb();
      const legacyBlob = await preparedLegacyBlob(database, id);
      return runTransaction(database, [STORES.ENTRIES], "readwrite", async (context) => {
        const entry = await requireEntry(context, id, { allowTrashed: true });
        if (isReservedId(entry.id)) throw fail(CODES.RESERVED, "This system folder cannot be changed.");
        assertRevision(expectedRevision, entry);
        if (entry.trashedAt == null) throw fail(CODES.NOT_TRASHED, "That item is not in the Recycle Bin.");
        if (entry.parentId == null) throw fail(CODES.INVALID_PARENT, "A trashed item needs a restore destination.");

        const parent = await context.get(STORES.ENTRIES, entry.parentId);
        if (parent && parent.trashedAt != null) {
          throw fail(CODES.TRASHED, "Restore the containing folder first.");
        }

        const displayName = name === undefined ? entry.name : validateName(name);
        let destinationId = entry.parentId;
        let destination = parent;
        let usedSafeParent = false;
        if (!destination || !isFolder(destination) || (await inTrashSubtree(context, destination))) {
          destinationId = SAFE_RESTORE_PARENT_ID;
          destination = await context.get(STORES.ENTRIES, destinationId);
          usedSafeParent = true;
        }
        if (!destination || !isFolder(destination)) throw fail(CODES.INVALID_PARENT, "No safe restore folder is available.");
        await assertNameAvailable(context, destinationId, displayName, entry.id);

        const timestamp = now();
        const updated = entryForPut({
          ...entry,
          parentId: destinationId,
          name: displayName,
          trashedAt: null,
          updatedAt: timestamp,
          revision: entry.revision + 1,
        }, legacyBlob);
        await context.put(STORES.ENTRIES, updated);
        return { entry: cloneEntry(updated), destinationId, usedSafeParent };
      });
    },

    async purge(id, expectedRevision) {
      const database = requireDb();
      return runTransaction(database, [STORES.ENTRIES], "readwrite", async (context) => {
        const entry = await requireEntry(context, id, { allowTrashed: true });
        if (isReservedId(entry.id)) throw fail(CODES.RESERVED, "This system folder cannot be changed.");
        assertRevision(expectedRevision, entry);
        if (entry.trashedAt == null) throw fail(CODES.NOT_TRASHED, "Only an item in the Recycle Bin can be deleted permanently.");
        if (entry.parentId != null) {
          const parent = await context.get(STORES.ENTRIES, entry.parentId);
          if (parent && parent.trashedAt != null) {
            throw fail(CODES.NOT_TRASHED, "Only a Recycle Bin root can be deleted permanently.");
          }
        }

        const purgedIds = [];
        const queue = [entry.id];
        const seen = new Set();
        while (queue.length) {
          const currentId = queue.shift();
          if (seen.has(currentId)) continue;
          seen.add(currentId);
          purgedIds.push(currentId);
          if (currentId === entry.id && entry.kind !== "folder") continue;
          const children = await context.getAllByIndex(STORES.ENTRIES, "parentId", currentId);
          for (const child of children) queue.push(child.id);
        }
        for (const purgedId of purgedIds) await context.delete(STORES.ENTRIES, purgedId);
        return { purgedIds };
      });
    },

    async listDrafts() {
      const database = requireDb();
      return runTransaction(database, [STORES.DRAFTS], "readonly", async (context) => {
        const drafts = await context.getAll(STORES.DRAFTS);
        return drafts.sort((a, b) => b.updatedAt - a.updatedAt).map(cloneDraft);
      });
    },

    async readDraft(draftId) {
      const database = requireDb();
      return runTransaction(database, [STORES.DRAFTS], "readonly", async (context) => {
        const draft = await context.get(STORES.DRAFTS, draftId);
        return draft ? cloneDraft(draft) : null;
      });
    },

    async putDraft(record) {
      const draft = normalizeDraft(record, now);
      const stored = { ...draft, payload: await encodeBlobs(draft.payload) };
      const database = requireDb();
      return runTransaction(database, [STORES.DRAFTS], "readwrite", async (context) => {
        await context.put(STORES.DRAFTS, stored);
        return cloneDraft(stored);
      });
    },

    async deleteDraft(draftId) {
      if (typeof draftId !== "string" || !draftId) return false;
      const database = requireDb();
      return runTransaction(database, [STORES.DRAFTS], "readwrite", async (context) => {
        const existing = await context.get(STORES.DRAFTS, draftId);
        if (!existing) return false;
        await context.delete(STORES.DRAFTS, draftId);
        return true;
      });
    },
  };

  return storage;
}
