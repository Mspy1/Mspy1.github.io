/* The one real Gate 1 app: a complete, readable Help & About document.
   All content is built with textContent — no untrusted markup is interpreted. */

const section = (title, lines) => {
  const el = document.createElement("section");
  el.className = "help-section";
  const h = document.createElement("h2");
  h.textContent = title;
  el.append(h);
  for (const line of lines) {
    const p = document.createElement("p");
    p.textContent = line;
    el.append(p);
  }
  return el;
};

const keys = (pairs) => {
  const list = document.createElement("ul");
  list.className = "help-keys";
  for (const [key, description] of pairs) {
    const li = document.createElement("li");
    const kbd = document.createElement("kbd");
    kbd.textContent = key;
    const span = document.createElement("span");
    span.textContent = description;
    li.append(kbd, span);
    list.append(li);
  }
  return list;
};

export async function mount({ container, windowId, fileId, services, signal } = {}) {
  if (signal?.aborted) throw new DOMException("Help window was closed while loading", "AbortError");

  const doc = document.createElement("div");
  doc.className = "help-doc";
  doc.dataset.windowId = windowId || "";

  const header = document.createElement("header");
  header.className = "help-header";
  const eyebrow = document.createElement("span");
  eyebrow.className = "help-eyebrow";
  eyebrow.textContent = "Findows · guide";
  const title = document.createElement("h1");
  title.textContent = "Help & About";
  title.tabIndex = -1;
  const lead = document.createElement("p");
  lead.textContent = "A small desktop that lives in this browser tab. Everything below works with a keyboard, touch or a mouse.";
  header.append(eyebrow, title, lead);
  doc.append(header);

  const grid = document.createElement("div");
  grid.className = "help-grid";

  const left = document.createElement("div");
  left.className = "help-col";
  left.append(
    section("Get around", []),
  );
  left.lastChild.append(
    keys([
      ["Tab", "Move between the Start button, search, results, taskbar and window buttons."],
      ["Enter", "Open the focused app or activate the focused button."],
      ["↑ / ↓", "Move through Start results before pressing Enter."],
      ["Esc", "Close the Start menu or the task switcher. It never closes a window."],
    ]),
  );
  left.append(
    section("Windows", [
      "Click an inactive window to bring it forward. Use the title-bar buttons to minimize, maximize, restore or close it.",
      "Minimizing keeps the app exactly as you left it. The taskbar restores it; the task switcher is there when windows overlap.",
      "On a wide screen you can snap a window to either half by dragging it to an edge or using the title-bar controls.",
    ]),
  );

  const right = document.createElement("div");
  right.className = "help-col";
  right.append(
    section("On a phone", [
      "Below 768px — or in a short landscape window — Findows shows one app at a time. Your other apps stay open and keep their state.",
      "Use the task switcher in the taskbar to change apps. Dismiss the on-screen keyboard to reach Start or Back to Mspy1.",
    ]),
    section("Your data stays local", [
      "Saving keeps your work in this browser on this device. Nothing is uploaded, and local saving is not a backup or cloud sync.",
      "To keep a copy outside Findows, use an app's Download a copy action where it is offered. Clearing this site's browser data removes locally saved work.",
      "If storage is unavailable, an app will say so plainly; downloads still work.",
    ]),
    section("What this is", [
      "Findows is an original browser desktop made by Mspy1. It is not Microsoft Windows, not an operating system, and it cannot see your files or run commands on your device.",
      "It is a simulation built from plain HTML, CSS and JavaScript, with no account, no tracking and no third-party services.",
    ]),
  );

  const footer = document.createElement("footer");
  footer.className = "help-footer";
  const note = document.createElement("span");
  note.textContent = "Browser simulation · local build";
  const exit = document.createElement("a");
  exit.href = "/#findows-easter-egg";
  exit.textContent = "Back to Mspy1";
  footer.append(note, exit);

  grid.append(left, right);
  doc.append(grid, footer);
  container.replaceChildren(doc);

  let disposed = false;
  const onAbort = () => dispose();
  signal?.addEventListener?.("abort", onAbort, { once: true });

  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener?.("abort", onAbort);
    doc.remove();
  }

  return {
    canClose: () => true,
    focus: () => title.focus({ preventScroll: true }),
    dispose,
  };
}

export default { mount };
