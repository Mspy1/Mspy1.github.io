/* Sokoban UI: an accessible box-pushing surface over the real pure engine.
   Original warehouse-themed visuals, no global listeners, no untrusted markup,
   no network and no dependencies. Every game action goes through the engine;
   the renderer only reads its frozen snapshot. Keyboard, pointer and touch all
   share the same action path. */
import { LEVELS, createSokoban } from "./sokoban-engine.mjs";

const KEY_TO_DIRECTION = Object.freeze({
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
});

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const goalText = (state) =>
  `Level ${state.levelIndex + 1} of ${state.levelCount} — ${state.levelName}. Push every box onto a glowing goal.`;

const firstHint = (state) => goalText(state);

export async function mount({ container, windowId, fileId, services, signal } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Sokoban needs a DOM container");
  }
  if (signal?.aborted) {
    throw new DOMException("Sokoban window was closed while loading", "AbortError");
  }

  const game = createSokoban();
  const first = game.getState();
  let disposed = false;
  let builtLevel = -1;
  const cellNodes = new Map();

  const root = el("div", "sk-app");
  root.dataset.windowId = windowId || "";
  root.dataset.phase = first.phase;
  root.tabIndex = -1;
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Sokoban");

  const topbar = el("div", "sk-topbar");
  const brand = el("div", "sk-brand");
  const title = el("h1", "sk-title", "Sokoban");
  const subtitle = el("span", "sk-subtitle");
  brand.append(title, subtitle);
  const hud = el("div", "sk-hud");
  const statDefs = [
    ["level", "Level"],
    ["moves", "Moves"],
    ["pushes", "Pushes"],
    ["par", "Par"],
  ];
  const statValues = new Map();
  for (const [name, label] of statDefs) {
    const box = el("div", `sk-stat sk-stat--${name}`);
    box.append(el("span", "sk-stat-label", label));
    const value = el("span", "sk-stat-value", "");
    value.dataset.stat = name;
    box.append(value);
    statValues.set(name, value);
    hud.append(box);
  }
  topbar.append(brand, hud);

  const message = el("p", "sk-message", goalText(first));
  message.dataset.phase = first.phase;
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  message.setAttribute("aria-atomic", "true");

  const levels = el("div", "sk-levels");
  levels.setAttribute("role", "group");
  levels.setAttribute("aria-label", "Level select");
  const levelButtons = [];
  for (let index = 0; index < first.levelCount; index += 1) {
    const button = el("button", "sk-level", String(index + 1));
    button.type = "button";
    button.dataset.level = String(index);
    levels.append(button);
    levelButtons.push(button);
  }

  const play = el("div", "sk-play");
  const boardWrap = el("div", "sk-board-wrap");
  const board = el("div", "sk-board");
  board.setAttribute("role", "img");
  board.setAttribute("aria-label", "Sokoban board");
  boardWrap.append(board);

  const side = el("div", "sk-side");
  const controls = el("div", "sk-controls");
  const undo = el("button", "sk-button sk-undo", "Undo");
  undo.type = "button";
  undo.dataset.action = "undo";
  undo.setAttribute("aria-keyshortcuts", "Z");
  const restart = el("button", "sk-button sk-restart", "Restart");
  restart.type = "button";
  restart.dataset.action = "restart";
  restart.setAttribute("aria-keyshortcuts", "R");
  const next = el("button", "sk-button sk-next", "Next level");
  next.type = "button";
  next.dataset.action = "next";
  controls.append(undo, restart, next);

  const pad = el("div", "sk-pad");
  pad.setAttribute("role", "group");
  pad.setAttribute("aria-label", "Movement pad");
  const padDefs = [
    ["up", "Move up", "ArrowUp", "↑"],
    ["left", "Move left", "ArrowLeft", "←"],
    ["right", "Move right", "ArrowRight", "→"],
    ["down", "Move down", "ArrowDown", "↓"],
  ];
  for (const [direction, label, shortcut, glyph] of padDefs) {
    const button = el("button", `sk-padbutton sk-${direction}`, glyph);
    button.type = "button";
    button.dataset.direction = direction;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-keyshortcuts", shortcut);
    pad.append(button);
  }
  pad.append(el("span", "sk-pad-center", "MOVE"));

  const hint = el("p", "sk-hint",
    "Arrow keys or WASD move the worker. Push boxes onto the glowing goals. Z undoes, R restarts.");
  hint.setAttribute("aria-hidden", "true");
  side.append(controls, pad, hint);
  play.append(boardWrap, side);
  root.append(topbar, message, levels, play);
  container.replaceChildren(root);

  function buildBoard(state) {
    board.replaceChildren();
    cellNodes.clear();
    for (let row = 0; row < state.height; row += 1) {
      for (let col = 0; col < state.width; col += 1) {
        const node = el("div", "sk-cell");
        node.dataset.row = String(row);
        node.dataset.col = String(col);
        node.setAttribute("aria-hidden", "true");
        board.append(node);
        cellNodes.set(`${row}:${col}`, node);
      }
    }
    board.style.setProperty("--sk-cols", String(state.width));
    board.style.setProperty("--sk-rows", String(state.height));
    builtLevel = state.levelIndex;
  }

  function render(state) {
    if (builtLevel !== state.levelIndex || cellNodes.size !== state.width * state.height) {
      buildBoard(state);
    }
    root.dataset.phase = state.phase;
    message.dataset.phase = state.phase;
    subtitle.textContent = `Level ${state.levelIndex + 1} of ${state.levelCount} · ${state.levelName}`;
    statValues.get("level").textContent = `${state.levelIndex + 1} / ${state.levelCount}`;
    statValues.get("moves").textContent = String(state.moves);
    statValues.get("pushes").textContent = String(state.pushes);
    statValues.get("par").textContent = String(state.par);

    const boxes = state.grid.flat().filter((cell) => cell.box).length;
    const goals = state.grid.flat().filter((cell) => cell.goal).length;
    board.setAttribute("aria-label",
      `${state.levelName}. Board ${state.width} by ${state.height}. ${boxes} boxes, ${goals} goals. ` +
      `Worker at row ${state.player.row + 1}, column ${state.player.col + 1}.`);

    for (const cell of state.grid.flat()) {
      const node = cellNodes.get(`${cell.row}:${cell.col}`);
      node.className = "sk-cell";
      if (cell.wall) node.classList.add("sk-cell--wall");
      else node.classList.add("sk-cell--floor");
      if (cell.goal) node.classList.add("sk-cell--goal");
      if (cell.box) node.classList.add("sk-cell--box");
      if (cell.boxOnGoal) node.classList.add("sk-cell--box-goal");
      if (cell.player) node.classList.add("sk-cell--player");
      if (cell.playerOnGoal) node.classList.add("sk-cell--player-goal");
    }

    for (const [index, button] of levelButtons.entries()) {
      const done = index < state.unlocked || (index === state.levelIndex && state.phase === "won");
      button.disabled = index > state.unlocked;
      button.classList.toggle("sk-level--done", done);
      button.classList.toggle("sk-level--current", index === state.levelIndex);
      if (index === state.levelIndex) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
      button.setAttribute("aria-label",
        `Level ${index + 1}: ${LEVELS[index].name}${done ? ", completed" : ""}`);
    }
    undo.disabled = !state.canUndo;
    next.disabled = state.phase !== "won" || state.isLastLevel;
    for (const button of pad.querySelectorAll("button.sk-padbutton")) {
      button.disabled = state.phase === "won";
    }
    preserveFocus();
  }

  function preserveFocus() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.disabled && root.contains(active)) {
      try { root.focus({ preventScroll: true }); } catch { root.focus(); }
    }
  }

  function announce(state, kind) {
    if (state.phase === "won") {
      const tail = state.isLastLevel
        ? "All levels cleared! Replay any level from the level row."
        : "Choose Next level to continue.";
      message.textContent = `Solved! ${state.levelName} cleared in ${state.moves} steps (par ${state.par}). ${tail}`;
      return;
    }
    if (kind === "restart") {
      message.textContent = `Level restarted. ${firstHint(state)}`;
    } else if (kind === "level") {
      message.textContent = goalText(state);
    } else if (kind === "undo") {
      message.textContent = `Undone. Step ${state.moves}. ${goalText(state)}`;
    } else if (kind === "blocked") {
      message.textContent = "That way is blocked. Use the arrow keys or the D-pad.";
    } else if (kind === "far") {
      message.textContent = "Tap a tile next to the worker, or use the D-pad.";
    } else {
      const pushes = `${state.pushes} push${state.pushes === 1 ? "" : "es"}`;
      message.textContent = `Step ${state.moves}. ${pushes}.`;
    }
  }

  function run(action, kind) {
    if (disposed) return;
    const before = game.getState();
    const state = action();
    if (state === before) {
      if (kind === "move") announce(before, "blocked");
      return;
    }
    render(state);
    announce(state, kind);
  }

  function doRestart() {
    if (disposed) return;
    const state = game.restart();
    render(state);
    announce(state, "restart");
  }

  function doLevelLoad(target) {
    if (disposed) return;
    const state = game.loadLevel(target);
    render(state);
    announce(state, "level");
  }

  function onKeyDown(event) {
    if (disposed || event.defaultPrevented) return;
    if (event.isComposing || event.keyCode === 229) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof Element &&
        target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']")) return;
    const key = event.key;
    const direction = KEY_TO_DIRECTION[key] || KEY_TO_DIRECTION[key.toLowerCase()];
    if (direction) {
      event.preventDefault();
      run(() => game.move(direction), "move");
      return;
    }
    const lower = key.toLowerCase();
    if (lower === "z") {
      event.preventDefault();
      run(() => game.undo(), "undo");
    } else if (lower === "r") {
      event.preventDefault();
      doRestart();
    }
  }

  function onControlClick(event) {
    const button = event.target instanceof Element ? event.target.closest("button[data-action]") : null;
    if (!button || !controls.contains(button)) return;
    if (button.dataset.action === "undo") run(() => game.undo(), "undo");
    else if (button.dataset.action === "restart") doRestart();
    else if (button.dataset.action === "next") doLevelLoad(game.getState().levelIndex + 1);
  }

  function onPadClick(event) {
    const button = event.target instanceof Element ? event.target.closest("button[data-direction]") : null;
    if (!button || !pad.contains(button)) return;
    run(() => game.move(button.dataset.direction), "move");
  }

  function onLevelClick(event) {
    const button = event.target instanceof Element ? event.target.closest("button.sk-level") : null;
    if (!button || !levels.contains(button) || button.disabled) return;
    doLevelLoad(Number(button.dataset.level));
  }

  function onBoardClick(event) {
    const node = event.target instanceof Element ? event.target.closest(".sk-cell") : null;
    if (!node || !board.contains(node)) return;
    const state = game.getState();
    const row = Number(node.dataset.row);
    const col = Number(node.dataset.col);
    const dr = row - state.player.row;
    const dc = col - state.player.col;
    if (!Number.isInteger(dr) || !Number.isInteger(dc) || Math.abs(dr) + Math.abs(dc) !== 1) {
      announce(state, "far");
      return;
    }
    const direction = dr === -1 ? "up" : dr === 1 ? "down" : dc === -1 ? "left" : "right";
    run(() => game.move(direction), "move");
  }

  root.addEventListener("keydown", onKeyDown);
  controls.addEventListener("click", onControlClick);
  pad.addEventListener("click", onPadClick);
  levels.addEventListener("click", onLevelClick);
  board.addEventListener("click", onBoardClick);
  const onAbort = () => dispose();
  signal?.addEventListener?.("abort", onAbort, { once: true });

  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener?.("abort", onAbort);
    root.removeEventListener("keydown", onKeyDown);
    controls.removeEventListener("click", onControlClick);
    pad.removeEventListener("click", onPadClick);
    levels.removeEventListener("click", onLevelClick);
    board.removeEventListener("click", onBoardClick);
    root.remove();
  }

  render(first);

  return {
    canClose: () => true,
    focus() {
      if (disposed) return;
      try { root.focus({ preventScroll: true }); } catch { root.focus(); }
    },
    dispose,
  };
}

export default { mount };
