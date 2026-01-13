const MAX_EVENTS = 200;
const DEBUG = false;
const HOST = "metrics.alfabank.ru";
const TTL_MS = 60 * 60 * 1000;
const MAX_CX_SIZE = 100 * 1024;
let loggingEnabled = false;

chrome.storage.local.get({ loggingEnabled: false }, (data) => {
  loggingEnabled = Boolean(data.loggingEnabled);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.loggingEnabled) {
    loggingEnabled = Boolean(changes.loggingEnabled.newValue);
  }
});

function decodeCx(cx) {
  if (!cx) {
    return { __decode_error: "cx отсутствует" };
  }

  if (cx.length > MAX_CX_SIZE) {
    return { __decode_error: "cx слишком большой для декодирования" };
  }

  try {
    let base64 = cx.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = base64.length % 4;
    if (padLen) {
      base64 += "=".repeat(4 - padLen);
    }

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    const jsonText = new TextDecoder("utf-8").decode(bytes);
    return JSON.parse(jsonText);
  } catch (err) {
    return { __decode_error: String(err && err.message ? err.message : err) };
  }
}

function filterCustomDimensions(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const result = {};
  for (let i = 1; i <= 50; i += 1) {
    const key = String(i);
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      const value = data[key];
      if (value !== null && value !== undefined && value !== "") {
        result[key] = value;
      }
    }
  }

  return Object.keys(result).length ? result : null;
}

function extractCustomDimensions(decoded) {
  if (!decoded || decoded.__decode_error) {
    return null;
  }

  if (!decoded.data || !Array.isArray(decoded.data)) {
    return null;
  }

  const matches = decoded.data
    .filter((item) => item && typeof item.schema === "string" && item.schema.includes("custom_dimension"))
    .map((item) => ({
      schema: item.schema,
      data: filterCustomDimensions(item.data),
    }))
    .filter((item) => item.data);

  return matches.length ? matches : null;
}

function isTargetRequest(details) {
  try {
    const url = new URL(details.url);
    if (url.host !== HOST) {
      return false;
    }

    if (!url.pathname.includes("/metrica/") || !url.pathname.endsWith("/i")) {
      return false;
    }

    return true;
  } catch (_err) {
    return false;
  }
}

function formatTimestamp(date) {
  return date.toLocaleString();
}

function isFreshEvent(event, nowMs) {
  if (!event || typeof event.tsMs !== "number") {
    return false;
  }
  return nowMs - event.tsMs <= TTL_MS;
}

function storeEvent(event) {
  chrome.storage.local.get({ events: [] }, (data) => {
    const events = Array.isArray(data.events) ? data.events : [];
    const nowMs = Date.now();
    const freshEvents = events.filter((item) => isFreshEvent(item, nowMs));
    freshEvents.unshift(event);
    if (freshEvents.length > MAX_EVENTS) {
      freshEvents.length = MAX_EVENTS;
    }
    chrome.storage.local.set({ events: freshEvents });
    if (DEBUG) {
      console.log("Ametrica Debugger: stored event", event);
    }
  });
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!loggingEnabled) {
      return;
    }

    if (!isTargetRequest(details)) {
      return;
    }

    if (DEBUG) {
      console.log("Ametrica Debugger: matched request", details.url);
    }

    const urlObj = new URL(details.url);
    const params = urlObj.searchParams;
    const cxRaw = params.get("cx");
    const cxDecoded = decodeCx(cxRaw);
    const custom = extractCustomDimensions(cxDecoded);

    const event = {
      ts: formatTimestamp(new Date()),
      tsMs: Date.now(),
      eventId: params.get("eid") || "",
      e: params.get("e") || "",
      se_ca: params.get("se_ca") || "",
      se_ac: params.get("se_ac") || "",
      se_la: params.get("se_la") || "",
      url: params.get("url") || "",
      refr: params.get("refr") || "",
      platform: params.get("p") || "",
      application_id: params.get("aid") || "",
      client_pin: params.get("uid") || "",
      pageUrl: details.documentUrl || details.initiator || "",
      type: details.type || "",
      cxRaw: cxRaw || "",
      cxDecoded,
      custom,
    };

    storeEvent(event);
  },
  { urls: ["https://metrics.alfabank.ru/*"] }
);
