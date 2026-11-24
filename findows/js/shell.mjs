/* DOM shell: wallpaper, shortcuts, Start, taskbar, windows and layout.
   It renders window-manager state; it never owns window state itself. */

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

const iconFor = (app) => {
  const img = el("img", "fw-icon");
  img.src = `assets/icon-${app.icon}.svg`;
  img.alt = "";
  img.setAttribute("aria-hidden", "true");
  img.draggable = false;
  return img;
};

export function createShell({ root, registry, wm, services = {} } = {}) {
  if (!root) throw new Error("Shell needs a root element");
  const $ = (id) => root.querySelector(`#${id}`);
  const desktop = root;
  const windowsLayer = $("fw-windows");
  const shortcutsLayer = $("fw-shortcuts");
  const taskItems = $("fw-task-items");
  const startButton = $("fw-start");
  const startPanel = $("fw-start-panel");
  const search = $("fw-search");
  const results = $("fw-results");
  const switcherButton = $("fw-switcher");
  const switcherPanel = $("fw-switcher-panel");
  const switcherList = $("fw-switcher-list");
  const clock = $("fw-clock");
  const notice = $("fw-notice");
  const exitLink = $("fw-exit");

  const frames = new Map();
  const instances = new Map(); // windowId → { abort, handle, appId, fileId, loading }
  const launchers = new Map(); // windowId → element that opened it
  let compact = false;
  let startOpen = false;
  let switcherOpen = false;
  let activeResult = -1;
  let clockTimer = null;
  let stopPreferences = null;
  let stopWindows = null;
  let stopVisualViewport = null;
  let lastListSignature = null;
  let keyboardInset = 0;
  // Session-only recent-file ids observed from window bindings, never persisted
  // and never read on drag/render.
  const recentIds = [];
  let recentSignature = "";
  let recentValidation = 0;
  let windowMenu = null;
  let disposed = false;
  const media = window.matchMedia ? window.matchMedia("(max-width: 767px), (max-height: 499px)") : null;

  // A node that is detached, [hidden] or display:none (compact background
  // windows) cannot hold focus. Used before handing focus to a replacement.
  const visibleInLayout = (node) => Boolean(
    node && document.contains(node) && !node.hidden && node.getClientRects().length > 0,
  );
  const taskFor = (id) => [...taskItems.querySelectorAll("[data-window-id]")]
    .find((node) => node.dataset.windowId === id);
  const focusNode = (node) => {
    if (!node) return;
    try { node.focus({ preventScroll: true }); } catch { node.focus(); }
  };

  const shippedApps = () => registry.list().filter((app) => !app.devOnly && !app.testOnly);

  function setTheme(mode) {
    desktop.dataset.theme = mode === "system"
      ? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : mode;
    desktop.dataset.themePref = mode;
    paintQuickSettings();
  }

  function paintQuickSettings() {
    root.querySelectorAll("[data-fw-theme]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.fwTheme === desktop.dataset.themePref));
    });
    root.querySelectorAll("[data-fw-toggle]").forEach((button) => {
      const key = button.dataset.fwToggle === "motion" ? "reduceMotion" : "translucent";
      button.setAttribute("aria-pressed", String(desktop.dataset[key] === "true"));
    });
  }

  function openApp(appOrId, options = {}) {
    const app = typeof appOrId === "string" ? registry.getApp(appOrId) : appOrId;
    if (!app) return null;
    // Accept a bare element from older callers as well as the options object.
    const opts = options instanceof Element ? { source: options } : (options || {});
    const fileId = opts.fileId || null;
    const mode = opts.mode || null;
    const draftId = opts.draftId || null;
    const source = opts.source || opts.launcher || startButton;
    const wmId = `${app.id}-${Math.random().toString(36).slice(2, 9)}`;
    launchers.set(wmId, source instanceof Element ? source : startButton);
    const suffix = fileId ? ` · ${fileId}` : mode ? ` · ${mode}` : draftId ? " · draft" : "";
    wm.dispatch({
      type: "OPEN",
      id: wmId,
      appId: app.id,
      title: `${app.title}${suffix}`,
      icon: app.icon,
      singleton: app.singleton,
      accepts: app.accepts,
      minSize: { ...app.minSize },
      fileId,
      mode,
      draftId,
    });
    closePopups();
    const openedId = wm.getLastOpenId();
    // A window opened from a shortcut or Start should take keyboard focus so
    // the next keystroke lands inside it, not back on the launcher.
    focusWindow(openedId);
    return openedId;
  }

  function hasDirty() {
    return wm.getState().some((windowState) => windowState.dirty);
  }

  function setDirty(id, dirty) {
    if (!wm.getWindow(id)) return;
    wm.dispatch({ type: "DIRTY", id, dirty: Boolean(dirty) });
    services.setUnloadGuard?.(hasDirty());
  }

  function showConfirm({ title, message, acceptLabel, cancelLabel }) {
    return new Promise((resolve) => {
      // Remember the control that opened the dialog so dismissing it returns
      // the user to the same place (the exit link, a taskbar item, or Close).
      const returnFocus = document.activeElement;
      const overlay = el("div", "fw-confirm");
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", title);
      overlay.style.cssText = "position:absolute;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:rgba(4,10,26,.62);backdrop-filter:blur(6px)";
      const card = el("div", "fw-confirm-card");
      card.style.cssText = "width:min(420px,calc(100vw - 32px));padding:22px;border-radius:18px;border:1px solid var(--fw-line-strong);background:var(--fw-glass-strong);box-shadow:var(--fw-shadow);color:var(--fw-text)";
      const heading = el("h2", "", title);
      heading.style.cssText = "margin:0 0 10px;font-size:18px";
      const body = el("p", "", message);
      body.style.cssText = "margin:0 0 18px;font-size:14px;line-height:1.5;color:var(--fw-text-2)";
      const actions = el("div", "fw-confirm-actions");
      actions.style.cssText = "display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap";
      const button = (label, choice, primary) => {
        const b = el("button", "", label);
        b.type = "button";
        b.dataset.choice = choice;
        b.style.cssText = `min-height:40px;padding:0 14px;border-radius:10px;border:1px solid var(--fw-line-strong);background:${primary ? "var(--fw-accent)" : "var(--fw-glass)"};color:${primary ? "#fff" : "var(--fw-text)"};font-weight:600;cursor:pointer`;
        return b;
      };
      const cancel = button(cancelLabel, "stay", false);
      const accept = button(acceptLabel, "leave", true);
      actions.append(cancel, accept);
      card.append(heading, body, actions);
      overlay.append(card);

      const onKey = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
          return;
        }
        if (event.key !== "Tab") return;
        const buttons = [cancel, accept].filter(visibleInLayout);
        if (!buttons.length) {
          event.preventDefault();
          return;
        }
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        const active = document.activeElement;
        if (event.shiftKey) {
          if (active === first || !overlay.contains(active)) {
            event.preventDefault();
            focusNode(last);
          }
        } else if (active === last || !overlay.contains(active)) {
          event.preventDefault();
          focusNode(first);
        }
      };
      const finish = (value) => {
        document.removeEventListener("keydown", onKey, true);
        overlay.remove();
        if (returnFocus && returnFocus !== document.body
          && document.contains(returnFocus) && typeof returnFocus.focus === "function") {
          focusNode(returnFocus);
        }
        resolve(value);
      };
      cancel.addEventListener("click", () => finish(false));
      accept.addEventListener("click", () => finish(true));
      document.addEventListener("keydown", onKey, true);
      root.append(overlay);
      cancel.focus({ preventScroll: true });
    });
  }

  function closePopups() {
    startOpen = false;
    switcherOpen = false;
    startPanel.hidden = true;
    switcherPanel.hidden = true;
    startButton.setAttribute("aria-expanded", "false");
    switcherButton.setAttribute("aria-expanded", "false");
    activeResult = -1;
  }

  function renderStart() {
    const apps = registry.search(search.value)
      .filter((app) => !app.testOnly)
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
    results.replaceChildren();
    if (!apps.length) {
      const empty = el("p", "fw-empty", search.value ? "No apps match that search." : "No apps are available.");
      results.append(empty);
      return;
    }
    apps.forEach((app, index) => {
      const button = el("button", "fw-result");
      button.type = "button";
      button.dataset.appId = app.id;
      button.append(iconFor(app), el("span", "fw-result-name", app.title));
      const hint = el("span", "fw-result-hint", app.pinned ? "Pinned" : "");
      if (hint.textContent) button.append(hint);
      button.addEventListener("click", () => openApp(app, { source: startButton }));
      button.addEventListener("mouseenter", () => { activeResult = index; paintActiveResult(); });
      results.append(button);
    });
    activeResult = activeResult >= apps.length ? apps.length - 1 : activeResult;
    paintActiveResult();
  }

  function paintActiveResult() {
    [...results.querySelectorAll(".fw-result")].forEach((b, i) => {
      b.classList.toggle("is-active", i === activeResult);
      if (i === activeResult) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    });
  }

  function showNotice(text) {
    if (!notice) return;
    notice.textContent = text || "";
  }

  function buildRecentSection() {
    if (root.querySelector("#fw-recent-section")) return;
    const section = el("div", "fw-recent-section");
    section.id = "fw-recent-section";
    section.append(el("p", "fw-label", "Recent Findows files"));
    const list = el("div", "fw-recent");
    list.id = "fw-recent";
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", "Recent Findows files");
    section.append(list);
    const quick = [...startPanel.querySelectorAll(".fw-label")]
      .find((node) => node.textContent === "Quick appearance");
    if (quick) startPanel.insertBefore(section, quick);
    else startPanel.append(section);
  }

  function observeRecent() {
    const bound = wm.getState()
      .filter((state) => state.fileId)
      .map((state) => `${state.appId}:${state.fileId}:${state.mode || ""}`)
      .sort();
    const signature = bound.join("|");
    if (signature === recentSignature) return;
    recentSignature = signature;
    for (const state of wm.getState().filter((item) => item.fileId)) {
      const existing = recentIds.findIndex((item) => item.fileId === state.fileId && item.appId === state.appId);
      if (existing >= 0) recentIds.splice(existing, 1);
      recentIds.unshift({ fileId: state.fileId, appId: state.appId, mode: state.mode || null });
    }
    if (recentIds.length > 6) recentIds.length = 6;
    if (startOpen) void refreshRecent();
  }

  async function refreshRecent() {
    const list = $("fw-recent");
    if (!list || !services.files?.read) return;
    const token = ++recentValidation;
    const items = [];
    for (const candidate of recentIds.slice()) {
      try {
        const entry = await services.files.read(candidate.fileId);
        if (!entry || entry.trashedAt) continue;
        const association = services.files.getAppForFile?.(entry);
        items.push({
          fileId: entry.id,
          name: entry.name,
          appId: association?.appId || candidate.appId,
          mode: association?.mode || candidate.mode || "edit",
        });
      } catch {
        // Deleted or inaccessible ids are hidden, not offered as broken links.
      }
      if (token !== recentValidation || disposed) return;
    }
    list.replaceChildren();
    if (!items.length) {
      list.append(el("p", "fw-empty", "No recent Findows files yet."));
      return;
    }
    for (const item of items) {
      const button = el("button", "fw-recent-item");
      button.type = "button";
      button.dataset.fileId = item.fileId;
      button.setAttribute("aria-label", `Open ${item.name} in ${item.appId}`);
      button.append(el("span", "fw-recent-name", item.name), el("span", "fw-recent-app", item.appId));
      button.addEventListener("click", () => openApp(item.appId, {
        fileId: item.fileId,
        mode: item.mode,
        source: button,
      }));
      list.append(button);
    }
  }

  function buildFrame(windowState, app) {
    const frame = el("section", "fw-window");
    frame.dataset.windowId = windowState.id;
    frame.dataset.appId = windowState.appId;
    frame.setAttribute("aria-label", `${windowState.title} window`);
    frame.tabIndex = -1;

    const bar = el("header", "fw-titlebar");
    bar.append(iconFor(app));
    const label = el("span", "fw-title", windowState.title);
    bar.append(label);

    const controls = el("div", "fw-title-actions");
    const control = (action, glyph, name) => {
      const button = el("button", "fw-title-button", glyph);
      button.type = "button";
      button.dataset.action = action;
      button.setAttribute("aria-label", `${name} ${windowState.title}`);
      controls.append(button);
      return button;
    };
    control("snap-left", "◧", "Snap left");
    control("snap-right", "◨", "Snap right");
    control("minimize", "─", "Minimize");
    const max = control("maximize", "□", "Maximize");
    const restore = control("restore", "❐", "Restore");
    const menuButton = control("window-menu", "⌖", "Window options");
    control("close", "×", "Close");
    bar.append(controls);

    const host = el("div", "fw-app-host");
    const body = el("div", "fw-window-body");
    body.append(host);
    frame.append(bar, body);
    for (const edge of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) {
      const handle = el("div", `fw-resize fw-resize-${edge}`);
      handle.dataset.resize = edge;
      frame.append(handle);
    }

    controls.addEventListener("pointerdown", (e) => e.stopPropagation());
    controls.addEventListener("click", (e) => {
      const action = e.target.closest("[data-action]")?.dataset.action;
      if (!action) return;
      if (action === "close") return closeWindow(windowState.id);
      if (action === "window-menu") return toggleWindowMenu(windowState.id, frame);
      if (action === "snap-left" || action === "snap-right") {
        wm.dispatch({ type: "SNAP", id: windowState.id, side: action === "snap-right" ? "right" : "left" });
        return;
      }
      wm.dispatch({ type: action === "restore" ? "RESTORE" : action.toUpperCase(), id: windowState.id });
    });
    bar.addEventListener("pointerdown", (e) => {
      if (e.target.closest("[data-action]") || e.button !== 0 || compact) return;
      e.preventDefault();
      wm.dispatch({ type: "FOCUS", id: windowState.id });
      startDrag(e, windowState, frame, "move");
    });
    frame.addEventListener("pointerdown", () => {
      if (wm.getFocusedId() !== windowState.id) wm.dispatch({ type: "FOCUS", id: windowState.id });
    }, true);
    frame.querySelectorAll("[data-resize]").forEach((handle) => {
      handle.addEventListener("pointerdown", (e) => {
        if (compact || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        wm.dispatch({ type: "FOCUS", id: windowState.id });
        startDrag(e, windowState, frame, handle.dataset.resize);
      });
    });
    windowsLayer.append(frame);

    let resolveReady = () => {};
    const ready = new Promise((resolve) => { resolveReady = resolve; });
    const appState = {
      abort: new AbortController(), handle: null, ready, resolveReady,
      appId: windowState.appId, fileId: windowState.fileId, loading: true, host,
    };
    instances.set(windowState.id, appState);
    mountApp(windowState, app, appState);
    return { frame, max, restore, menuButton };
  }

  async function mountApp(windowState, app, state, hostOverride) {
    const host = hostOverride || state.host;
    try {
      const module = await app.load();
      if (disposed || !wm.getWindow(windowState.id) || state.abort.signal.aborted) return;
      const handle = await module.mount({
        container: host,
        windowId: windowState.id,
        fileId: windowState.fileId,
        mode: windowState.mode,
        draftId: windowState.draftId,
        services,
        signal: state.abort.signal,
      });
      if (disposed || !wm.getWindow(windowState.id) || state.abort.signal.aborted) {
        handle.dispose?.();
        return;
      }
      state.handle = handle;
      state.loading = false;
    } catch (error) {
      if (state.abort.signal.aborted || !wm.getWindow(windowState.id)) return;
      state.loading = false;
      host.replaceChildren();
      const errorBox = el("div", "fw-app-error");
      errorBox.append(
        el("h2", "", "This app could not open"),
        el("p", "", error?.message || "An unexpected error occurred."),
      );
      const retry = el("button", "fw-retry", "Try again");
      retry.type = "button";
      retry.addEventListener("click", () => {
        errorBox.remove();
        state.abort = new AbortController();
        state.loading = true;
        mountApp(windowState, app, state, host);
      });
      errorBox.append(retry);
      host.append(errorBox);
    } finally {
      state.resolveReady(state.handle || null);
    }
  }

  function menuFocusTarget(id) {
    return frames.get(id)?.querySelector('[data-action="window-menu"]');
  }

  function closeWindowMenu(commit) {
    if (!windowMenu) return;
    const menu = windowMenu;
    windowMenu = null;
    document.removeEventListener("keydown", onMenuKey, true);
    menu.popup.remove();
    if (!commit && wm.getWindow(menu.id)) {
      wm.dispatch({ type: "RESIZE", id: menu.id, rect: menu.startRect });
    }
  }

  function applyMenuDelta(dx, dy) {
    const menu = windowMenu;
    if (!menu) return;
    const current = wm.getWindow(menu.id);
    if (!current) return closeWindowMenu(false);
    const rect = { ...current.rect };
    if (menu.mode === "move") {
      rect.x += dx;
      rect.y += dy;
    } else {
      rect.width += dx;
      rect.height += dy;
    }
    wm.dispatch({ type: "RESIZE", id: menu.id, rect });
    const applied = wm.getWindow(menu.id)?.rect;
    if (applied && menu.readout) {
      menu.readout.textContent = menu.mode === "move"
        ? `X ${applied.x} · Y ${applied.y}`
        : `Width ${applied.width} · Height ${applied.height}`;
    }
  }

  function onMenuKey(event) {
    const menu = windowMenu;
    if (!menu) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeWindowMenu(false);
      menuFocusTarget(menu.id)?.focus({ preventScroll: true });
      return;
    }
    if (!menu.mode) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        const choices = [...menu.popup.querySelectorAll(".fw-menu-choice")];
        const index = choices.indexOf(document.activeElement);
        const next = index + (event.key === "ArrowDown" ? 1 : choices.length - 1);
        choices[next % choices.length]?.focus();
      }
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      closeWindowMenu(true);
      menuFocusTarget(menu.id)?.focus({ preventScroll: true });
      return;
    }
    const step = event.shiftKey ? 48 : 16;
    const deltas = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0],
      ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    const delta = deltas[event.key];
    if (delta) {
      event.preventDefault();
      event.stopPropagation();
      applyMenuDelta(delta[0], delta[1]);
    }
  }

  function toggleWindowMenu(id, frame) {
    if (windowMenu?.id === id) {
      closeWindowMenu(false);
      return;
    }
    closeWindowMenu(false);
    const state = wm.getWindow(id);
    if (!state || state.state !== "normal" || compact) return;
    const popup = el("div", "fw-window-menu");
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", "Window options");
    popup.append(el("p", "fw-window-menu-hint", "Choose Move or Size, then use arrow keys. Enter applies, Escape cancels."));
    const readout = el("p", "fw-window-menu-readout", "");
    readout.tabIndex = -1;
    const makeChoice = (mode) => {
      const button = el("button", "fw-menu-choice", mode === "move" ? "Move" : "Size");
      button.type = "button";
      button.dataset.mode = mode;
      button.addEventListener("click", () => {
        if (!windowMenu) return;
        windowMenu.mode = mode;
        readout.textContent = mode === "move" ? "Use arrow keys to move" : "Use arrow keys to resize";
        readout.focus({ preventScroll: true });
      });
      return button;
    };
    popup.append(makeChoice("move"), makeChoice("size"), readout);
    frame.append(popup);
    windowMenu = { id, frame, popup, mode: null, startRect: { ...state.rect }, readout };
    document.addEventListener("keydown", onMenuKey, true);
    popup.querySelector(".fw-menu-choice")?.focus({ preventScroll: true });
  }

  function focusWindow(id) {
    const frame = frames.get(id);
    const instance = instances.get(id);
    if (!frame || !document.contains(frame) || !visibleInLayout(frame)) return false;
    if (instance?.handle?.focus) {
      try { instance.handle.focus(); } catch { /* fall through to the frame */ }
    }
    const active = document.activeElement;
    if ((active === frame || frame.contains(active)) && active !== frame.querySelector(".fw-app-host")) return true;
    // The frame itself is focusable (tabindex=-1); a scroll host is not a useful target.
    focusNode(frame);
    return document.activeElement === frame;
  }

  function closeWindow(id) {
    if (windowMenu?.id === id) closeWindowMenu(false);
    const state = instances.get(id);
    if (!state) return Promise.resolve(false);
    if (state.closingPromise) return state.closingPromise;
    const launcher = launchers.get(id);
    const dirty = Boolean(wm.getWindow(id)?.dirty);

    state.closingPromise = (async () => {
      if (dirty) {
        // The handle may still be mounting; wait for it so a loading editor is
        // never discarded before its own guard has had a chance to run.
        const handle = state.handle || await state.ready.catch(() => null);
        let allowed = false;
        if (typeof handle?.canClose === "function") allowed = await handle.canClose();
        else allowed = await showConfirm({
          title: "Close this window?",
          message: "This window has unsaved work. Closing it now keeps a recoverable draft, but the window will go away.",
          acceptLabel: "Close anyway",
          cancelLabel: "Keep editing",
        });
        if (!allowed) {
          state.closingPromise = null;
          return false;
        }
      }
      wm.dispatch({ type: "CLOSE", id });
      state.abort.abort();
      state.handle?.dispose?.();
      instances.delete(id);
      launchers.delete(id);
      services.setUnloadGuard?.(hasDirty());
      const focused = wm.getFocusedId();
      if (focused) {
        focusWindow(focused);
      } else if (visibleInLayout(launcher)) {
        focusNode(launcher);
      } else {
        // A launcher can live inside the window being closed (an app's "New"
        // button, a recent-file row). When that subtree is gone, fall back to
        // a surviving taskbar button, then Start — never to <body>.
        const survivor = [...taskItems.querySelectorAll(".fw-task-item")].find(visibleInLayout);
        focusNode(survivor || startButton);
      }
      return true;
    })();
    return state.closingPromise;
  }

  function startDrag(event, windowState, frame, mode) {
    const start = { x: event.clientX, y: event.clientY, rect: { ...wm.getWindow(windowState.id)?.rect } };
    if (!start.rect) return;
    const target = event.currentTarget;
    try { target.setPointerCapture(event.pointerId); } catch { /* capture is an enhancement */ }

    const move = (e) => {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (mode === "move") {
        wm.dispatch({ type: "MOVE", id: windowState.id, x: start.rect.x + dx, y: start.rect.y + dy });
        return;
      }
      const r = { ...start.rect };
      if (mode.includes("e")) r.width = start.rect.width + dx;
      if (mode.includes("s")) r.height = start.rect.height + dy;
      if (mode.includes("w")) { r.x = start.rect.x + dx; r.width = start.rect.width - dx; }
      if (mode.includes("n")) { r.y = start.rect.y + dy; r.height = start.rect.height - dy; }
      wm.dispatch({ type: "RESIZE", id: windowState.id, rect: r });
    };
    const up = (e) => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      try { target.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      if (mode !== "move" || compact) return;
      const threshold = 28;
      if (e.clientX <= threshold) wm.dispatch({ type: "SNAP", id: windowState.id, side: "left" });
      else if (e.clientX >= window.innerWidth - threshold) wm.dispatch({ type: "SNAP", id: windowState.id, side: "right" });
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  // A virtual keyboard shrinks visualViewport but not the layout viewport, so
  // bottom-anchored inputs can end up behind it. Lift the work area and chrome
  // above the visual viewport, then nudge the focused field if it is still low.
  function revealFocusedInput(limit) {
    const active = document.activeElement;
    if (!active || !active.matches?.('input, textarea, select, [contenteditable="true"]')) return;
    let rect = active.getBoundingClientRect();
    let delta = rect.bottom - limit + 12;
    if (delta <= 0) return;
    const host = active.closest(".fw-app-host");
    if (host) {
      host.scrollTop += delta;
      rect = active.getBoundingClientRect();
      if (rect.bottom <= limit - 8) return;
      // The host has no more scroll range; move the whole window up instead.
      delta = rect.bottom - limit + 12;
    }
    const frame = active.closest(".fw-window");
    const current = frame && wm.getWindow(frame.dataset.windowId);
    if (current) {
      wm.dispatch({
        type: "MOVE", id: current.id,
        x: current.rect.x, y: Math.max(0, current.rect.y - delta),
      });
    }
  }

  function applyVisualViewport() {
    const vv = window.visualViewport;
    if (!vv) return;
    const inset = Math.max(0, Math.round(window.innerHeight - vv.height - (vv.offsetTop || 0)));
    const active = inset > 100;
    if (inset === keyboardInset && desktop.dataset.keyboard === String(active)) {
      revealFocusedInput(vv.offsetTop + vv.height);
      return;
    }
    keyboardInset = inset;
    desktop.dataset.keyboard = String(active);
    desktop.style.setProperty("--fw-keyboard-inset", `${inset}px`);
    const area = document.querySelector(".fw-desktop-area");
    if (area) {
      const rect = area.getBoundingClientRect();
      wm.setWorkArea({
        width: Math.round(rect.width),
        height: Math.max(240, Math.round(rect.height)),
      });
    }
    revealFocusedInput(vv.offsetTop + vv.height);
  }

  // Rendering replaces taskbar buttons, hides window controls and (in compact
  // layout) display:none's the background window. Any of those can silently
  // drop focus to <body>; this hands it to the closest surviving equivalent.
  function recoverFocusOnRender(previous, focused) {
    const { active, taskId, frameId, action } = previous;
    if (!active || active === document.body) return;

    // The focused taskbar button was replaced by replaceChildren(): focus its
    // new counterpart instead of losing the user's place on the taskbar.
    if (taskId && !document.contains(active)) {
      const next = taskFor(taskId);
      if (visibleInLayout(next)) {
        focusNode(next);
        return;
      }
    }

    // A title-bar control was hidden by the state change (Maximize <-> Restore,
    // or the whole frame on minimize). Prefer the inverse control, then any
    // other visible control in the same title bar.
    if (frameId && action && !visibleInLayout(active)) {
      const frame = frames.get(frameId);
      if (frame && !frame.hidden) {
        const preferred = action === "maximize" ? ["restore"]
          : action === "restore" ? ["maximize"] : [];
        const order = [...preferred, "maximize", "restore", "snap-left", "snap-right",
          "minimize", "window-menu", "close"];
        const target = order
          .map((name) => frame.querySelector(`[data-action="${name}"]`))
          .find((button) => button && button !== active && visibleInLayout(button));
        if (target) {
          focusNode(target);
          return;
        }
      }
    }

    // The focused window itself became hidden: go to its taskbar button when
    // minimized, otherwise follow the foreground to the incoming window.
    if (frameId && !visibleInLayout(active)) {
      if (wm.getWindow(frameId)?.state === "minimized") {
        const task = taskFor(frameId);
        if (visibleInLayout(task)) {
          focusNode(task);
          return;
        }
      }
      if (focused && focused !== frameId && frames.has(focused)) focusWindow(focused);
    }
  }

  function render() {
    if (disposed) return;
    const activeBefore = document.activeElement;
    const previous = {
      active: activeBefore,
      taskId: taskItems.contains(activeBefore) ? activeBefore.dataset.windowId : null,
      frameId: [...frames].find(([, frame]) => frame === activeBefore || frame.contains(activeBefore))?.[0] || null,
      action: activeBefore?.dataset?.action || null,
    };
    const states = wm.getState();
    const focused = wm.getFocusedId();
    // MOVE/RESIZE fire on every pointer frame but cannot change what the
    // taskbar or switcher say, so skip rebuilding those lists then.
    const listSignature = states.map((s) =>
      `${s.id}|${s.appId}|${s.title}|${s.dirty}|${s.state}|${s.id === focused}`).join(";");
    const rebuildLists = listSignature !== lastListSignature;
    lastListSignature = listSignature;
    const byId = new Map(states.map((s) => [s.id, s]));
    observeRecent();
    if (windowMenu && !byId.has(windowMenu.id)) closeWindowMenu(false);

    for (const [id, frame] of frames) {
      if (!byId.has(id)) {
        frame.remove();
        frames.delete(id);
      }
    }
    for (const state of states) {
      let frame = frames.get(state.id);
      if (!frame) {
        frame = buildFrame(state, registry.getApp(state.appId) || registry.getApp("help")).frame;
        frames.set(state.id, frame);
      }
      frame.dataset.state = state.state;
      frame.dataset.focused = String(state.id === focused);
      frame.dataset.dirty = String(Boolean(state.dirty));
      frame.hidden = state.state === "minimized";
      frame.style.left = `${state.rect.x}px`;
      frame.style.top = `${state.rect.y}px`;
      frame.style.width = `${state.rect.width}px`;
      frame.style.height = `${state.rect.height}px`;
      frame.style.zIndex = String(100 + state.z);
      const restore = frame.querySelector("[data-action='restore']");
      const maximize = frame.querySelector("[data-action='maximize']");
      const isMax = state.state === "maximized";
      const isSnapped = state.state === "snapped-left" || state.state === "snapped-right";
      restore.hidden = !(isMax || isSnapped);
      maximize.hidden = isMax;
      const menuButton = frame.querySelector("[data-action='window-menu']");
      if (menuButton) menuButton.hidden = state.state !== "normal";
      if (windowMenu?.id === state.id && state.state !== "normal") closeWindowMenu(false);
    }

    if (compact && focused) {
      for (const [id, frame] of frames) frame.dataset.foreground = String(id === focused);
    } else {
      for (const frame of frames.values()) delete frame.dataset.foreground;
    }

    if (rebuildLists) {
      taskItems.replaceChildren();
      for (const state of [...states].sort((a, b) => a.appId.localeCompare(b.appId))) {
        const item = el("button", "fw-task-item");
        item.type = "button";
        item.dataset.windowId = state.id;
        item.dataset.appId = state.appId;
        item.setAttribute(
          "aria-label",
          `${state.title}${state.dirty ? " (unsaved changes)" : ""}${state.state === "minimized" ? " (minimized)" : ""}`,
        );
        item.classList.toggle("is-active", state.id === focused && state.state !== "minimized");
        item.classList.toggle("is-minimized", state.state === "minimized");
        item.append(iconFor(registry.getApp(state.appId) || registry.getApp("help")), el("span", "", state.title));
        item.addEventListener("click", () => {
          if (state.id === focused && state.state !== "minimized") {
            wm.dispatch({ type: "MINIMIZE", id: state.id });
            return; // the rebuilt taskbar button keeps focus via render recovery
          }
          wm.dispatch({ type: "FOCUS", id: state.id });
          focusWindow(state.id);
        });
        taskItems.append(item);
      }

      // Render into the labelled group, not the whole panel: replaceChildren()
      // on the panel would delete the static label and the group itself.
      switcherList.replaceChildren();
      if (!states.length) {
        switcherList.append(el("p", "fw-empty", "No apps are open."));
      } else {
        for (const state of states) {
          const item = el("button", "fw-result");
          item.type = "button";
          item.dataset.windowId = state.id;
          item.append(iconFor(registry.getApp(state.appId) || registry.getApp("help")), el("span", "fw-result-name", state.title));
          item.addEventListener("click", () => {
            wm.dispatch({ type: "FOCUS", id: state.id });
            closePopups();
            focusWindow(state.id);
          });
          switcherList.append(item);
        }
      }
    }
    showNotice(wm.getNotice());
    recoverFocusOnRender(previous, focused);
  }

  function buildShortcuts() {
    shortcutsLayer.replaceChildren();
    for (const app of shippedApps()) {
      const button = el("button", "fw-shortcut");
      button.type = "button";
      button.dataset.appId = app.id;
      button.setAttribute("aria-label", `Open ${app.title}`);
      button.append(iconFor(app), el("span", "fw-shortcut-name", app.title));
      button.addEventListener("click", () => openApp(app, { source: button }));
      shortcutsLayer.append(button);
    }
  }

  function updateCompact() {
    const next = media ? media.matches : window.innerWidth < 768 || window.innerHeight < 500;
    if (next === compact) return;
    compact = next;
    desktop.dataset.layout = compact ? "compact" : "wide";
    render();
  }

  function tickClock() {
    if (!clock) return;
    clock.textContent = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date());
    clock.setAttribute("aria-label", `Local time ${clock.textContent}`);
  }

  function onKey(e) {
    if (e.key === "Escape") {
      if (startOpen || switcherOpen) {
        e.preventDefault();
        const trigger = switcherOpen ? switcherButton : startButton;
        closePopups();
        focusNode(trigger);
      }
      return;
    }
    if (startOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      const buttons = [...results.querySelectorAll(".fw-result")];
      const active = document.activeElement;
      if (!buttons.length || (active !== search && !buttons.includes(active))) return;
      e.preventDefault();
      const current = buttons.indexOf(active);
      const next = e.key === "ArrowDown"
        ? (current < 0 ? 0 : (current + 1) % buttons.length)
        : (current < 0 ? buttons.length - 1 : (current - 1 + buttons.length) % buttons.length);
      activeResult = next;
      paintActiveResult();
      buttons[next].focus();
    }
  }

  return {
    start() {
      buildShortcuts();
      buildRecentSection();
      renderStart();
      updateCompact();
      if (!services.preferences) {
        desktop.dataset.translucent = "true";
        desktop.dataset.reduceMotion = "false";
        setTheme("system");
      } else {
        paintQuickSettings();
        stopPreferences = services.preferences.subscribe(paintQuickSettings);
      }
      root.querySelectorAll("[data-fw-theme]").forEach((button) => {
        button.addEventListener("click", () => {
          if (services.preferences) void services.preferences.update({ theme: button.dataset.fwTheme });
          else setTheme(button.dataset.fwTheme);
        });
      });
      root.querySelectorAll("[data-fw-toggle]").forEach((button) => {
        button.addEventListener("click", () => {
          const key = button.dataset.fwToggle === "motion" ? "reduceMotion" : "translucent";
          if (services.preferences) void services.preferences.update({ [key]: !services.preferences.get()[key] });
          else {
            desktop.dataset[key] = desktop.dataset[key] === "true" ? "false" : "true";
            paintQuickSettings();
          }
        });
      });
      desktop.dataset.layout = compact ? "compact" : "wide";
      startButton.addEventListener("click", () => {
        if (startOpen) { closePopups(); return; }
        closePopups();
        startOpen = true;
        startPanel.hidden = false;
        startButton.setAttribute("aria-expanded", "true");
        renderStart();
        void refreshRecent();
        search.focus({ preventScroll: true });
      });
      switcherButton.addEventListener("click", () => {
        if (switcherOpen) { closePopups(); return; }
        closePopups();
        switcherOpen = true;
        switcherPanel.hidden = false;
        switcherButton.setAttribute("aria-expanded", "true");
        render();
        switcherList.querySelector("button")?.focus();
      });
      search.addEventListener("input", () => { activeResult = -1; renderStart(); });
      search.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const first = results.querySelector(".fw-result");
        if (first) openApp(first.dataset.appId, { source: startButton });
      });
      // A single document-level handler owns Escape and Start arrow navigation.
      document.addEventListener("keydown", onKey);
      let exitBusy = false;
      exitLink?.addEventListener("click", async (e) => {
        if (exitBusy) {
          e.preventDefault();
          return;
        }
        if (!hasDirty()) return; // clean exit: leave the native navigation alone
        e.preventDefault();
        exitBusy = true;
        const accepted = await showConfirm({
          title: "Leave Findows?",
          message: "Leaving closes your open windows. Some unsaved work may not be recoverable. Stay to save or download a copy first.",
          acceptLabel: "Leave anyway",
          cancelLabel: "Stay",
        });
        exitBusy = false;
        if (accepted) {
          // Accepted explicitly: do not let beforeunload ask a second time.
          services.suppressUnloadOnce?.();
          window.location.href = exitLink.href;
        }
      });
      services.setUnloadGuard?.(false);
      media?.addEventListener?.("change", updateCompact);
      window.addEventListener("resize", updateCompact);
      stopWindows = wm.subscribe(render);
      render();
      const vv = window.visualViewport;
      if (vv?.addEventListener) {
        vv.addEventListener("resize", applyVisualViewport);
        vv.addEventListener("scroll", applyVisualViewport);
        stopVisualViewport = () => {
          vv.removeEventListener("resize", applyVisualViewport);
          vv.removeEventListener("scroll", applyVisualViewport);
        };
        applyVisualViewport();
      }
      tickClock();
      clockTimer = window.setInterval(tickClock, 20_000);
    },
    stop() {
      disposed = true;
      closeWindowMenu(false);
      if (clockTimer) window.clearInterval(clockTimer);
      stopVisualViewport?.();
      stopVisualViewport = null;
      stopWindows?.();
      stopWindows = null;
      stopPreferences?.();
      stopPreferences = null;
      media?.removeEventListener?.("change", updateCompact);
      window.removeEventListener("resize", updateCompact);
      document.removeEventListener("keydown", onKey);
      for (const [id, state] of instances) {
        state.abort.abort();
        state.handle?.dispose?.();
        instances.delete(id);
      }
    },
    // Owned by the shell; main.mjs exposes these through `services`.
    openApp,
    setDirty,
    hasDirty,
  };
}
