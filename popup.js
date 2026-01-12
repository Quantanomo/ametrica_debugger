const MAX_VISIBLE_EVENTS = 50;

const filterInput = document.getElementById("filter-input");
const hidePpCheckbox = document.getElementById("hide-pp");
const showCxDecodedCheckbox = document.getElementById("show-cx-decoded");
const startLoggingBtn = document.getElementById("start-logging");
const stopLoggingBtn = document.getElementById("stop-logging");
const clearBtn = document.getElementById("clear-btn");
const exportBtn = document.getElementById("export-btn");
const statusEl = document.getElementById("status");
const eventsEl = document.getElementById("events");
const eventTemplate = document.getElementById("event-template");
const jsonNodeTemplate = document.getElementById("json-node-template");

let allEvents = [];
const TTL_MS = 60 * 60 * 1000;
let loggingEnabled = false;

function formatHeader(event) {
  const labelMap = {
    pv: "page view",
    pp: "page ping",
    se: "structured event",
    ue: "unstructured event",
    tr: "transaction",
    ti: "transaction item",
    sv: "screen view",
  };
  if (event.e) {
    const label = labelMap[event.e] || "event";
    return `e: ${event.e} - ${label}`;
  }
  return "e: —";
}

function addLine(container, label, value) {
  const line = document.createElement("div");
  line.className = "event-line";
  line.textContent = `${label}: ${value || "—"}`;
  container.appendChild(line);
}

function buildLeaf(key, value) {
  const div = document.createElement("div");
  div.className = "json-leaf";
  div.textContent = `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`;
  return div;
}

function buildJsonTree(value, label) {
  if (value === null || value === undefined) {
    const empty = document.createElement("div");
    empty.className = "json-empty";
    empty.textContent = "Нет данных";
    return empty;
  }

  if (typeof value !== "object") {
    return buildLeaf(label || "value", value);
  }

  const node = jsonNodeTemplate.content.firstElementChild.cloneNode(true);
  const summary = node.querySelector(".json-summary");
  const children = node.querySelector(".json-children");

  const isArray = Array.isArray(value);
  summary.textContent = label || (isArray ? `Array(${value.length})` : "Object");

  const entries = isArray ? value.entries() : Object.entries(value);
  let hasChildren = false;
  for (const [key, childValue] of entries) {
    hasChildren = true;
    children.appendChild(buildJsonTree(childValue, String(key)));
  }

  if (!hasChildren) {
    children.appendChild(buildLeaf("empty", "—"));
  }

  return node;
}

function renderEvents(events) {
  eventsEl.innerHTML = "";

  if (!events.length) {
    statusEl.textContent = "События не найдены";
    return;
  }

  statusEl.textContent = `Показано ${events.length} событий`;
  events.forEach((event) => {
    const node = eventTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".event-header").textContent = formatHeader(event);
    const meta = node.querySelector(".event-meta");
    meta.innerHTML = "";
    addLine(meta, "ts", event.ts);
    addLine(meta, "id", event.eventId);

    const hasStructuredFields = Boolean(event.se_ca || event.se_ac || event.se_la || event.e === "se");
    if (hasStructuredFields) {
      addLine(meta, "se_ca (event_category)", event.se_ca);
      addLine(meta, "se_ac (event_label)", event.se_ac);
      addLine(meta, "se_la (event_name)", event.se_la);
    }

    addLine(meta, "url", event.url);
    addLine(meta, "pageUrl", event.pageUrl);
    addLine(meta, "refr", event.refr);

    const customBody = node.querySelector(".event-custom-body");
    if (event.custom) {
      customBody.appendChild(buildJsonTree(event.custom));
    } else if (event.cxDecoded && event.cxDecoded.__decode_error) {
      const error = document.createElement("div");
      error.className = "json-empty";
      error.textContent = `cx ошибка: ${event.cxDecoded.__decode_error}`;
      customBody.appendChild(error);

      if (event.cxRaw) {
        const cxRaw = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = "cxRaw";
        cxRaw.appendChild(summary);
        const pre = document.createElement("pre");
        pre.textContent = event.cxRaw;
        cxRaw.appendChild(pre);
        customBody.appendChild(cxRaw);
      }
    } else {
      const empty = document.createElement("div");
      empty.className = "json-empty";
      empty.textContent = "Нет custom dimensions";
      customBody.appendChild(empty);
    }

    if (showCxDecodedCheckbox.checked && event.cxDecoded) {
      const cxDetails = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "cx decoded";
      cxDetails.appendChild(summary);
      cxDetails.appendChild(buildJsonTree(event.cxDecoded));
      customBody.appendChild(cxDetails);
    }

    eventsEl.appendChild(node);
  });
}

function applyFilter() {
  const value = filterInput.value;
  let list = allEvents;

  if (hidePpCheckbox.checked) {
    list = list.filter((event) => event.e !== "pp");
  }

  if (value) {
    list = list.filter((event) => {
      const fields = [
        event.ts,
        event.e,
        event.se_ca,
        event.se_ac,
        event.se_la,
        event.url,
        event.refr,
        event.pageUrl,
        event.type,
      ];
      return fields.some((field) => field === value);
    });
  }

  renderEvents(list.slice(0, MAX_VISIBLE_EVENTS));
}

function updateLoggingControls() {
  startLoggingBtn.disabled = loggingEnabled;
  stopLoggingBtn.disabled = !loggingEnabled;
}

function isFreshEvent(event) {
  if (!event || typeof event.tsMs !== "number") {
    return false;
  }
  return Date.now() - event.tsMs <= TTL_MS;
}

function loadEvents() {
  chrome.storage.local.get({ events: [] }, (data) => {
    const events = Array.isArray(data.events) ? data.events : [];
    allEvents = events.filter(isFreshEvent);
    if (allEvents.length !== events.length) {
      chrome.storage.local.set({ events: allEvents });
    }
    applyFilter();
  });
}

function loadLoggingState() {
  chrome.storage.local.get({ loggingEnabled: false }, (data) => {
    loggingEnabled = Boolean(data.loggingEnabled);
    updateLoggingControls();
  });
}

function setLoggingState(enabled) {
  chrome.storage.local.set({ loggingEnabled: enabled }, () => {
    loggingEnabled = enabled;
    updateLoggingControls();
  });
}

function clearEvents() {
  chrome.storage.local.set({ events: [] }, () => {
    allEvents = [];
    applyFilter();
  });
}

function exportJson() {
  const timestamp = new Date();
  const pad = (num) => String(num).padStart(2, "0");
  const fileName = [
    "alpha-metrics-events-",
    timestamp.getFullYear(),
    pad(timestamp.getMonth() + 1),
    pad(timestamp.getDate()),
    "-",
    pad(timestamp.getHours()),
    pad(timestamp.getMinutes()),
    ".json",
  ].join("");

  const blob = new Blob([JSON.stringify(allEvents, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

filterInput.addEventListener("input", applyFilter);
hidePpCheckbox.addEventListener("change", applyFilter);
showCxDecodedCheckbox.addEventListener("change", applyFilter);
startLoggingBtn.addEventListener("click", () => setLoggingState(true));
stopLoggingBtn.addEventListener("click", () => setLoggingState(false));
clearBtn.addEventListener("click", clearEvents);
exportBtn.addEventListener("click", exportJson);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.events) {
    loadEvents();
  }
  if (area === "local" && changes.loggingEnabled) {
    loggingEnabled = Boolean(changes.loggingEnabled.newValue);
    updateLoggingControls();
  }
});

window.addEventListener("unload", () => {
  chrome.storage.local.set({ loggingEnabled: false });
});

loadLoggingState();
loadEvents();
