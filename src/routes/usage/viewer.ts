// Self-contained HTML viewer for /usage. Renders Copilot quota snapshots
// (chat / completions / premium_interactions) plus plan + reset metadata.
// Reads from same-origin /usage by default; ?endpoint=... overrides.
export const usageViewerHtml = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Copilot Usage</title>
<style>
  :root {
    --bg: #0d1117;
    --panel: #161b22;
    --border: #30363d;
    --fg: #e6edf3;
    --muted: #7d8590;
    --accent: #58a6ff;
    --good: #3fb950;
    --warn: #d29922;
    --bad: #f85149;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px;
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--bg); color: var(--fg);
  }
  header {
    display: flex; align-items: center; gap: 12px;
    margin-bottom: 20px;
  }
  h1 { font-size: 20px; margin: 0; flex: 1; }
  button {
    background: var(--panel); color: var(--fg);
    border: 1px solid var(--border); border-radius: 6px;
    padding: 6px 12px; cursor: pointer; font-size: 13px;
  }
  button:hover { border-color: var(--accent); color: var(--accent); }
  .endpoint {
    color: var(--muted); font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 12px;
  }
  .meta {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px; margin-bottom: 20px;
  }
  .meta-card {
    background: var(--panel); border: 1px solid var(--border);
    border-radius: 8px; padding: 12px 16px;
  }
  .meta-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
  .meta-value { font-size: 16px; margin-top: 4px; word-break: break-all; }
  .quotas { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
  .quota {
    background: var(--panel); border: 1px solid var(--border);
    border-radius: 8px; padding: 16px;
  }
  .quota-title {
    display: flex; align-items: baseline; justify-content: space-between;
    margin-bottom: 12px;
  }
  .quota-title h2 { font-size: 15px; margin: 0; text-transform: capitalize; }
  .quota-title .pct { font-size: 22px; font-weight: 600; }
  .bar {
    height: 8px; background: #21262d; border-radius: 4px;
    overflow: hidden; margin-bottom: 12px;
  }
  .bar > span {
    display: block; height: 100%; transition: width .3s ease;
  }
  .grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px;
    font-size: 13px;
  }
  .grid .k { color: var(--muted); }
  .grid .v { text-align: right; font-variant-numeric: tabular-nums; }
  .badge {
    display: inline-block; padding: 1px 8px; border-radius: 999px;
    font-size: 11px; font-weight: 600; margin-left: 6px;
  }
  .badge.unlimited { background: rgba(63,185,80,.15); color: var(--good); }
  .badge.overage   { background: rgba(248,81,73,.15);  color: var(--bad);  }
  .err {
    background: rgba(248,81,73,.1); border: 1px solid var(--bad);
    border-radius: 8px; padding: 16px; color: var(--bad);
    font-family: ui-monospace, "SF Mono", Menlo, monospace; white-space: pre-wrap;
  }
  footer {
    margin-top: 24px; color: var(--muted); font-size: 12px; text-align: center;
  }
</style>
</head>
<body>
<header>
  <h1>Copilot Usage</h1>
  <span class="endpoint" id="endpointLabel"></span>
  <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted);">
    <input type="checkbox" id="autoToggle" checked />
    auto
  </label>
  <select id="intervalSel" style="background:var(--panel);color:var(--fg);border:1px solid var(--border);border-radius:6px;padding:5px 8px;font-size:13px;">
    <option value="10">10s</option>
    <option value="30" selected>30s</option>
    <option value="60">60s</option>
    <option value="300">5m</option>
  </select>
  <button id="refreshBtn">Refresh</button>
</header>
<div id="root"></div>
<footer id="footer"></footer>

<script>
(() => {
  const params = new URLSearchParams(location.search);
  const endpoint = params.get("endpoint") || (location.origin + "/usage");
  document.getElementById("endpointLabel").textContent = endpoint;

  const root = document.getElementById("root");
  const footer = document.getElementById("footer");
  const autoToggle = document.getElementById("autoToggle");
  const intervalSel = document.getElementById("intervalSel");

  // Persist user prefs across reloads.
  const LS_AUTO = "copilot-usage:auto";
  const LS_INT  = "copilot-usage:interval";
  const savedAuto = localStorage.getItem(LS_AUTO);
  const savedInt  = localStorage.getItem(LS_INT);
  // URL params override localStorage; defaults: auto=on, interval=30.
  if (params.has("auto")) autoToggle.checked = params.get("auto") !== "0";
  else if (savedAuto !== null) autoToggle.checked = savedAuto === "1";
  if (params.has("refresh")) intervalSel.value = params.get("refresh");
  else if (savedInt) intervalSel.value = savedInt;

  const fmt = (n) => typeof n === "number" ? n.toLocaleString() : String(n ?? "—");
  const pctColor = (p) => p > 50 ? "var(--good)" : p > 20 ? "var(--warn)" : "var(--bad)";

  function renderQuota(name, q) {
    if (!q) return "";
    const pct = typeof q.percent_remaining === "number" ? q.percent_remaining.toFixed(1) : "—";
    const width = Math.max(0, Math.min(100, Number(pct) || 0));
    const badges = [
      q.unlimited ? '<span class="badge unlimited">unlimited</span>' : "",
      q.overage_count > 0 ? '<span class="badge overage">overage ' + fmt(q.overage_count) + '</span>' : "",
    ].join("");
    return \`
      <div class="quota">
        <div class="quota-title">
          <h2>\${name.replace(/_/g, " ")}\${badges}</h2>
          <div class="pct" style="color:\${pctColor(width)}">\${pct}%</div>
        </div>
        <div class="bar"><span style="width:\${width}%;background:\${pctColor(width)}"></span></div>
        <div class="grid">
          <div class="k">Remaining</div><div class="v">\${fmt(q.remaining)}</div>
          <div class="k">Quota remaining</div><div class="v">\${fmt(q.quota_remaining)}</div>
          <div class="k">Entitlement</div><div class="v">\${fmt(q.entitlement)}</div>
          <div class="k">Overage permitted</div><div class="v">\${q.overage_permitted ? "yes" : "no"}</div>
          <div class="k">Quota id</div><div class="v" style="font-size:11px">\${q.quota_id ?? "—"}</div>
        </div>
      </div>\`;
  }

  function render(data) {
    const meta = [
      ["Plan", data.copilot_plan],
      ["SKU", data.access_type_sku],
      ["Assigned", data.assigned_date],
      ["Quota reset", data.quota_reset_date],
      ["Chat enabled", data.chat_enabled ? "yes" : "no"],
      ["Orgs", (data.organization_login_list || []).join(", ") || "—"],
    ];
    const metaHtml = meta.map(([k, v]) =>
      '<div class="meta-card"><div class="meta-label">' + k + '</div><div class="meta-value">' + (v ?? "—") + '</div></div>'
    ).join("");

    const snaps = data.quota_snapshots || {};
    const quotaHtml = Object.keys(snaps).map(k => renderQuota(k, snaps[k])).join("");

    root.innerHTML =
      '<div class="meta">' + metaHtml + '</div>' +
      '<div class="quotas">' + quotaHtml + '</div>';
    lastUpdated = new Date();
    updateFooter();
  }

  async function load() {
    root.innerHTML = '<div class="meta-card">Loading…</div>';
    try {
      const r = await fetch(endpoint, { headers: { "Accept": "application/json" } });
      if (!r.ok) throw new Error("HTTP " + r.status + " " + r.statusText);
      const data = await r.json();
      render(data);
    } catch (e) {
      root.innerHTML = '<div class="err">Failed to load ' + endpoint + '\\n\\n' + (e && e.message || e) + '</div>';
      footer.textContent = "";
    }
  }

  document.getElementById("refreshBtn").addEventListener("click", load);

  // Auto-refresh: interval timer, paused while tab is hidden, restarts on
  // toggle / interval change. Persists prefs to localStorage.
  let timer = null;
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
  function startTimer() {
    stopTimer();
    if (!autoToggle.checked || document.hidden) return;
    const sec = Math.max(5, parseInt(intervalSel.value, 10) || 30);
    timer = setInterval(load, sec * 1000);
  }
  autoToggle.addEventListener("change", () => {
    localStorage.setItem(LS_AUTO, autoToggle.checked ? "1" : "0");
    startTimer();
    updateFooter();
  });
  intervalSel.addEventListener("change", () => {
    localStorage.setItem(LS_INT, intervalSel.value);
    startTimer();
    updateFooter();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopTimer();
    else { startTimer(); if (autoToggle.checked) load(); }
  });

  let lastUpdated = null;
  function updateFooter() {
    const ts = lastUpdated ? "Last updated: " + lastUpdated.toLocaleString() : "";
    const auto = autoToggle.checked
      ? " · auto-refresh every " + intervalSel.value + "s"
      : " · auto-refresh off";
    footer.textContent = ts + (lastUpdated ? auto : "");
  }

  load();
  startTimer();
})();
</script>
</body>
</html>`
