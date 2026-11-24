/* Gate 2: pure storage contract + explicit temporary mode.
   IndexedDB itself is exercised in tests/findows/storage-browser.mjs (real browser). */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DB_NAME,
  DB_VERSION,
  RESERVED,
  SAFE_RESTORE_PARENT_ID,
  STORAGE_CODES,
  StorageError,
  compareName,
  createStorage,
  isReservedId,
  isStorageError,
  openDatabase,
  validateName,
} from "../../findows/js/storage.mjs";

test("the database identity and reserved roots match the approved contract", () => {
  assert.equal(DB_NAME, "findows");
  assert.equal(DB_VERSION, 1);
  assert.deepEqual({ ...RESERVED }, {
    ROOT: "root",
    DESKTOP: "desktop",
    DOCUMENTS: "documents",
    PICTURES: "pictures",
  });
  assert.equal(SAFE_RESTORE_PARENT_ID, RESERVED.DOCUMENTS);
  assert.equal(Object.isFrozen(RESERVED), true);
  assert.equal(isReservedId("root"), true);
  assert.equal(isReservedId("pictures"), true);
  assert.equal(isReservedId("Root"), false, "reserved ids are exact and immutable");
  assert.equal(isReservedId("root/child"), false);
});

test("name comparison is case-insensitive, Unicode-normalized and display-preserving", () => {
  assert.equal(compareName("Cafe\u0301.TXT"), compareName("caf\u00e9.txt"));
  assert.equal(compareName("  NOTES "), "notes");
  assert.equal(validateName("  My Note.txt  "), "My Note.txt", "display spelling is preserved");
  assert.equal(validateName("Caf\u00e9.txt"), "Caf\u00e9.txt");
});

test("traversal-looking, empty, separator and control names are rejected as INVALID_NAME", () => {
  for (const bad of ["", "   ", ".", "..", "../escape", "a/b", "a\\b", "line\nbreak", "nul\u0000byte", "x".repeat(256)]) {
    assert.throws(
      () => validateName(bad),
      (error) => isStorageError(error) && error.code === STORAGE_CODES.INVALID_NAME,
      `rejects ${JSON.stringify(bad)}`,
    );
  }
  assert.equal(validateName("x".repeat(255)).length, 255, "255 characters is allowed");
  assert.throws(() => validateName(42), (error) => error.code === STORAGE_CODES.INVALID_NAME);
});

test("StorageError carries a stable code, message and optional details", () => {
  const error = new StorageError(STORAGE_CODES.REVISION_CONFLICT, "Changed elsewhere.", {
    details: { expectedRevision: 1, currentRevision: 2 },
  });
  assert.equal(error.name, "StorageError");
  assert.equal(error.code, "REVISION_CONFLICT");
  assert.equal(error.message, "Changed elsewhere.");
  assert.deepEqual(error.details, { expectedRevision: 1, currentRevision: 2 });
  assert.equal(isStorageError(error), true);
  assert.equal(isStorageError(new Error("nope")), false);
  assert.equal(Object.isFrozen(STORAGE_CODES), true);
});

test("without IndexedDB storage opens in explicit temporary mode and rejects persistent work", async () => {
  const storage = createStorage({ factory: undefined, seed: false });
  assert.equal(await storage.ready(), "temporary");
  assert.equal(storage.getStorageMode(), "temporary");
  const failure = await storage.list(RESERVED.ROOT).catch((error) => error);
  assert.equal(failure.code, STORAGE_CODES.UNAVAILABLE);
  assert.match(failure.message, /temporary|unavailable|export/i);
  const create = await storage
    .create({ parentId: RESERVED.DOCUMENTS, name: "a.txt", kind: "file", text: "a" })
    .catch((error) => error);
  assert.equal(create.code, STORAGE_CODES.UNAVAILABLE);
  assert.equal(storage.getStorageMode(), "temporary", "mode stays explicit after a rejection");
});

test("a factory that fails to open also yields temporary mode instead of throwing", async () => {
  const denied = {
    open() {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
  };
  const storage = createStorage({ factory: denied, seed: false });
  assert.equal(await storage.ready(), "temporary");
  assert.equal(storage.getStorageMode(), "temporary");
});

test("openDatabase reports UNAVAILABLE when IndexedDB is absent", async () => {
  await assert.rejects(
    openDatabase({ factory: undefined }),
    (error) => isStorageError(error) && error.code === STORAGE_CODES.UNAVAILABLE,
  );
});

test("draft helpers are exposed on the storage boundary", () => {
  const storage = createStorage({ factory: undefined, seed: false });
  for (const method of [
    "list",
    "listTrash",
    "read",
    "create",
    "write",
    "rename",
    "move",
    "trash",
    "restore",
    "purge",
    "listDrafts",
    "readDraft",
    "putDraft",
    "deleteDraft",
    "getStorageMode",
    "ready",
    "retry",
    "close",
  ]) {
    assert.equal(typeof storage[method], "function", `${method} is exported`);
  }
});
