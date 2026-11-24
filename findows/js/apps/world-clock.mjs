/* World Clock app: several IANA zones from one local instant. Every value comes
   from Intl through world-clock-engine.mjs; a one-second interval only repaints.
   No time service is contacted and no file, draft or storage service is used. */
import {
  CURATED_ZONES,
  DEFAULT_ZONES,
  addZone,
  createZoneState,
  formatZoneTime,
  removeZone,
  zoneLabel,
} from "./world-clock-engine.mjs";

let instanceCount = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(className, label) {
  const node = el("button", className, label);
  node.type = "button";
  return node;
}

export async function mount({ container, windowId, fileId, mode, draftId, services, signal } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("World Clock needs a DOM container");
  }
  if (signal?.aborted) {
    throw new DOMException("World Clock window was closed while loading", "AbortError");
  }

  const uid = `world-clock-${++instanceCount}`;
  let zones = createZoneState(
    Array.isArray(services?.initialZones) ? services.initialZones : DEFAULT_ZONES,
  );
  let disposed = false;
  let timer = null;
  const cards = new Map();

  const root = el("div", "world-clock-app");
  root.dataset.windowId = windowId || "";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "World Clock");

  const header = el("header", "world-clock-header");
  const orb = el("span", "world-clock-orb");
  orb.setAttribute("aria-hidden", "true");
  const heading = el("h1", "world-clock-title", "World Clock");
  heading.tabIndex = -1;
  heading.id = `${uid}-title`;
  const note = el("p", "world-clock-note", "Times are calculated on this device from the same instant. No internet connection is used.");
  header.append(orb, heading, note);

  const form = el("form", "world-clock-add-form");
  form.setAttribute("aria-label", "Add a time zone");
  const field = el("label", "world-clock-field");
  field.append(el("span", "world-clock-field-label", "Add a city or zone"));
  const input = el("input", "world-clock-zone-input");
  input.type = "text";
  input.name = "zone";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "Try Asia/Tokyo";
  input.setAttribute("list", `${uid}-zones`);
  input.setAttribute("aria-describedby", `${uid}-error`);
  field.append(input);

  const datalist = el("datalist", "world-clock-zone-list");
  datalist.id = `${uid}-zones`;
  for (const zone of CURATED_ZONES) {
    const option = el("option");
    option.value = zone.id;
    option.label = `${zone.label} · ${zone.region}`;
    datalist.append(option);
  }

  const addButton = button("world-clock-add-button", "Add");
  addButton.type = "submit";
  form.append(field, datalist, addButton);

  const error = el("p", "world-clock-error", "");
  error.id = `${uid}-error`;
  error.setAttribute("role", "alert");
  error.hidden = true;

  const list = el("ul", "world-clock-zones");
  list.setAttribute("aria-label", "Clocks around the world");

  const status = el("p", "world-clock-sr-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");

  root.append(header, form, error, list, status);
  container.replaceChildren(root);

  function announce(message) {
    status.textContent = message;
  }

  function showError(message) {
    error.hidden = !message;
    error.textContent = message || "";
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
    return !message;
  }

  function buildCard(zone) {
    const label = zoneLabel(zone);
    const card = el("li", "world-clock-zone-card");
    card.dataset.zone = zone;

    const meta = el("div", "world-clock-zone-meta");
    const name = el("span", "world-clock-zone-label", label);
    const id = el("span", "world-clock-zone-id", zone);
    const offset = el("span", "world-clock-zone-offset", "UTC+00:00");
    meta.append(name, id, offset);

    const reading = el("div", "world-clock-zone-reading");
    const time = el("time", "world-clock-zone-time");
    time.setAttribute("aria-label", `${label} local time`);
    const date = el("time", "world-clock-zone-date");
    reading.append(time, date);

    const remove = button("world-clock-remove-button", "Remove");
    remove.dataset.remove = zone;
    remove.setAttribute("aria-label", `Remove ${label}`);
    remove.addEventListener("click", () => removeZoneAt(zone));

    card.append(meta, reading, remove);
    return { card, label, offset, time, date, remove };
  }

  function renderList() {
    list.replaceChildren();
    cards.clear();
    for (const zone of zones) {
      const record = buildCard(zone);
      cards.set(zone, record);
      list.append(record.card);
    }
  }

  function repaint() {
    const now = new Date();
    const instant = now.toISOString();
    for (const [zone, record] of cards) {
      const reading = formatZoneTime(zone, now);
      if (!reading.ok) {
        record.time.textContent = "Unavailable";
        record.date.textContent = reading.message;
        record.offset.textContent = "UTC—";
        continue;
      }
      record.time.textContent = reading.time;
      record.time.dateTime = instant;
      record.time.setAttribute("aria-label", `${record.label} local time ${reading.time}`);
      record.date.textContent = reading.dateLabel;
      record.date.dateTime = reading.dateKey;
      record.offset.textContent = reading.offsetLabel;
    }
  }

  function addZoneFromField() {
    const zone = input.value.trim();
    const result = addZone(zones, zone);
    if (!result.ok) {
      showError(result.message);
      input.focus();
      return;
    }
    zones = result.state;
    input.value = "";
    showError("");
    renderList();
    repaint();
    announce(`Added ${zoneLabel(zone)}.`);
    input.focus();
  }

  function removeZoneAt(zone) {
    const result = removeZone(zones, zone);
    if (!result.ok) {
      showError(result.message);
      return;
    }
    zones = result.state;
    showError("");
    renderList();
    repaint();
    announce(`Removed ${zoneLabel(zone)}.`);
    input.focus();
  }

  function onAbort() { dispose(); }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    addZoneFromField();
  });
  input.addEventListener("input", () => { if (!error.hidden) showError(""); });
  signal?.addEventListener?.("abort", onAbort, { once: true });

  renderList();
  repaint();
  timer = window.setInterval(repaint, 1000);

  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener?.("abort", onAbort);
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
    cards.clear();
    root.remove();
  }

  return {
    canClose: () => true,
    focus() {
      try { heading.focus({ preventScroll: true }); } catch { heading.focus(); }
    },
    dispose,
  };
}

export default { mount };
