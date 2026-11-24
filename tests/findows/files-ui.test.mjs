/* Files UI helpers — pure logic, no DOM. Dev-only tests.
   Run: node --test tests/findows/files-ui.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";

import {
  TRASH_ID,
  buildCrumbs,
  formatSize,
  formatTypedError,
  isTrashId,
  mediaTypeLabel,
  moveTargets,
  safeFilename,
} from "../../findows/js/apps/files-helpers.mjs";

test("Trash is a virtual location id, not a stored folder", () => {
  assert.equal(TRASH_ID, "__trash__");
  assert.equal(isTrashId(TRASH_ID), true);
  assert.equal(isTrashId("documents"), false);
});

test("formatSize gives human sizes and never invents folder content", () => {
  assert.equal(formatSize(0), "0 bytes");
  assert.equal(formatSize(5), "5 bytes");
  assert.equal(formatSize(1024), "1.0 KB");
  assert.equal(formatSize(1536), "1.5 KB");
  assert.equal(formatSize(2 * 1024 * 1024), "2.0 MB");
  assert.equal(formatSize("nonsense"), "0 bytes");
});

test("mediaTypeLabel describes only supported real types", () => {
  assert.equal(mediaTypeLabel({ kind: "folder" }), "Folder");
  assert.equal(mediaTypeLabel({ kind: "file", mediaType: "text/plain" }), "Text document");
  assert.equal(mediaTypeLabel({ kind: "file", mediaType: "image/png" }), "PNG image");
  assert.equal(mediaTypeLabel({ kind: "file", mediaType: "image/jpeg" }), "JPEG image");
  assert.equal(mediaTypeLabel({ kind: "file", mediaType: "image/webp" }), "WebP image");
  assert.equal(mediaTypeLabel({ kind: "file", mediaType: "application/pdf" }), "File");
});

test("safeFilename strips path/control characters and appends the real extension", () => {
  assert.equal(safeFilename("My note: v1.txt", "text/plain"), "My_note__v1.txt");
  assert.equal(safeFilename("../../evil", "text/plain"), "evil.txt");
  assert.equal(safeFilename("  ..  ", "image/png"), "download.png");
  assert.equal(safeFilename("photo.jpeg", "image/jpeg"), "photo.jpeg");
  assert.equal(safeFilename("pic", "image/webp"), "pic.webp");
  assert.equal(safeFilename("CON", "text/plain"), "_CON.txt");
  assert.equal(safeFilename(" weird\u0000name ", "text/plain"), "weird_name.txt");
  assert.equal(safeFilename("a".repeat(300), "text/plain").endsWith(".txt"), true);
  assert.ok(safeFilename("a".repeat(300), "text/plain").length <= 200);
});

test("formatTypedError keeps typed storage codes visible", () => {
  const typed = Object.assign(new Error("already exists"), { code: "NAME_CONFLICT" });
  assert.equal(formatTypedError(typed), "NAME_CONFLICT: already exists");
  assert.equal(formatTypedError(new Error("offline")), "offline");
  assert.equal(formatTypedError(null), "Something went wrong.");
});

test("buildCrumbs walks parent ids root-first without reconstructing paths", () => {
  const byId = new Map([
    ["root", { id: "root", parentId: null, name: "Findows" }],
    ["documents", { id: "documents", parentId: "root", name: "Documents" }],
    ["project", { id: "project", parentId: "documents", name: "Project" }],
  ]);
  assert.deepEqual(buildCrumbs(byId, "project"), [
    { id: "root", name: "Findows" },
    { id: "documents", name: "Documents" },
    { id: "project", name: "Project" },
  ]);
  assert.deepEqual(buildCrumbs(byId, "root"), [{ id: "root", name: "Findows" }]);
});

test("moveTargets excludes the moved folder and its descendants, with readable paths", () => {
  const folders = [
    { id: "root", parentId: null, name: "Findows" },
    { id: "documents", parentId: "root", name: "Documents" },
    { id: "pictures", parentId: "root", name: "Pictures" },
    { id: "project", parentId: "documents", name: "Project" },
    { id: "sub", parentId: "project", name: "Sub" },
  ];
  const targets = moveTargets(folders, { excludeId: "project" });
  assert.deepEqual(targets.map((target) => target.id), ["root", "documents", "pictures"]);
  assert.deepEqual(targets.map((target) => target.path), ["Findows", "Findows / Documents", "Findows / Pictures"]);
  assert.deepEqual(moveTargets(folders, { excludeId: "txt-1" }).map((target) => target.id), folders.map((folder) => folder.id));
});
