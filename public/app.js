/* global Chart */

const state = { data: null, charts: {}, unit: "eur", alloc: "current" };

const $ = (sel) => document.querySelector(sel);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const seriesColor = (i) => css(`--series-${(i % 8) + 1}`);

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const eur = (x, digits = 0) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: digits, minimumFractionDigits: digits }).format(x);
const eurCompact = (x) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 2 }).format(x);
const num = (x, digits = 2) =>
  new Intl.NumberFormat("en-IE", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(x);
const pct = (x, digits = 2) => (x == null ? "–" : `${x > 0 ? "+" : ""}${num(x, digits)}%`);
const signedEur = (x) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${eur(Math.abs(x))}`;
const priceFmt = (x) => num(x, x >= 1000 ? 2 : x >= 100 ? 3 : 3);
const dirClass = (x) => (x > 0 ? "up" : x < 0 ? "down" : "");
const arrow = (x) => (x > 0 ? "▲" : x < 0 ? "▼" : "■");
const shortDate = (iso) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const longDate = (iso) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// ---------- theme ----------

function applyStoredTheme() {
  try {
    const t = localStorage.getItem("theme");
    if (t) document.documentElement.dataset.theme = t;
  } catch {
    /* storage unavailable */
  }
}

function toggleTheme() {
  const root = document.documentElement;
  const isDark = root.dataset.theme
    ? root.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = isDark ? "light" : "dark";
  try {
    localStorage.setItem("theme", root.dataset.theme);
  } catch {
    /* storage unavailable */
  }
  if (state.data) renderCharts();
}

// ---------- data ----------

async function load(refresh = false) {
  const btn = $("#refresh");
  btn.disabled = true;
  btn.textContent = refresh ? "Refreshing…" : "Loading…";
  try {
    const res = await fetch(`/api/dashboard${refresh ? "?refresh=1" : ""}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || res.statusText);
    state.data = body;
    render();
  } catch (err) {
    showBanner(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Refresh data";
  }
}

function showBanner(message) {
  const el = $("#banner");
  el.hidden = !message;
  el.textContent = message || "";
}

// ---------- rendering ----------

function render() {
  const { meta } = state.data;
  $("#subtitle").textContent =
    `${meta.student} · ${meta.group} · started ${longDate(meta.startDate)} · evaluation ${longDate(meta.evaluationDate)}`;
  const fetched = new Date(meta.fetchedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  $("#freshness").textContent = `Closes through ${longDate(meta.dataThrough)} · fetched ${fetched}`;
  showBanner(meta.stale ? `Showing cached prices: the latest fetch failed (${meta.fetchError}).` : "");

  renderKpis();
  renderHoldings();
  renderAssetCards();
  renderCorrelations();
  renderPortfolioStats();
  renderClosesTable();
  renderCharts();
}

function renderKpis() {
  const { portfolio: p, assets, meta } = state.data;
  const byId = Object.fromEntries(assets.map((a) => [a.id, a]));
  const tiles = [
    { label: "Portfolio value", value: eur(p.value), sub: `Initial ${eur(p.initialValue)}` },
    {
      label: "Total P&L",
      value: `<span class="${dirClass(p.pnl)}">${signedEur(p.pnl)}</span>`,
      sub: `<span class="${dirClass(p.returnPct)}">${arrow(p.returnPct)} ${pct(p.returnPct)}</span> since start`,
    },
    {
      label: "Best asset",
      value: escapeHtml(p.best.id),
      sub: `<span class="${dirClass(p.best.returnPct)}">${arrow(p.best.returnPct)} ${pct(p.best.returnPct)}</span> · ${escapeHtml(byId[p.best.id].category)}`,
    },
    {
      label: "Worst asset",
      value: escapeHtml(p.worst.id),
      sub: `<span class="${dirClass(p.worst.returnPct)}">${arrow(p.worst.returnPct)} ${pct(p.worst.returnPct)}</span> · ${escapeHtml(byId[p.worst.id].category)}`,
    },
    {
      label: "Volatility (annualized)",
      value: p.stats.annualVolPct == null ? "–" : `${num(p.stats.annualVolPct)}%`,
      sub: `${p.stats.observations} trading days observed`,
    },
    {
      label: "Max drawdown",
      value: pct(p.maxDrawdown.pct),
      sub: p.maxDrawdown.troughDate ? `Trough ${shortDate(p.maxDrawdown.troughDate)}` : "No drawdown yet",
    },
    { label: "Days to evaluation", value: String(meta.daysToEvaluation), sub: longDate(meta.evaluationDate) },
  ];
  $("#kpis").innerHTML = tiles
    .map((t) => `<div class="kpi"><div class="label">${t.label}</div><div class="value">${t.value}</div><div class="sub">${t.sub}</div></div>`)
    .join("");
}

function renderHoldings() {
  const { assets, portfolio: p } = state.data;
  const rows = assets
    .map(
      (a, i) => `<tr>
        <td><span class="swatch" data-series="${i}"></span><strong>${escapeHtml(a.id)}</strong> <span class="muted">${escapeHtml(a.name)}</span></td>
        <td>${escapeHtml(a.category)}</td>
        <td>${priceFmt(a.initialPrice)}</td>
        <td>${a.lastClose == null ? "–" : priceFmt(a.lastClose)}</td>
        <td class="${dirClass(a.returnPct)}">${pct(a.returnPct)}</td>
        <td>${eur(a.allocation)}</td>
        <td>${eur(a.value)}</td>
        <td class="${dirClass(a.pnl)}">${signedEur(a.pnl)}</td>
        <td>${num(a.weightInitialPct, 1)}% → ${num(p.currentWeights[a.id], 1)}%</td>
      </tr>`,
    )
    .join("");
  $("#holdings").innerHTML = `<thead><tr>
      <th>Asset</th><th>Category</th><th>Initial price</th><th>Last close</th><th>Change</th>
      <th>Initial sum</th><th>Current value</th><th>P&amp;L</th><th>Weight (initial → now)</th>
    </tr></thead><tbody>${rows}</tbody>
    <tfoot><tr>
      <td><strong>Total</strong></td><td></td><td></td><td></td>
      <td class="${dirClass(p.returnPct)}"><strong>${pct(p.returnPct)}</strong></td>
      <td><strong>${eur(p.initialValue)}</strong></td><td><strong>${eur(p.value)}</strong></td>
      <td class="${dirClass(p.pnl)}"><strong>${signedEur(p.pnl)}</strong></td><td>100%</td>
    </tr></tfoot>`;
}

function renderAssetCards() {
  const { assets } = state.data;
  $("#assets").innerHTML = assets
    .map(
      (a, i) => `<article class="card asset-card" data-asset="${escapeHtml(a.id)}">
        <h3><span class="swatch" data-series="${i}"></span>${escapeHtml(a.name)}</h3>
        <div class="ticker">${escapeHtml(a.indicator)} · ${escapeHtml(a.venue)} · ${escapeHtml(a.symbol)}</div>
        <div class="figures">
          <div><span>Initial (Excel)</span><strong>${priceFmt(a.initialPrice)}</strong></div>
          <div><span>Close${a.lastDate ? ` ${shortDate(a.lastDate)}` : ""}</span><strong>${a.lastClose == null ? "–" : priceFmt(a.lastClose)}</strong></div>
          <div><span>Change</span><strong class="${dirClass(a.returnPct)}">${arrow(a.returnPct)} ${pct(a.returnPct)}</strong></div>
          <div><span>P&amp;L</span><strong class="${dirClass(a.pnl)}">${signedEur(a.pnl)}</strong></div>
        </div>
        <div class="chart chart-sm"><canvas id="asset-${escapeHtml(a.id)}"></canvas></div>
        <dl class="stats compact">
          <dt>Position value</dt><dd>${eur(a.value)} (${num(a.units, a.units < 100 ? 4 : 0)} units)</dd>
          <dt>Contribution to portfolio</dt><dd class="${dirClass(a.contributionPct)}">${pct(a.contributionPct, 3)}</dd>
          <dt>Daily volatility · annualized</dt><dd>${a.stats.dailyVolPct == null ? "–" : `${num(a.stats.dailyVolPct, 3)}% · ${num(a.stats.annualVolPct, 1)}%`}</dd>
          <dt>Max drawdown</dt><dd>${pct(a.maxDrawdown.pct)}</dd>
          <dt>Best day</dt><dd>${a.stats.bestDay ? `${pct(a.stats.bestDay.pct)} (${shortDate(a.stats.bestDay.date)})` : "–"}</dd>
          <dt>Worst day</dt><dd>${a.stats.worstDay ? `${pct(a.stats.worstDay.pct)} (${shortDate(a.stats.worstDay.date)})` : "–"}</dd>
          <dt>Range (low – high)</dt><dd>${a.low == null ? "–" : `${priceFmt(a.low)} – ${priceFmt(a.high)}`}</dd>
          <dt>Up / down days</dt><dd>${a.stats.upDays} / ${a.stats.downDays}</dd>
        </dl>
        <details>
          <summary>Daily closes (${a.history.length} days)</summary>
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Date</th><th>Close</th><th>Day</th><th>vs initial</th><th>Value</th></tr></thead>
            <tbody>
              <tr class="initial"><td>Initial (Excel)</td><td>${priceFmt(a.initialPrice)}</td><td></td><td></td><td>${eur(a.allocation)}</td></tr>
              ${a.history
                .map(
                  (h) => `<tr><td>${longDate(h.date)}</td><td>${priceFmt(h.close)}</td>
                    <td class="${dirClass(h.dailyPct)}">${pct(h.dailyPct)}</td>
                    <td class="${dirClass(h.changePct)}">${pct(h.changePct)}</td><td>${eur(h.value)}</td></tr>`,
                )
                .join("")}
            </tbody>
          </table></div>
        </details>
      </article>`,
    )
    .join("");
  paintSwatches();
}

function paintSwatches() {
  document.querySelectorAll(".swatch[data-series]").forEach((el) => {
    el.style.background = seriesColor(Number(el.dataset.series));
  });
}

function corrColor(c) {
  // Diverging: red (−1) → neutral (0) → blue (+1), mixed over the neutral midpoint.
  if (c == null) return "transparent";
  const pole = c >= 0 ? css("--diverge-pos") : css("--diverge-neg");
  const share = Math.round(Math.min(1, Math.abs(c)) * 85);
  return `color-mix(in oklab, ${pole} ${share}%, ${css("--diverge-mid")})`;
}

function renderCorrelations() {
  const { ids, matrix } = state.data.portfolio.correlations;
  const head = `<thead><tr><th></th>${ids.map((id) => `<th>${escapeHtml(id)}</th>`).join("")}</tr></thead>`;
  const body = matrix
    .map((row, i) => {
      const cells = row
        .map((c, j) => {
          const strong = c != null && Math.abs(c) >= 0.6;
          const color = strong ? "#fff" : "var(--text-primary)";
          return `<td style="background:${i === j ? "var(--wash)" : corrColor(c)};color:${color}" title="${ids[i]} vs ${ids[j]}">${c == null ? "–" : num(c, 2)}</td>`;
        })
        .join("");
      return `<tr><th>${escapeHtml(ids[i])}</th>${cells}</tr>`;
    })
    .join("");
  $("#correlations").innerHTML = head + `<tbody>${body}</tbody>`;
}

function renderPortfolioStats() {
  const { portfolio: p, meta } = state.data;
  const s = p.stats;
  const items = [
    ["Initial value", eur(p.initialValue)],
    ["Current value", eur(p.value)],
    ["Delta growth (Excel formula)", pct(p.returnPct, 3)],
    ["Average daily return", pct(s.avgDailyPct, 3)],
    ["Daily volatility", s.dailyVolPct == null ? "–" : `${num(s.dailyVolPct, 3)}%`],
    ["Annualized volatility", s.annualVolPct == null ? "–" : `${num(s.annualVolPct)}%`],
    ["Best day", s.bestDay ? `${pct(s.bestDay.pct)} (${shortDate(s.bestDay.date)})` : "–"],
    ["Worst day", s.worstDay ? `${pct(s.worstDay.pct)} (${shortDate(s.worstDay.date)})` : "–"],
    ["Up / down days", `${s.upDays} / ${s.downDays}`],
    [
      "Max drawdown",
      p.maxDrawdown.troughDate
        ? `${pct(p.maxDrawdown.pct)} (${shortDate(p.maxDrawdown.peakDate ?? meta.startDate)} → ${shortDate(p.maxDrawdown.troughDate)})`
        : "0.00%",
    ],
    ["Trading days observed", String(s.observations)],
  ];
  $("#portfolioStats").innerHTML = items.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
}

function renderClosesTable() {
  const { assets, portfolio: p } = state.data;
  const closeMaps = assets.map((a) => new Map(a.history.map((h) => [h.date, h.close])));
  const head = `<thead><tr><th>Date</th>${assets
    .map((a, i) => `<th><span class="swatch" data-series="${i}"></span>${escapeHtml(a.id)}</th>`)
    .join("")}<th>Portfolio</th></tr></thead>`;
  const initial = `<tr class="initial"><td>Initial (Excel)</td>${assets
    .map((a) => `<td>${priceFmt(a.initialPrice)}</td>`)
    .join("")}<td>${eur(p.initialValue)}</td></tr>`;
  const rows = p.series
    .map(
      (pt) => `<tr><td>${longDate(pt.date)}</td>${closeMaps
        .map((m) => `<td>${m.has(pt.date) ? priceFmt(m.get(pt.date)) : '<span class="muted">–</span>'}</td>`)
        .join("")}<td class="${dirClass(pt.returnPct)}">${eur(pt.value)}</td></tr>`,
    )
    .join("");
  $("#closes").innerHTML = `${head}<tbody>${initial}${rows}</tbody>`;
  paintSwatches();
}

// ---------- charts ----------

function baseOptions({ yFormat, tooltipLabel, legend = true }) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: legend, position: "bottom", labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 2 } },
      tooltip: { callbacks: { label: tooltipLabel } },
    },
    scales: {
      x: { grid: { display: false }, border: { color: css("--axis") }, ticks: { maxTicksLimit: 8, maxRotation: 0 } },
      y: { grid: { color: css("--grid") }, border: { display: false }, ticks: { callback: yFormat, maxTicksLimit: 6 } },
    },
  };
}

function lineDataset(label, data, color, extra = {}) {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 5,
    pointHoverBorderWidth: 2,
    pointHoverBorderColor: css("--surface"),
    tension: 0,
    ...extra,
  };
}

function baselineDataset(label, value, length) {
  return lineDataset(label, Array(length).fill(value), css("--text-muted"), {
    borderWidth: 1,
    borderDash: [4, 4],
    pointHoverRadius: 0,
  });
}

function replaceChart(key, canvas, config) {
  state.charts[key]?.destroy();
  if (canvas) state.charts[key] = new Chart(canvas, config);
}

function renderCharts() {
  const { portfolio: p, assets } = state.data;
  Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = css("--text-secondary");
  Chart.defaults.borderColor = css("--grid");
  paintSwatches();

  const labels = p.series.map((pt) => shortDate(pt.date));

  // Portfolio value / return
  const asPct = state.unit === "pct";
  const portfolioValues = p.series.map((pt) => (asPct ? pt.returnPct : pt.value));
  replaceChart("portfolio", $("#portfolioChart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        lineDataset("Portfolio", portfolioValues, seriesColor(0), {
          fill: { target: { value: asPct ? 0 : p.initialValue } },
          backgroundColor: `${seriesColor(0)}1f`,
        }),
        baselineDataset(asPct ? "Start (0%)" : "Initial value", asPct ? 0 : p.initialValue, labels.length),
      ],
    },
    options: baseOptions({
      yFormat: (v) => (asPct ? `${num(v, 1)}%` : eurCompact(v)),
      tooltipLabel: (ctx) => `${ctx.dataset.label}: ${asPct ? pct(ctx.parsed.y) : eur(ctx.parsed.y)}`,
    }),
  });

  // Allocation doughnut
  const allocValues = assets.map((a) => (state.alloc === "current" ? a.value : a.allocation));
  const allocTotal = allocValues.reduce((x, y) => x + y, 0);
  replaceChart("allocation", $("#allocationChart"), {
    type: "doughnut",
    data: {
      labels: assets.map((a) => a.id),
      datasets: [
        {
          data: allocValues,
          backgroundColor: assets.map((_, i) => seriesColor(i)),
          borderColor: css("--surface"),
          borderWidth: 2,
          hoverOffset: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      cutout: "62%",
      plugins: {
        legend: {
          position: "right",
          labels: {
            boxWidth: 10,
            boxHeight: 10,
            useBorderRadius: true,
            borderRadius: 2,
            generateLabels: (chart) =>
              Chart.overrides.doughnut.plugins.legend.labels.generateLabels(chart).map((l, i) => ({
                ...l,
                text: `${l.text}  ${num((allocValues[i] / allocTotal) * 100, 1)}%`,
              })),
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: ${eur(ctx.parsed)} (${num((ctx.parsed / allocTotal) * 100, 1)}%)`,
          },
        },
      },
    },
  });

  // Cumulative return per asset over the shared date axis (gaps where an asset didn't trade)
  const returnsDatasets = assets.map((a, i) => {
    const byDate = new Map(a.history.map((h) => [h.date, h.changePct]));
    return lineDataset(
      a.id,
      p.series.map((pt) => byDate.get(pt.date) ?? null),
      seriesColor(i),
      { spanGaps: true },
    );
  });
  replaceChart("returns", $("#returnsChart"), {
    type: "line",
    data: { labels, datasets: returnsDatasets },
    options: {
      ...baseOptions({
        yFormat: (v) => `${num(v, 0)}%`,
        tooltipLabel: (ctx) => (ctx.parsed.y == null ? null : `${ctx.dataset.label}: ${pct(ctx.parsed.y)}`),
      }),
    },
  });

  // Contribution bars
  const contributions = assets.map((a) => a.contributionPct);
  replaceChart("contribution", $("#contributionChart"), {
    type: "bar",
    data: {
      labels: assets.map((a) => a.id),
      datasets: [
        {
          label: "Contribution",
          data: contributions,
          backgroundColor: assets.map((_, i) => seriesColor(i)),
          borderRadius: 4,
          borderSkipped: "start",
          barPercentage: 0.7,
          categoryPercentage: 0.9,
        },
      ],
    },
    options: {
      ...baseOptions({
        yFormat: undefined,
        tooltipLabel: (ctx) => {
          const a = assets[ctx.dataIndex];
          return `${pct(ctx.parsed.x, 3)} of portfolio (${signedEur(a.pnl)})`;
        },
        legend: false,
      }),
      indexAxis: "y",
      interaction: { mode: "nearest", axis: "y", intersect: false },
      scales: {
        x: {
          grid: { color: (c) => (c.tick.value === 0 ? css("--axis") : css("--grid")) },
          border: { display: false },
          ticks: { callback: (v) => `${num(v, 2)}%`, maxTicksLimit: 6 },
        },
        y: { grid: { display: false }, border: { display: false } },
      },
    },
  });

  // Per-asset close price charts
  assets.forEach((a, i) => {
    const assetLabels = a.history.map((h) => shortDate(h.date));
    replaceChart(`asset-${a.id}`, document.getElementById(`asset-${a.id}`), {
      type: "line",
      data: {
        labels: assetLabels,
        datasets: [
          lineDataset("Close", a.history.map((h) => h.close), seriesColor(i)),
          baselineDataset("Initial (Excel)", a.initialPrice, assetLabels.length),
        ],
      },
      options: (() => {
        const o = baseOptions({
          yFormat: (v) => num(v, a.initialPrice >= 1000 ? 0 : 2),
          tooltipLabel: (ctx) => `${ctx.dataset.label}: ${priceFmt(ctx.parsed.y)} ${a.currency}`,
          legend: false,
        });
        o.scales.x.ticks.maxTicksLimit = 5;
        o.scales.y.ticks.maxTicksLimit = 4;
        return o;
      })(),
    });
  });
}

// ---------- events ----------

applyStoredTheme();
$("#theme").addEventListener("click", toggleTheme);
$("#refresh").addEventListener("click", () => load(true));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => state.data && renderCharts());

document.querySelectorAll("[data-unit]").forEach((btn) =>
  btn.addEventListener("click", () => {
    state.unit = btn.dataset.unit;
    document.querySelectorAll("[data-unit]").forEach((b) => b.classList.toggle("active", b === btn));
    renderCharts();
  }),
);
document.querySelectorAll("[data-alloc]").forEach((btn) =>
  btn.addEventListener("click", () => {
    state.alloc = btn.dataset.alloc;
    document.querySelectorAll("[data-alloc]").forEach((b) => b.classList.toggle("active", b === btn));
    renderCharts();
  }),
);

load();
