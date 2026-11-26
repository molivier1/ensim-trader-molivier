"use strict";

const ROOT = "https://raw.githubusercontent.com/exofri/ensim-trade-center/refs/heads/main/";
// Bot commits do not trigger a Pages build. Read tracking files directly from
// the repository on Pages; retain local files for local development.
const TRACKING_ROOT = location.hostname === "molivier1.github.io"
  ? "https://raw.githubusercontent.com/molivier1/ensim-trader-molivier/main/docs/data/"
  : "data/";
const URLS = {
  market: ROOT + "docs/data/market.json",
  holdings: ROOT + "traders/molivier/holdings.json",
  ranking: ROOT + "docs/data/leaderboard.json",
  history: TRACKING_ROOT + "portfolio_history.json",
  decisions: TRACKING_ROOT + "decision_log.json",
  config: TRACKING_ROOT + "strategy.json",
};
const BASELINES = [
  { key: "random_trader", label: "Trader aléatoire", color: "#b7752e" },
  { key: "random_buyer", label: "Acheteur aléatoire", color: "#527f6c" },
  { key: "random_seller", label: "Vendeur aléatoire", color: "#8b6ba4" },
];
const $ = id => document.getElementById(id);
const number = value => Number.isFinite(value) ? value.toLocaleString("fr-FR", { maximumFractionDigits: 2 }) : "—";
const priceNumber = value => Number.isFinite(value) ? value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : "—";
const percent = value => Number.isFinite(value) ? number(value) + " %" : "—";
const date = (value, short = false) => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "—";
  return parsed.toLocaleString("fr-FR", short
    ? { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit" }
    : { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
let state = {};
let selectedProduct = "A";
let decisionPage = 1;
const DECISIONS_PER_PAGE = 15;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function tableRow(body, values) {
  const row = element("tr");
  values.forEach(value => row.append(element("td", value)));
  body.append(row);
}
function emptyTable(id, columns, message) {
  const body = $(id);
  body.replaceChildren();
  const row = element("tr");
  const cell = element("td", message, "muted");
  cell.colSpan = columns;
  row.append(cell);
  body.append(row);
}
function emptyChart(id, message) {
  $(id).replaceChildren(element("p", message, "empty"));
}
function legend(id, series) {
  $(id).replaceChildren();
  series.forEach(item => {
    const entry = element("span");
    const swatch = element("i");
    swatch.style.background = item.color;
    entry.append(swatch, document.createTextNode(item.label));
    $(id).append(entry);
  });
}
function svgNode(tag, attributes = {}, text) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  if (text !== undefined) node.textContent = text;
  return node;
}
function chart(id, points, series, title, unit = "") {
  const valid = points.filter(point => Number.isFinite(Date.parse(point.timestamp)));
  const values = valid.flatMap(point => series.map(s => point[s.key])).filter(Number.isFinite);
  if (!values.length || valid.length < 2) {
    emptyChart(id, "Au moins deux observations sont nécessaires pour afficher une courbe.");
    return;
  }
  const width = Math.max(300, Math.min(id === "risk-chart" ? 500 : 1000, $(id).clientWidth));
  const height = id === "risk-chart" ? 215 : 275;
  const left = 65, right = width - 20, top = 14, bottom = height - 35;
  const start = Date.parse(valid[0].timestamp), end = Date.parse(valid.at(-1).timestamp);
  let low = Math.min(...values), high = Math.max(...values);
  const padding = (high - low || Math.abs(high) || 1) * 0.1;
  low -= padding; high += padding;
  const x = timestamp => left + (Date.parse(timestamp) - start) / (end - start || 1) * (right - left);
  const y = value => bottom - (value - low) / (high - low) * (bottom - top);
  const svg = svgNode("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": title });
  svg.append(svgNode("title", {}, title));
  for (let i = 0; i <= 4; i++) {
    const value = low + (high - low) * i / 4;
    svg.append(svgNode("line", { x1: left, x2: right, y1: y(value), y2: y(value), stroke: "#e4e9ed" }));
    svg.append(svgNode("text", { x: left - 9, y: y(value) + 4, "text-anchor": "end", fill: "#596774", "font-size": 11 }, number(value) + unit));
  }
  for (const [index, timestamp] of [valid[0].timestamp, valid[Math.floor(valid.length / 2)].timestamp, valid.at(-1).timestamp].entries()) {
    svg.append(svgNode("text", { x: x(timestamp), y: height - 10, "text-anchor": index === 0 ? "start" : index === 2 ? "end" : "middle", fill: "#596774", "font-size": 11 }, date(timestamp, true)));
  }
  series.forEach(item => {
    let path = "", active = false;
    valid.forEach(point => {
      if (!Number.isFinite(point[item.key])) { active = false; return; }
      path += `${active ? "L" : "M"}${x(point.timestamp).toFixed(2)},${y(point[item.key]).toFixed(2)} `;
      active = true;
    });
    const line = svgNode("path", { d: path, fill: "none", stroke: item.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-dasharray": item.dashed ? "6 4" : "none" });
    line.append(svgNode("title", {}, item.label));
    svg.append(line);
    const last = valid.at(-1);
    if (Number.isFinite(last[item.key])) svg.append(svgNode("circle", { cx: x(last.timestamp), cy: y(last[item.key]), r: 3, fill: item.color }));
  });
  $(id).replaceChildren(svg);
}

function indicator(rows, product, index = rows.length - 1) {
  const window = state.config?.window;
  const price = rows[index]?.[product];
  if (!window) return { price, low: null, high: null, zone: "Configuration indisponible" };
  if (product === "B") return { price, low: null, high: null, zone: state.config.b_mode === "hold" ? "Conserver sans achat ni vente" : `Cible : ${number(state.config.b_target_weight * 100)} % du portefeuille` };
  if (product === "C") return { price, low: null, high: null, zone: "Réduire la position sans acheter" };
  if (product !== "A") return { price, low: null, high: null, zone: "Aucune stratégie définie" };
  if (index + 1 < window) return { price, low: null, high: null, zone: "Historique insuffisant" };
  const prices = rows.slice(index + 1 - window, index + 1).map(row => row[product]).sort((a, b) => a - b);
  const low = prices[Math.floor(state.config.entry_quantile * (window - 1))];
  const high = prices[Math.floor(state.config.exit_quantile * (window - 1))];
  const zone = low === high ? "Conserver : seuils confondus" : price <= low ? `Zone basse : viser ${number(state.config.a_target_weight * 100)} %` : price >= high ? "Zone haute : vendre" : "Conserver la position";
  return { price, low, high, zone };
}

function renderPrices() {
  const market = state.market;
  $("indicators").replaceChildren();
  if (!market) {
    emptyChart("price-chart", "Les prix du marché sont temporairement indisponibles.");
    emptyTable("indicators", 5, "Impossible de calculer les indicateurs sans les prix.");
    $("price-legend").replaceChildren();
    $("market-time").textContent = "";
    return;
  }
  if (!market.products.includes(selectedProduct)) selectedProduct = market.products[0];
  $("products").replaceChildren();
  market.products.forEach(product => {
    const button = element("button", product);
    button.type = "button";
    button.setAttribute("aria-pressed", String(product === selectedProduct));
    button.addEventListener("click", () => { selectedProduct = product; renderPrices(); });
    $("products").append(button);
    const item = indicator(market.history, product);
    tableRow($("indicators"), [product, number(item.price), number(item.low), number(item.high), item.zone]);
  });
  const points = market.history.map((row, index) => {
    const item = indicator(market.history, selectedProduct, index);
    return { timestamp: row.timestamp, price: item.price, low: item.low, high: item.high };
  });
  const count = Number($("period").value);
  const series = [{ key: "price", label: "Prix " + selectedProduct, color: "#315c86" }];
  if (selectedProduct === "A") series.push({ key: "low", label: "Seuil bas A", color: "#657a65", dashed: true }, { key: "high", label: "Seuil haut A", color: "#b77b32", dashed: true });
  chart("price-chart", count ? points.slice(-count) : points, series, "Prix et seuils de stratégie du produit " + selectedProduct);
  legend("price-legend", series);
  $("market-time").textContent = `Dernier prix : ${date(market.history.at(-1)?.timestamp)} (heure de Paris). ${market.history.length} observations. La zone de prix seule ne détermine pas la quantité à demander : celle-ci dépend du portefeuille.`;
}

// Estimate a per-tick linear trend from recent observations and damp it over
// the forecast horizon. No timestamps are invented for the future ticks.
function estimatePrice(prices, horizon) {
  const size = 12;
  if (prices.length < size) return null;
  const recent = prices.slice(-size);
  const mid = (size - 1) / 2;
  const mean = recent.reduce((sum, value) => sum + value, 0) / size;
  let numerator = 0, denominator = 0;
  recent.forEach((value, index) => {
    numerator += (index - mid) * (value - mean);
    denominator += (index - mid) ** 2;
  });
  const dampedSteps = Array.from({ length: horizon }, (_, i) => 0.8 ** i).reduce((sum, value) => sum + value, 0);
  return Math.max(0.01, recent.at(-1) + numerator / denominator * dampedSteps);
}

function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position), high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

function projection(prices, horizon) {
  const estimate = estimatePrice(prices, horizon);
  if (estimate === null) return null;
  const errors = [];
  // Rolling-origin errors use only data that was already available at each origin.
  for (let end = Math.max(12, prices.length - horizon - 119); end <= prices.length - horizon; end++) {
    const pastEstimate = estimatePrice(prices.slice(0, end), horizon);
    errors.push(prices[end + horizon - 1] - pastEstimate);
  }
  return {
    estimate,
    low: errors.length >= 20 ? Math.max(0.01, estimate + quantile(errors, 0.1)) : null,
    high: errors.length >= 20 ? Math.max(0.01, estimate + quantile(errors, 0.9)) : null,
    sampleSize: errors.length,
  };
}

function renderProjections() {
  const market = state.market;
  $("projection-head").replaceChildren();
  $("projections").replaceChildren();
  $("projection-note").textContent = "";
  if (!market) {
    emptyTable("projections", 4, "Prix indisponibles : projections impossibles.");
    return;
  }
  const header = element("tr");
  ["Tick", ...market.products].forEach(label => header.append(element("th", label)));
  $("projection-head").append(header);
  if (market.history.length < 12) {
    emptyTable("projections", market.products.length + 1, "Au moins 12 observations sont nécessaires.");
    return;
  }
  let minSample = Infinity, maxSample = 0;
  for (let horizon = 1; horizon <= 5; horizon++) {
    const cells = market.products.map(product => {
      const result = projection(market.history.map(row => row[product]), horizon);
      minSample = Math.min(minSample, result.sampleSize);
      maxSample = Math.max(maxSample, result.sampleSize);
      return result.low === null ? priceNumber(result.estimate) : `${priceNumber(result.estimate)} [${priceNumber(result.low)} ; ${priceNumber(result.high)}]`;
    });
    tableRow($("projections"), [`+${horizon}`, ...cells]);
  }
  $("projection-note").textContent = `À partir du dernier prix connu du ${date(market.history.at(-1).timestamp)} (heure de Paris). Les crochets utilisent les 10e et 90e percentiles des erreurs historiques (${minSample} à ${maxSample} essais selon le tick). ${minSample < 20 ? "Historique insuffisant pour afficher une fourchette sur certains ticks. " : ""}Le rythme des ticks est variable et aucune date future n’est estimée.`;
}

function renderPortfolio() {
  const lastPrices = state.market?.history.at(-1);
  const holdings = state.holdings;
  let currentValue = null;
  $("portfolio-value").textContent = "—";
  $("cash").textContent = number(holdings?.money);
  $("holdings").replaceChildren();
  if (holdings && lastPrices) {
    currentValue = holdings.money + state.market.products.reduce((sum, p) => sum + (holdings.products[p] ?? 0) * lastPrices[p], 0);
    $("portfolio-value").textContent = number(currentValue);
    state.market.products.forEach(p => {
      const units = holdings.products[p] ?? 0, value = units * lastPrices[p];
      tableRow($("holdings"), [p, number(units), number(value), currentValue > 0 ? percent(value / currentValue * 100) : "—"]);
    });
    tableRow($("holdings"), ["Cash", "—", number(holdings.money), currentValue > 0 ? percent(holdings.money / currentValue * 100) : "—"]);
  } else emptyTable("holdings", 4, "En attente du portefeuille et des prix officiels.");

  $("comparison").replaceChildren();
  if (!state.ranking?.leaderboard?.length) {
    emptyTable("comparison", 4, "Classement officiel indisponible ou vide.");
  } else state.ranking.leaderboard.forEach((row, index) => {
    const name = row.name || row.id || "Participant sans nom";
    const type = row.id === "molivier" ? "Mon portefeuille" : row.baseline ? "Référence" : "Participant";
    tableRow($("comparison"), [String(index + 1), name, number(row.total_value), type]);
  });

  const snapshots = state.history?.snapshots ?? [];
  $("return").textContent = "—";
  $("max-drawdown").textContent = "—";
  if (snapshots.length < 2) {
    emptyChart("risk-chart", "Le risque sera calculé après au moins deux observations réelles du portefeuille.");
    $("risk-note").textContent = "Le suivi ne reconstitue pas la période antérieure à ton inscription.";
  } else {
    let peak = snapshots[0].total_value;
    const risks = snapshots.map(row => {
      peak = Math.max(peak, row.total_value);
      return { timestamp: row.market_timestamp, drawdown: peak > 0 ? (peak - row.total_value) / peak * 100 : 0 };
    });
    $("return").textContent = snapshots[0].total_value > 0 ? percent((snapshots.at(-1).total_value / snapshots[0].total_value - 1) * 100) : "—";
    $("max-drawdown").textContent = percent(Math.max(...risks.map(row => row.drawdown)));
    chart("risk-chart", risks, [{ key: "drawdown", label: "Baisse depuis un sommet", color: "#9a5854" }], "Baisse du portefeuille depuis son sommet observé", " %");
    $("risk-note").textContent = `Suivi enregistré du ${date(snapshots[0].market_timestamp)} au ${date(snapshots.at(-1).market_timestamp)} : ${snapshots.length} observations. Rendement et risque portent sur ce suivi, pas sur la période entière du marché.`;
  }

  // Start all four curves on the same first observation with complete values.
  const commonStart = snapshots.findIndex(row => row.total_value > 0 && BASELINES.every(b => row.baselines?.[b.key] > 0));
  const common = commonStart >= 0 ? snapshots.slice(commonStart) : [];
  const series = [{ key: "portfolio", label: "Mon portefeuille", color: "#315c86" }, ...BASELINES];
  if (common.length < 2) {
    emptyChart("performance-chart", "Les courbes apparaîtront après deux enregistrements réels avec les trois références officielles.");
    $("performance-legend").replaceChildren();
  } else {
    const first = common[0];
    const points = common.map(row => ({ timestamp: row.market_timestamp, portfolio: row.total_value / first.total_value * 100,
      ...Object.fromEntries(BASELINES.map(b => [b.key, Number.isFinite(row.baselines?.[b.key]) ? row.baselines[b.key] / first.baselines[b.key] * 100 : null])) }));
    chart("performance-chart", points, series, "Performance comparée du portefeuille et des trois références, base 100");
    legend("performance-legend", series);
  }
  $("performance-note").textContent = `Classement officiel : ${date(state.ranking?.generated_at)}. L’historique est enregistré par le script et GitHub Actions, même lorsque cette page est fermée. Les valeurs manquantes ne sont pas interpolées.`;
}

function renderDecisions() {
  const entries = state.decisions?.decisions ?? [];
  const productSelect = $("decision-product");
  const selected = productSelect.value;
  const rows = entries.flatMap(entry => Object.entries(entry.signals).map(([product, signal]) => ({
    timestamp: entry.updated_at, product, signal, reason: entry.reasons?.[product] ?? "Raison non disponible",
  })));
  const products = [...new Set(rows.map(row => row.product))].sort((a, b) => a.localeCompare(b, "fr"));
  const options = [Object.assign(element("option", "Tous les produits"), { value: "" }),
    ...products.map(product => Object.assign(element("option", product), { value: product }))];
  productSelect.replaceChildren(...options);
  productSelect.value = products.includes(selected) ? selected : "";

  const filtered = rows.filter(row => !productSelect.value || row.product === productSelect.value);
  filtered.sort((a, b) => {
    const byDate = (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0);
    return $("decision-sort").value === "product" ? a.product.localeCompare(b.product, "fr") || byDate : byDate;
  });
  const pages = Math.max(1, Math.ceil(filtered.length / DECISIONS_PER_PAGE));
  decisionPage = Math.min(Math.max(1, decisionPage), pages);
  $("decision-prev").disabled = decisionPage <= 1;
  $("decision-next").disabled = decisionPage >= pages;
  $("decision-page").textContent = `${filtered.length} décision${filtered.length === 1 ? "" : "s"} · Page ${decisionPage} / ${pages}`;
  $("decisions").replaceChildren();
  if (!filtered.length) {
    emptyTable("decisions", 5, entries.length ? "Aucune décision pour ce produit." : "Aucune décision enregistrée.");
    return;
  }
  filtered.slice((decisionPage - 1) * DECISIONS_PER_PAGE, decisionPage * DECISIONS_PER_PAGE).forEach(row => {
    tableRow($("decisions"), [date(row.timestamp), row.product, number(row.signal), (row.signal > 0 ? "+" : "") + number(row.signal * 100), row.reason]);
  });
}

async function fetchJSON(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return await response.json();
  } finally { clearTimeout(timer); }
}

async function refresh() {
  if ($("refresh").disabled) return;
  $("refresh").disabled = true;
  const keys = Object.keys(URLS);
  const results = await Promise.allSettled(keys.map(key => fetchJSON(URLS[key])));
  state = Object.fromEntries(keys.map((key, index) => [key, results[index].status === "fulfilled" ? results[index].value : null]));
  const messages = [];
  const failed = key => results[keys.indexOf(key)];
  if (!Array.isArray(state.market?.products) || !state.market.products.length || !Array.isArray(state.market?.history) || !state.market.history.length || !state.market.history.every(row => row && Number.isFinite(Date.parse(row.timestamp)) && state.market.products.every(p => Number.isFinite(row[p]) && row[p] > 0))) {
    state.market = null;
    messages.push("Prix du marché indisponibles ou invalides.");
  }
  if (!state.holdings || !Number.isFinite(state.holdings.money) || !state.holdings.products || Object.values(state.holdings.products).some(value => !Number.isFinite(value) || value < 0)) {
    state.holdings = null;
    messages.push(failed("holdings").reason?.status === 404 ? "Ton portefeuille n’est pas encore disponible (404). Les prix et le classement restent consultables." : "Portefeuille indisponible : vérifier le flux officiel ou réessayer.");
  }
  if (!Array.isArray(state.ranking?.leaderboard) || state.ranking.leaderboard.some(row => !row || typeof row !== "object")) { state.ranking = null; messages.push("Classement officiel indisponible."); }
  if (!Array.isArray(state.history?.snapshots) || state.history.snapshots.some(row => !row || !Number.isFinite(row.total_value) || row.total_value < 0 || !Number.isFinite(Date.parse(row.market_timestamp)))) { state.history = null; messages.push("Historique de suivi indisponible ou invalide."); }
  if (!Array.isArray(state.decisions?.decisions) || state.decisions.decisions.some(row => !row || !row.signals || Object.values(row.signals).some(value => !Number.isFinite(value)))) { state.decisions = null; messages.push("Journal des décisions indisponible."); }
  if (!Number.isInteger(state.config?.window) || state.config.window < 2 || !Number.isFinite(state.config.entry_quantile) || !Number.isFinite(state.config.exit_quantile) || state.config.entry_quantile < 0 || state.config.exit_quantile > 1 || state.config.entry_quantile >= state.config.exit_quantile || !Number.isFinite(state.config.a_target_weight) || !(state.config.b_mode === "hold" || Number.isFinite(state.config.b_target_weight))) { state.config = null; messages.push("Configuration des indicateurs indisponible."); }
  if (location.protocol === "file:") messages.push("Pour charger les fichiers de suivi, ouvrir cette page via un serveur local ou GitHub Pages.");
  $("status").textContent = messages.length ? messages.join("\n") : "Flux chargés. Les projections sont des estimations ; les autres valeurs proviennent des données disponibles.";
  $("status").classList.toggle("warning", messages.length > 0);
  renderPrices(); renderProjections(); renderPortfolio(); renderDecisions();
  $("refreshed").textContent = "Consulté le " + date(new Date().toISOString());
  $("refresh").disabled = false;
}

$("market-source").href = URLS.market;
$("holdings-source").href = URLS.holdings;
$("ranking-source").href = URLS.ranking;
$("refresh").addEventListener("click", refresh);
$("period").addEventListener("change", renderPrices);
$("decision-product").addEventListener("change", () => { decisionPage = 1; renderDecisions(); });
$("decision-sort").addEventListener("change", () => { decisionPage = 1; renderDecisions(); });
$("decision-prev").addEventListener("click", () => { decisionPage--; renderDecisions(); });
$("decision-next").addEventListener("click", () => { decisionPage++; renderDecisions(); });
refresh();
setInterval(refresh, 5 * 60 * 1000);
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { renderPrices(); renderPortfolio(); }, 150);
});
