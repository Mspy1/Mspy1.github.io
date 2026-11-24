/* Sticky Notes persistence: a separate connection to the same `findows` database,
   limited to the existing `stickyNotes` object store. Files, drafts, settings and
   the database itself are never touched. Every mutation takes an expected
   revision, reads and writes inside one transaction, and resolves on completion. */

import { openDatabase, STORES, STORAGE_CODES, StorageError } from "../storage.mjs";
import { NOTE_LIMITS, buildNote, nextRevision, sanitizeColor, sanitizeText, sortNotes } from "./sticky-logic.mjs";

const fail = (code, message) => new StorageError(code, message);

function toError(error) {
  if (error instanceof StorageError) return error;
  if (error?.name === "QuotaExceededError") {
    return fail(STORAGE_CODES.QUOTA, "Browser storage is full. The note was not saved; export a copy.");
  }
  if (error?.name === "AbortError") return fail(STORAGE_CODES.ABORTED, "The storage transaction was aborted; nothing was saved.");
  return fail(STORAGE_CODES.UNAVAILABLE, error?.message || "Local storage is unavailable.");
}

/** Resolve only when the transaction completes; abort on any failed request. */
function run(db, work) {
  return new Promise((resolveWork, rejectWork) => {
    let transaction;
    try {
      transaction = db.transaction([STORES.STICKY_NOTES], "readwrite");
    } catch (error) {
      rejectWork(toError(error));
      return;
    }
    let settled = false;
    let failure = null;
    let outcome;
    const noteFailure = (error) => {
      if (!failure) failure = toError(error);
      try { transaction.abort(); } catch { /* already aborted */ }
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
      rejectWork(failure || toError(transaction.error || { name: "AbortError" }));
    };
    transaction.onerror = (event) => {
      if (!failure) failure = toError(transaction.error || event?.target?.error);
    };

    const store = () => transaction.objectStore(STORES.STICKY_NOTES);
    const context = {
      get(id) {
        return new Promise((resolveRequest, rejectRequest) => {
          const request = store().get(id);
          request.onsuccess = () => resolveRequest(request.result);
          request.onerror = () => rejectRequest(request.error);
        });
      },
      getAll() {
        return new Promise((resolveRequest, rejectRequest) => {
          const request = store().getAll();
          request.onsuccess = () => resolveRequest(request.result);
          request.onerror = () => rejectRequest(request.error);
        });
      },
      put(note) {
        return new Promise((resolveRequest, rejectRequest) => {
          const request = store().put(note);
          request.onsuccess = () => resolveRequest(request.result);
          request.onerror = () => rejectRequest(request.error);
        });
      },
      remove(id) {
        return new Promise((resolveRequest, rejectRequest) => {
          const request = store().delete(id);
          request.onsuccess = () => resolveRequest(undefined);
          request.onerror = () => rejectRequest(request.error);
        });
      },
    };
    Promise.resolve()
      .then(() => work(context))
      .then((value) => { outcome = value; }, noteFailure);
  });
}

/**
 * Open (or adopt) the Findows database and expose only sticky-note operations.
 * Open failure yields an explicit temporary store whose methods reject with a
 * typed error; editing and export remain the caller's responsibility.
 */
export async function openStickyStore({
  db = null,
  factory,
  timeoutMs,
  now = () => Date.now(),
  idFactory = () => `note-${Date.now().toString(36)}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`,
} = {}) {
  let database = db;
  let mode = "persistent";
  let openError = null;
  if (!database) {
    try {
      database = await openDatabase({ factory, timeoutMs });
    } catch (error) {
      openError = toError(error);
      mode = "temporary";
      database = null;
    }
  }
  const requireDb = () => {
    if (!database) throw openError || fail(STORAGE_CODES.UNAVAILABLE, "Local storage is unavailable.");
    return database;
  };

  const list = async () => sortNotes(await run(requireDb(), (ctx) => ctx.getAll()));

  const create = (input = {}) => {
    const id = typeof input.id === "string" && input.id ? input.id : idFactory();
    return run(requireDb(), async (ctx) => {
      const all = await ctx.getAll();
      if (all.length >= NOTE_LIMITS.MAX_NOTES) {
        throw fail(STORAGE_CODES.INVALID, `You can keep up to ${NOTE_LIMITS.MAX_NOTES} notes in this browser.`);
      }
      if (await ctx.get(id)) throw fail(STORAGE_CODES.EXISTS, "A note with that id already exists.");
      const timestamp = now();
      const note = buildNote({ ...input, id, createdAt: timestamp, updatedAt: timestamp, revision: 1 });
      await ctx.put(note);
      return { ...note };
    });
  };

  const update = (id, patch = {}, expectedRevision) =>
    run(requireDb(), async (ctx) => {
      const existing = await ctx.get(id);
      if (!existing) throw fail(STORAGE_CODES.MISSING, "That note is no longer available.");
      if (existing.revision !== expectedRevision) {
        throw fail(STORAGE_CODES.REVISION_CONFLICT, "Another window changed this note. Nothing was overwritten.");
      }
      const updated = {
        ...existing,
        text: "text" in patch ? sanitizeText(patch.text) : existing.text,
        color: "color" in patch ? sanitizeColor(patch.color) : existing.color,
        pinned: "pinned" in patch ? Boolean(patch.pinned) : existing.pinned,
        revision: nextRevision(existing),
        updatedAt: now(),
      };
      await ctx.put(updated);
      return { ...updated };
    });

  const remove = (id, expectedRevision) =>
    run(requireDb(), async (ctx) => {
      const existing = await ctx.get(id);
      if (!existing) throw fail(STORAGE_CODES.MISSING, "That note is no longer available.");
      if (existing.revision !== expectedRevision) {
        throw fail(STORAGE_CODES.REVISION_CONFLICT, "Another window changed this note. Nothing was deleted.");
      }
      await ctx.remove(id);
      return { ...existing };
    });

  const restore = (deleted = {}) => {
    if (!deleted.id) return Promise.reject(fail(STORAGE_CODES.INVALID, "A deleted note needs an id."));
    return run(requireDb(), async (ctx) => {
      const existing = await ctx.get(deleted.id);
      if (existing) throw fail(STORAGE_CODES.REVISION_CONFLICT, "That id is already in use. Nothing was restored.");
      const restored = buildNote({
        ...deleted,
        revision: nextRevision(deleted),
        createdAt: deleted.createdAt,
        updatedAt: now(),
      });
      await ctx.put(restored);
      return { ...restored };
    });
  };

  return {
    getMode: () => mode,
    ready: async () => mode,
    list,
    create,
    update,
    remove,
    restore,
    close() {
      try { database?.close?.(); } catch { /* already closed */ }
      database = null;
      mode = "temporary";
    },
  };
}

export default { openStickyStore };
