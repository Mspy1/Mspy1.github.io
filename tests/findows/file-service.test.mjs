/* Gate 2: the file service façade that apps and the shell consume. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ASSOCIATIONS,
  associationFor,
  createDraft,
  createFileService,
  draftRecovery,
  isSupportedMediaType,
  newDraftId,
} from "../../findows/js/file-service.mjs";
import { STORAGE_CODES, StorageError } from "../../findows/js/storage.mjs";

function fakeStorage(overrides = {}) {
  const calls = [];
  const method = (name) => (...args) => {
    calls.push({ name, args });
    return Promise.resolve(args[0] ?? name);
  };
  const storage = {
    calls,
    list: method("list"),
    listTrash: method("listTrash"),
    read: method("read"),
    create: method("create"),
    write: method("write"),
    rename: method("rename"),
    move: method("move"),
    trash: method("trash"),
    restore: method("restore"),
    purge: method("purge"),
    listDrafts: method("listDrafts"),
    readDraft: method("readDraft"),
    putDraft: method("putDraft"),
    deleteDraft: method("deleteDraft"),
    getStorageMode: () => "persistent",
    ready: () => Promise.resolve("persistent"),
    retry: () => Promise.resolve("persistent"),
    close: () => {},
    ...overrides,
  };
  return storage;
}

test("default associations map folders and supported media types to real apps", () => {
  assert.deepEqual(associationFor({ kind: "folder" }), { appId: "files", mode: "browse" });
  assert.deepEqual(associationFor({ kind: "file", mediaType: "text/plain" }), { appId: "notepad", mode: "edit" });
  for (const mediaType of ["image/png", "image/jpeg", "image/webp"]) {
    assert.deepEqual(associationFor({ kind: "file", mediaType }), { appId: "paint", mode: "edit" });
  }
  assert.equal(associationFor({ kind: "file", mediaType: "application/pdf" }), null);
  assert.equal(associationFor(null), null);
  assert.equal(Object.isFrozen(ASSOCIATIONS), true);
  assert.equal(isSupportedMediaType("TEXT/PLAIN"), true);
  assert.equal(isSupportedMediaType("image/gif"), false);
});

test("Photo Viewer is read-only only for imported originals; Paint-created PNGs stay editable", () => {
  const imported = { kind: "file", mediaType: "image/png", origin: "import" };
  const painted = { kind: "file", mediaType: "image/png", origin: "paint" };
  const created = { kind: "file", mediaType: "image/png", origin: "created" };
  const unknown = { kind: "file", mediaType: "image/png" };
  assert.deepEqual(associationFor(imported, { photoViewer: true }), { appId: "photo-viewer", mode: "view" });
  assert.deepEqual(associationFor(painted, { photoViewer: true }), { appId: "paint", mode: "edit" }, "Paint output must reopen for revision-checked editing");
  assert.deepEqual(associationFor(created, { photoViewer: true }), { appId: "paint", mode: "edit" });
  assert.deepEqual(associationFor(unknown, { photoViewer: true }), { appId: "paint", mode: "edit" }, "no origin label is not proof of an import");
  for (const entry of [imported, painted, created]) {
    assert.deepEqual(associationFor(entry), { appId: "paint", mode: "edit" }, "viewer flag off keeps Paint editing");
  }
});

test("createFileService delegates every file and draft operation with exact arguments", async () => {
  const storage = fakeStorage();
  const service = createFileService({ storage });
  assert.equal(service.storage, storage);
  assert.equal(service.getStorageMode(), "persistent");

  await service.list("documents");
  await service.read("f1");
  await service.create({ parentId: "documents", name: "a.txt", text: "a" }, { draftId: "d1" });
  await service.write("f1", { text: "b" }, 2, { draftId: "d1" });
  await service.rename("f1", "b.txt", 3);
  await service.move("f1", "pictures", 4);
  await service.trash("f1", 5);
  await service.restore("f1", 6, { name: "c.txt" });
  await service.purge("f1", 7);
  await service.listDrafts();
  await service.readDraft("d1");
  await service.putDraft({ draftId: "d1" });
  await service.deleteDraft("d1");

  assert.deepEqual(
    storage.calls.map((call) => call.name),
    [
      "list", "read", "create", "write", "rename", "move", "trash",
      "restore", "purge", "listDrafts", "readDraft", "putDraft", "deleteDraft",
    ],
  );
  const write = storage.calls.find((call) => call.name === "write");
  assert.deepEqual(write.args, ["f1", { text: "b" }, 2, { draftId: "d1" }]);
  const restore = storage.calls.find((call) => call.name === "restore");
  assert.deepEqual(restore.args, ["f1", 6, { name: "c.txt" }]);
});

test("getAppForFile resolves through the service and supports an injected registry mapping", () => {
  const service = createFileService({ storage: fakeStorage() });
  assert.deepEqual(service.getAppForFile({ kind: "file", mediaType: "text/plain" }), { appId: "notepad", mode: "edit" });
  const custom = createFileService({
    storage: fakeStorage(),
    resolveApp: (entry) => (entry.kind === "folder" ? { appId: "files", mode: "browse" } : { appId: "custom", mode: "view" }),
  });
  assert.deepEqual(custom.getAppForFile({ kind: "file", mediaType: "text/plain" }), { appId: "custom", mode: "view" });
});

test("per-editor draft ids are unique even for the same saved file", () => {
  const a = newDraftId("notepad");
  const b = newDraftId("notepad");
  assert.notEqual(a, b);
  assert.match(a, /^notepad[:-]/);
  assert.throws(() => newDraftId(""), /app/i);
});

test("createDraft builds the contract record and validates the file/revision pairing", () => {
  const draft = createDraft({ appId: "notepad", fileId: "f1", baseRevision: 3, payload: { text: "hello" }, updatedAt: 1234 });
  assert.equal(draft.appId, "notepad");
  assert.equal(draft.fileId, "f1");
  assert.equal(draft.baseRevision, 3);
  assert.deepEqual(draft.payload, { text: "hello" });
  assert.equal(draft.updatedAt, 1234);
  assert.ok(draft.draftId);

  const untitled = createDraft({ appId: "notepad", payload: { text: "" } });
  assert.equal(untitled.fileId, null);
  assert.equal(untitled.baseRevision, null);

  assert.throws(() => createDraft({ appId: "notepad", fileId: "f1", payload: {} }), /baseRevision/i);
  assert.throws(() => createDraft({ appId: "notepad", baseRevision: 2, payload: {} }), /fileId/i);
  assert.throws(() => createDraft({ appId: "", payload: {} }), /appId/i);
});

test("draft recovery never offers a silent overwrite of newer saved content", () => {
  const draft = { draftId: "d1", appId: "notepad", fileId: "f1", baseRevision: 2, payload: { text: "draft" } };
  assert.deepEqual(draftRecovery(draft, { id: "f1", revision: 2 }), { state: "current", action: "resume", currentRevision: 2 });
  assert.deepEqual(draftRecovery(draft, { id: "f1", revision: 5 }), { state: "stale", action: "review", currentRevision: 5 });
  assert.deepEqual(draftRecovery(draft, null), { state: "orphaned", action: "save-copy", currentRevision: null });
  assert.deepEqual(
    draftRecovery({ ...draft, fileId: null, baseRevision: null }, null),
    { state: "unsaved", action: "resume", currentRevision: null },
  );
});

test("temporary storage failures pass through the service unchanged", async () => {
  const unavailable = (name) => async () => {
    throw new StorageError(STORAGE_CODES.UNAVAILABLE, "Not saved — download a copy.");
  };
  const storage = fakeStorage({
    list: unavailable("list"),
    create: unavailable("create"),
    write: unavailable("write"),
    ready: () => Promise.resolve("temporary"),
    getStorageMode: () => "temporary",
  });
  const service = createFileService({ storage });
  assert.equal(await service.ready(), "temporary");
  assert.equal(service.getStorageMode(), "temporary");
  for (const attempt of [service.list("documents"), service.create({ name: "a.txt" }), service.write("f1", { text: "x" }, 1)]) {
    await assert.rejects(attempt, (error) => error.code === STORAGE_CODES.UNAVAILABLE);
  }
});
