export const DASHBOARD_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Token Usage — Copilot API</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: 'Geist', 'Inter', system-ui, sans-serif; background: #09090b; color: #fafafa; margin: 0; }
    .card { background: #18181b; border: 1px solid #27272a; border-radius: 12px; }
    .stat-value { font-size: 2rem; font-weight: 700; letter-spacing: -0.04em; line-height: 1; }
    .stat-label { font-size: 0.75rem; color: #71717a; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-delta { font-size: 0.8rem; color: #71717a; margin-top: 4px; }
    .range-btn { padding: 6px 14px; border-radius: 6px; font-size: 0.8rem; font-weight: 500; border: 1px solid transparent; cursor: pointer; transition: all 0.15s; color: #a1a1aa; background: transparent; }
    .range-btn:hover { color: #fafafa; background: #27272a; }
    .range-btn.active { color: #fafafa; background: #27272a; border-color: #3f3f46; }
    .badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 9999px; font-size: 0.72rem; font-weight: 600; }
    .badge-blue { background: rgba(59,130,246,0.15); color: #93c5fd; }
    .badge-green { background: rgba(34,197,94,0.15); color: #86efac; }
    .badge-purple { background: rgba(168,85,247,0.15); color: #d8b4fe; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: #71717a; font-weight: 600; padding: 10px 16px; border-bottom: 1px solid #27272a; }
    td { padding: 12px 16px; font-size: 0.85rem; border-bottom: 1px solid #1f1f22; color: #d4d4d8; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: rgba(255,255,255,0.02); }
    td.mono { font-family: 'Geist Mono', 'Fira Code', monospace; font-size: 0.82rem; }
    .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
    .spinner { width: 20px; height: 20px; border: 2px solid #27272a; border-top-color: #3b82f6; border-radius: 50%; animation: spin 0.7s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .chart-container { position: relative; height: 260px; }
    .progress-track { height: 6px; border-radius: 3px; background: #27272a; overflow: hidden; margin-top: 8px; }
    .progress-fill { height: 100%; border-radius: 3px; transition: width 0.4s ease; }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 3px; }
  </style>
</head>
<body>
<div class="min-h-screen p-5 md:p-8">
  <div class="max-w-6xl mx-auto space-y-6">

    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <div class="flex items-center gap-2.5">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
          <h1 style="font-size:1.3rem;font-weight:700;letter-spacing:-0.03em">Token Usage</h1>
        </div>
        <p style="color:#71717a;font-size:0.82rem;margin-top:4px">Local request &amp; response token tracking · 30-day history</p>
      </div>
      <div class="flex items-center gap-3">
        <div id="refresh-indicator" class="flex items-center gap-2" style="color:#71717a;font-size:0.78rem">
          <div id="spinner" class="spinner" style="display:none"></div>
          <span id="last-updated"></span>
        </div>
        <div class="flex gap-1 p-1 card" style="border-radius:8px">
          <button class="range-btn active" data-range="1h">1H</button>
          <button class="range-btn" data-range="6h">6H</button>
          <button class="range-btn" data-range="24h">24H</button>
          <button class="range-btn" data-range="7d">7D</button>
          <button class="range-btn" data-range="30d">30D</button>
        </div>
      </div>
    </div>

    <!-- Copilot Budget -->
    <div id="budget-section" class="card p-5" style="display:none">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <div>
          <div style="font-weight:600;font-size:0.92rem">Copilot Budget</div>
          <div style="color:#71717a;font-size:0.78rem;margin-top:2px" id="budget-subtitle">Monthly quota usage</div>
        </div>
        <span id="budget-plan-badge" class="badge badge-purple" style="align-self:flex-start"></span>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4" id="budget-quotas"></div>
    </div>
    <div id="budget-error" style="display:none;color:#71717a;font-size:0.78rem;padding:8px 0">
      Could not load Copilot quota — token may not be authenticated yet.
    </div>

    <!-- Stat Cards -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div class="card p-5">
        <div class="stat-label">Total Requests</div>
        <div class="stat-value mt-2" id="stat-requests">—</div>
        <div class="stat-delta" id="stat-models">—</div>
      </div>
      <div class="card p-5">
        <div class="flex items-center justify-between">
          <div class="stat-label">Input Tokens</div>
          <span class="badge badge-blue"><span class="dot" style="background:#3b82f6"></span>Input</span>
        </div>
        <div class="stat-value mt-2" id="stat-input">—</div>
        <div class="stat-delta" id="stat-input-pct">—</div>
      </div>
      <div class="card p-5">
        <div class="flex items-center justify-between">
          <div class="stat-label">Output Tokens</div>
          <span class="badge badge-green"><span class="dot" style="background:#22c55e"></span>Output</span>
        </div>
        <div class="stat-value mt-2" id="stat-output">—</div>
        <div class="stat-delta" id="stat-output-pct">—</div>
      </div>
    </div>

    <!-- Chart -->
    <div class="card p-5">
      <div class="flex items-center justify-between mb-4">
        <div>
          <div style="font-weight:600;font-size:0.92rem">Token Activity</div>
          <div style="color:#71717a;font-size:0.78rem;margin-top:2px">Input vs Output tokens over time</div>
        </div>
        <div class="flex items-center gap-4" style="font-size:0.78rem;color:#a1a1aa">
          <span class="flex items-center gap-1.5"><span class="dot" style="background:#3b82f6"></span>Input</span>
          <span class="flex items-center gap-1.5"><span class="dot" style="background:#22c55e"></span>Output</span>
        </div>
      </div>
      <div class="chart-container">
        <canvas id="tokenChart"></canvas>
      </div>
      <div id="chart-empty" style="display:none;text-align:center;padding:60px 0;color:#52525b;font-size:0.85rem">
        No token data yet for this time range.<br>
        <span style="font-size:0.78rem;color:#3f3f46">Send a request to see usage appear here.</span>
      </div>
    </div>

    <!-- Per-model breakdown -->
    <div class="card overflow-hidden">
      <div class="p-5 pb-0">
        <div style="font-weight:600;font-size:0.92rem">Model Breakdown</div>
        <div style="color:#71717a;font-size:0.78rem;margin-top:2px">Per-model aggregated totals</div>
      </div>
      <div style="overflow-x:auto;margin-top:16px">
        <table>
          <thead>
            <tr>
              <th>Model</th>
              <th style="text-align:right">Requests</th>
              <th style="text-align:right">Input Tokens</th>
              <th style="text-align:right">Output Tokens</th>
              <th style="text-align:right">Total Tokens</th>
              <th style="text-align:right">Input %</th>
            </tr>
          </thead>
          <tbody id="model-table-body">
            <tr><td colspan="6" style="text-align:center;color:#52525b;padding:32px">No data</td></tr>
          </tbody>
        </table>
      </div>
    </div>

  </div>
</div>

<script>
(function () {
  let currentRange = '1h'
  let chart = null
  let refreshTimer = null

  const fmt = (n) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
    return String(n)
  }

  const pct = (a, b) => b === 0 ? '0%' : ((a / b) * 100).toFixed(1) + '%'

  const formatTime = (tsSeconds, range) => {
    const d = new Date(tsSeconds * 1000)
    if (range === '30d' || range === '7d') {
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    }
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  }

  const setLoading = (loading) => {
    document.getElementById('spinner').style.display = loading ? 'block' : 'none'
  }

  const setLastUpdated = () => {
    const now = new Date()
    document.getElementById('last-updated').textContent =
      'Updated ' + now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  }

  const buildChart = (labels, inputData, outputData) => {
    const ctx = document.getElementById('tokenChart')
    if (chart) { chart.destroy(); chart = null }

    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Input',
            data: inputData,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59,130,246,0.08)',
            borderWidth: 2,
            pointRadius: inputData.length > 120 ? 0 : 3,
            pointHoverRadius: 5,
            fill: true,
            tension: 0.3,
          },
          {
            label: 'Output',
            data: outputData,
            borderColor: '#22c55e',
            backgroundColor: 'rgba(34,197,94,0.08)',
            borderWidth: 2,
            pointRadius: inputData.length > 120 ? 0 : 3,
            pointHoverRadius: 5,
            fill: true,
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#18181b',
            borderColor: '#3f3f46',
            borderWidth: 1,
            titleColor: '#fafafa',
            bodyColor: '#a1a1aa',
            padding: 12,
            callbacks: {
              label: (ctx) => ' ' + ctx.dataset.label + ': ' + ctx.raw.toLocaleString() + ' tokens',
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: { color: '#52525b', font: { size: 11 }, maxTicksLimit: 8, maxRotation: 0 },
            border: { color: '#27272a' },
          },
          y: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: { color: '#52525b', font: { size: 11 }, callback: (v) => fmt(v) },
            border: { color: '#27272a' },
            beginAtZero: true,
          },
        },
      },
    })
  }

  const renderModelTable = (data) => {
    const modelMap = {}
    for (const row of data) {
      if (!modelMap[row.model]) modelMap[row.model] = { input: 0, output: 0, requests: 0 }
      modelMap[row.model].input += row.input_tokens
      modelMap[row.model].output += row.output_tokens
      modelMap[row.model].requests += row.request_count
    }

    const models = Object.entries(modelMap).sort((a, b) => (b[1].input + b[1].output) - (a[1].input + a[1].output))
    const tbody = document.getElementById('model-table-body')

    if (models.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#52525b;padding:32px">No data for this range</td></tr>'
      return
    }

    const colors = ['#3b82f6','#22c55e','#a855f7','#f59e0b','#ec4899','#14b8a6','#f97316','#06b6d4']
    tbody.innerHTML = models.map(([model, stats], i) => {
      const total = stats.input + stats.output
      const color = colors[i % colors.length]
      const shortModel = model.length > 40 ? model.slice(0, 38) + '…' : model
      return \`<tr>
        <td>
          <div class="flex items-center gap-2">
            <span class="dot" style="background:\${color}"></span>
            <span class="mono" title="\${model}">\${shortModel}</span>
          </div>
        </td>
        <td style="text-align:right">\${stats.requests.toLocaleString()}</td>
        <td style="text-align:right"><span class="badge badge-blue">\${fmt(stats.input)}</span></td>
        <td style="text-align:right"><span class="badge badge-green">\${fmt(stats.output)}</span></td>
        <td style="text-align:right">\${fmt(total)}</td>
        <td style="text-align:right;color:#71717a">\${pct(stats.input, total)}</td>
      </tr>\`
    }).join('')
  }

  const aggregate = (data, range) => {
    let bucketSize = 60
    if (range === '7d') bucketSize = 3600
    else if (range === '30d') bucketSize = 86400
    else if (range === '24h') bucketSize = 1800
    else if (range === '6h') bucketSize = 600

    const buckets = {}
    for (const row of data) {
      const key = Math.floor(row.timestamp_min / bucketSize) * bucketSize
      if (!buckets[key]) buckets[key] = { input: 0, output: 0 }
      buckets[key].input += row.input_tokens
      buckets[key].output += row.output_tokens
    }
    const keys = Object.keys(buckets).map(Number).sort((a, b) => a - b)
    return {
      labels: keys.map(k => formatTime(k, range)),
      inputData: keys.map(k => buckets[k].input),
      outputData: keys.map(k => buckets[k].output),
    }
  }

  const getBudgetColor = (pctUsed) => {
    if (pctUsed >= 95) return '#ef4444'
    if (pctUsed >= 80) return '#f59e0b'
    return '#22c55e'
  }

  const quotaLabel = { premium_interactions: 'Premium Interactions', chat: 'Chat', completions: 'Completions' }

  const renderQuotaCard = (key, quota) => {
    const label = quotaLabel[key] ?? key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    if (quota.unlimited) {
      return \`<div class="card p-4">
        <div class="stat-label">\${label}</div>
        <div style="font-size:1.1rem;font-weight:600;margin-top:6px;color:#a1a1aa">∞ Unlimited</div>
        <div class="progress-track" style="margin-top:10px">
          <div class="progress-fill" style="width:100%;background:#3f3f46"></div>
        </div>
        <div style="font-size:0.75rem;color:#52525b;margin-top:6px">No usage limit</div>
      </div>\`
    }
    const used = quota.entitlement - quota.remaining
    const pctUsed = quota.entitlement === 0 ? 0 : Math.min(100, (used / quota.entitlement) * 100)
    const color = getBudgetColor(pctUsed)
    return \`<div class="card p-4">
      <div class="stat-label">\${label}</div>
      <div style="font-size:1.1rem;font-weight:600;margin-top:6px;color:\${color}">\${pctUsed.toFixed(1)}% used</div>
      <div class="progress-track" style="margin-top:10px">
        <div class="progress-fill" style="width:\${pctUsed}%;background:\${color}"></div>
      </div>
      <div style="font-size:0.75rem;color:#71717a;margin-top:6px">\${used.toLocaleString()} / \${quota.entitlement.toLocaleString()} used · \${quota.remaining.toLocaleString()} remaining</div>
    </div>\`
  }

  const fetchBudget = async () => {
    try {
      const res = await fetch('/usage')
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const json = await res.json()
      if (json.error) throw new Error(json.error)

      const plan = json.copilot_plan ?? ''
      const resetDate = json.quota_reset_date
        ? new Date(json.quota_reset_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
        : ''
      document.getElementById('budget-plan-badge').textContent = plan || 'Copilot'
      document.getElementById('budget-subtitle').textContent =
        'Monthly quota usage' + (resetDate ? ' · resets ' + resetDate : '')

      const snapshots = json.quota_snapshots ?? {}
      const order = ['premium_interactions', 'chat', 'completions']
      const keys = [...order.filter(k => snapshots[k]), ...Object.keys(snapshots).filter(k => !order.includes(k))]
      document.getElementById('budget-quotas').innerHTML = keys.map(k => renderQuotaCard(k, snapshots[k])).join('')
      document.getElementById('budget-section').style.display = 'block'
      document.getElementById('budget-error').style.display = 'none'
    } catch {
      document.getElementById('budget-section').style.display = 'none'
      document.getElementById('budget-error').style.display = 'block'
    }
  }

  const fetchAndRender = async () => {
    setLoading(true)
    try {
      const res = await fetch('/token-usage?range=' + currentRange)
      const json = await res.json()

      document.getElementById('stat-requests').textContent = json.summary.total_requests.toLocaleString()
      document.getElementById('stat-models').textContent =
        json.summary.models.length === 0 ? 'No models yet' :
        json.summary.models.length === 1 ? json.summary.models[0] :
        json.summary.models.length + ' models'

      const totalTokens = json.summary.total_input + json.summary.total_output
      document.getElementById('stat-input').textContent = fmt(json.summary.total_input)
      document.getElementById('stat-input-pct').textContent = pct(json.summary.total_input, totalTokens) + ' of total'
      document.getElementById('stat-output').textContent = fmt(json.summary.total_output)
      document.getElementById('stat-output-pct').textContent = pct(json.summary.total_output, totalTokens) + ' of total'

      const canvas = document.getElementById('tokenChart')
      const emptyMsg = document.getElementById('chart-empty')
      if (json.data.length === 0) {
        canvas.style.display = 'none'
        emptyMsg.style.display = 'block'
        if (chart) { chart.destroy(); chart = null }
      } else {
        canvas.style.display = 'block'
        emptyMsg.style.display = 'none'
        const { labels, inputData, outputData } = aggregate(json.data, currentRange)
        buildChart(labels, inputData, outputData)
      }

      renderModelTable(json.data)
      setLastUpdated()
    } catch (err) {
      console.error('Failed to fetch token usage:', err)
    } finally {
      setLoading(false)
    }
  }

  const startAutoRefresh = () => {
    if (refreshTimer) clearInterval(refreshTimer)
    refreshTimer = setInterval(fetchAndRender, 30_000)
  }

  document.querySelectorAll('.range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      currentRange = btn.dataset.range
      fetchAndRender()
    })
  })

  fetchAndRender()
  fetchBudget()
  startAutoRefresh()
})()
</script>
</body>
</html>`
