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
function axisNumber(value, step) {
  const digits = step > 0 ? Math.min(6, Math.max(0, 1 - Math.floor(Math.log10(step)))) : 2;
  return value.toLocaleString("fr-FR", { maximumFractionDigits: digits });
}
const percent = value => Number.isFinite(value) ? number(value) + " %" : "—";
const date = (value, short = false) => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "—";
  return parsed.toLocaleString("fr-FR", short
    ? { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit" }
    : { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
function axisDate(value, spanMs) {
  if (spanMs >= 2 * 24 * 60 * 60 * 1000) return date(value, true);
  return new Date(value).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
let state = {};
let selectedProduct = "A";
let decisionPage = 1;
const DECISIONS_PER_PAGE = 15;
const chartViews = Object.fromEntries(["price-chart", "performance-chart", "risk-chart"].map(id => [id, { span: 1, end: 1 }]));

function chartControls(id, start, end, total) {
  const count = end - start;
  $(id + "-view").textContent = total ? `${start + 1}–${end} / ${total}` : "Aucune donnée";
  $(id + "-prev").disabled = start <= 0;
  $(id + "-next").disabled = end >= total;
  $(id + "-in").disabled = count <= 2;
  $(id + "-out").disabled = total === 0 || count >= total;
  $(id + "-reset").disabled = total === 0 || (start === 0 && end === total);
}

function visiblePoints(id, points) {
  const view = chartViews[id], total = points.length;
  if (!total) { chartControls(id, 0, 0, 0); return { visible: [], start: 0, end: 0 }; }
  const count = Math.min(total, Math.max(2, Math.ceil(total * view.span)));
  const end = Math.min(total, Math.max(count, Math.round(total * view.end)));
  const start = end - count;
  view.span = count / total;
  view.end = end / total;
  chartControls(id, start, end, total);
  return { visible: points.slice(start, end), start, end };
}

function changeChartView(id, action) {
  const view = chartViews[id];
  if (action === "in") view.span = Math.max(0.001, view.span / 2);
  if (action === "out") view.span = Math.min(1, view.span * 2);
  if (action === "prev") view.end -= view.span / 2;
  if (action === "next") view.end += view.span / 2;
  if (action === "reset") { view.span = 1; view.end = 1; }
  view.end = Math.min(1, Math.max(view.span, view.end));
  if (id === "price-chart") renderPrices(); else renderPortfolio();
}

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
  return row;
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
  if (chartViews[id]) chartControls(id, 0, 0, 0);
}
function legend(id, series) {
  $(id).replaceChildren();
  series.forEach(item => {
    const entry = element("span");
    const swatch = element("i");
    if (item.dashed) {
      swatch.style.background = "none";
      swatch.style.borderTop = `2px dashed ${item.color}`;
    } else swatch.style.background = item.color;
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
  const all = points.filter(point => Number.isFinite(Date.parse(point.timestamp)));
  const { visible: valid } = visiblePoints(id, all);
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
    svg.append(svgNode("text", { x: left - 9, y: y(value) + 4, "text-anchor": "end", fill: "#596774", "font-size": 11 }, axisNumber(value, (high - low) / 4) + unit));
  }
  const dateLabels = valid.length === 2 ? [[valid[0].timestamp, "start"], [valid[1].timestamp, "end"]] : [[valid[0].timestamp, "start"], [valid[Math.floor(valid.length / 2)].timestamp, "middle"], [valid.at(-1).timestamp, "end"]];
  dateLabels.forEach(([timestamp, anchor]) => svg.append(svgNode("text", { x: x(timestamp), y: height - 10, "text-anchor": anchor, fill: "#596774", "font-size": 11 }, axisDate(timestamp, end - start))));
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

// Solve a four-variable least-squares system with partial pivoting.
function solveSystem(matrix, vector) {
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < 4; column++) {
    let pivot = column;
    for (let row = column + 1; row < 4; row++) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    if (Math.abs(rows[pivot][column]) < 1e-10) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let j = column; j < 5; j++) rows[column][j] /= divisor;
    for (let row = 0; row < 4; row++) if (row !== column) {
      const factor = rows[row][column];
      for (let j = column; j < 5; j++) rows[row][j] -= factor * rows[column][j];
    }
  }
  return rows.map(row => row[4]);
}

// Fit a sinusoid plus a linear trend in tick space, selecting the period
// that best fits the latest observations. This is not the market's model.
function cycleProjection(prices, horizon = 20) {
  const recent = prices.slice(-240);
  const n = recent.length;
  if (n < 160) return null;
  let best = null;
  for (let period = 12; period <= Math.min(160, Math.floor(n * 0.6)); period++) {
    const features = i => [1, i / (n - 1), Math.sin(2 * Math.PI * i / period), Math.cos(2 * Math.PI * i / period)];
    const matrix = Array.from({ length: 4 }, () => Array(4).fill(0));
    const vector = Array(4).fill(0);
    recent.forEach((price, i) => {
      const f = features(i);
      for (let j = 0; j < 4; j++) {
        vector[j] += f[j] * price;
        for (let k = 0; k < 4; k++) matrix[j][k] += f[j] * f[k];
      }
    });
    const coefficients = solveSystem(matrix, vector);
    if (!coefficients) continue;
    const predict = i => features(i).reduce((sum, value, j) => sum + value * coefficients[j], 0);
    const error = recent.reduce((sum, price, i) => sum + (price - predict(i)) ** 2, 0);
    if (!best || error < best.error) best = { period, error, predict };
  }
  if (!best) return null;
  const current = recent.at(-1), anchor = best.predict(n - 1);
  return { period: best.period, values: Array.from({ length: horizon }, (_, i) => Math.max(0.01, current + best.predict(n + i) - anchor)) };
}

// Keep projections on a tick axis: the market does not promise a future time.
function priceChart(points, projection, series, title) {
  const historic = points.map((point, i) => ({ ...point, tickIndex: i }));
  if (projection && historic.length) historic.at(-1).forecast = historic.at(-1).price;
  const fixedThresholds = Number.isFinite(state.config?.a_entry_price) && Number.isFinite(state.config?.a_exit_price);
  const future = projection ? projection.values.map((forecast, i) => ({
    forecast, futureTick: i + 1, tickIndex: historic.length + i,
    ...(selectedProduct === "A" && fixedThresholds ? { low: state.config.a_entry_price, high: state.config.a_exit_price } : {}),
  })) : [];
  const all = [...historic, ...future];
  const { visible: pointsInView, start, end } = visiblePoints("price-chart", all);
  if (pointsInView.length < 2) { emptyChart("price-chart", "Au moins deux observations sont nécessaires pour afficher une courbe."); return; }
  const width = Math.max(300, Math.min(1000, $("price-chart").clientWidth));
  const height = 275, left = 65, right = width - 20, top = 20, bottom = height - 35;
  const x = i => left + (i - start) / (end - start - 1) * (right - left);
  const drawnSeries = projection ? [...series, { key: "forecast", color: "#a45e35", dashed: true }] : series;
  const allValues = pointsInView.flatMap(point => drawnSeries.map(item => point[item.key])).filter(Number.isFinite);
  if (!allValues.length) { emptyChart("price-chart", "Aucune valeur disponible sur cette période."); return; }
  let low = Math.min(...allValues), high = Math.max(...allValues);
  const padding = (high - low || Math.abs(high) || 1) * 0.1;
  low -= padding; high += padding;
  const y = value => bottom - (value - low) / (high - low) * (bottom - top);
  const svg = svgNode("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": title });
  svg.append(svgNode("title", {}, title));
  const boundaryIndex = historic.length - 1;
  if (projection && end - 1 > boundaryIndex) {
    const startShade = x(Math.max(start, boundaryIndex));
    svg.append(svgNode("rect", { x: startShade, y: top, width: right - startShade, height: bottom - top, fill: "#eef3f7" }));
    if (boundaryIndex >= start) svg.append(svgNode("line", { x1: x(boundaryIndex), x2: x(boundaryIndex), y1: top, y2: bottom, stroke: "#687987", "stroke-dasharray": "4 4" }));
    svg.append(svgNode("text", { x: (startShade + right) / 2, y: top + 13, "text-anchor": "middle", fill: "#596774", "font-size": 10 }, "Estimations"));
  }
  for (let i = 0; i <= 4; i++) {
    const value = low + (high - low) * i / 4;
    svg.append(svgNode("line", { x1: left, x2: right, y1: y(value), y2: y(value), stroke: "#e4e9ed" }));
    svg.append(svgNode("text", { x: left - 9, y: y(value) + 4, "text-anchor": "end", fill: "#596774", "font-size": 11 }, axisNumber(value, (high - low) / 4)));
  }
  const mid = Math.floor((pointsInView.length - 1) / 2);
  const datedPoints = pointsInView.filter(point => point.timestamp);
  const dateSpan = datedPoints.length > 1 ? Date.parse(datedPoints.at(-1).timestamp) - Date.parse(datedPoints[0].timestamp) : 0;
  const labels = pointsInView.length === 2 ? [[0, "start"], [1, "end"]] : [[0, "start"], [mid, "middle"], [pointsInView.length - 1, "end"]];
  labels.forEach(([i, anchor]) => {
    const point = pointsInView[i];
    const label = point.futureTick ? `+${point.futureTick} ticks` : axisDate(point.timestamp, dateSpan);
    svg.append(svgNode("text", { x: x(start + i), y: height - 10, "text-anchor": anchor, fill: "#596774", "font-size": 11 }, label));
  });
  drawnSeries.forEach(item => {
    let path = "", active = false;
    pointsInView.forEach((point, i) => {
      if (!Number.isFinite(point[item.key])) { active = false; return; }
      path += `${active ? "L" : "M"}${x(start + i).toFixed(2)},${y(point[item.key]).toFixed(2)} `;
      active = true;
    });
    svg.append(svgNode("path", { d: path, fill: "none", stroke: item.color, "stroke-width": item.key === "forecast" ? 2.5 : 2, "stroke-linejoin": "round", "stroke-dasharray": item.dashed ? "6 4" : "none" }));
  });
  $("price-chart").replaceChildren(svg);
}

function indicator(rows, product, index = rows.length - 1) {
  const price = rows[index]?.[product];
  if (!state.config) return { price, low: null, high: null, zone: "Configuration indisponible" };
  if (product === "B") return { price, low: null, high: null, zone: state.config.b_mode === "hold" ? "Conserver sans achat ni vente" : `Cible : ${number(state.config.b_target_weight * 100)} % du portefeuille` };
  if (product === "C") return { price, low: null, high: null, zone: "Réduire la position sans acheter" };
  if (product !== "A") return { price, low: null, high: null, zone: "Aucune stratégie définie" };
  let low = state.config.a_entry_price, high = state.config.a_exit_price;
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    const window = state.config.window;
    if (index + 1 < window) return { price, low: null, high: null, zone: "Historique insuffisant pour les seuils" };
    const prices = rows.slice(index + 1 - window, index + 1).map(row => row[product]).sort((a, b) => a - b);
    low = prices[Math.floor(state.config.entry_quantile * (window - 1))];
    high = prices[Math.floor(state.config.exit_quantile * (window - 1))];
  }
  const unitTarget = state.config.a_target_units;
  const targetLabel = Number.isFinite(unitTarget) ? `${number(unitTarget)} unités` : `${number(state.config.a_target_weight * 100)} %`;
  const excess = state.config.a_peak_timing && Number.isFinite(unitTarget) && state.holdings?.products?.A > unitTarget;
  const zone = low === high ? (state.config.a_peak_timing ? "Seuils confondus : attendre le pic pour alléger" : Number.isFinite(unitTarget) ? `Seuils confondus : alléger au-delà de ${targetLabel}` : "Conserver : seuils confondus") : price >= high ? (state.config.a_peak_timing ? "Zone haute : vente près du pic estimé" : "Zone haute : vendre") : excess ? "Excédent : vendre près du pic estimé" : price <= low ? `Zone basse : viser ${targetLabel}` : state.config.a_peak_timing ? `Au-delà de ${targetLabel} : attendre le pic estimé` : Number.isFinite(unitTarget) ? `Alléger au-delà de ${targetLabel}, sinon conserver` : "Conserver la position";
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
    $("projection-note").textContent = "";
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
  const requestedHorizon = Number($("projection-horizon").value);
  const horizon = Number.isFinite(requestedHorizon) && requestedHorizon >= 1 ? Math.min(200, Math.floor(requestedHorizon)) : 20;
  $("projection-horizon").value = String(horizon);
  const projection = cycleProjection(market.history.map(row => row[selectedProduct]), horizon);
  priceChart(count ? points.slice(-count) : points, projection, series, "Prix observés et cycle estimé du produit " + selectedProduct);
  legend("price-legend", projection ? [...series, { key: "forecast", label: `Estimation (+${projection.values.length} ticks)`, color: "#a45e35", dashed: true }] : series);
  $("projection-note").textContent = projection
    ? `Après la ligne verticale : estimation sur ${projection.values.length} ticks, issue d’une sinusoïde et d’une tendance ajustées aux 240 derniers prix au maximum (cycle estimé : ${projection.period} ticks). Les ticks sont régulièrement espacés sur le graphique, sans estimer leur heure réelle. L’évolution et les sommets futurs restent incertains.`
    : "La projection nécessite au moins 160 observations. Les ticks sont régulièrement espacés sur le graphique.";
  $("market-time").textContent = `Dernier prix : ${date(market.history.at(-1)?.timestamp)} (heure de Paris). ${market.history.length} observations. La zone de prix seule ne détermine pas la quantité à demander : celle-ci dépend du portefeuille.`;
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
    const element = tableRow($("comparison"), [String(index + 1), name, number(row.total_value), type]);
    if (row.id === "molivier") element.classList.add("ranking-self");
    if (row.baseline) element.classList.add("ranking-baseline");
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
  const fixedThresholds = Number.isFinite(state.config?.a_entry_price) && Number.isFinite(state.config?.a_exit_price) && state.config.a_entry_price > 0 && state.config.a_entry_price < state.config.a_exit_price;
  const rollingThresholds = Number.isInteger(state.config?.window) && state.config.window >= 2 && Number.isFinite(state.config.entry_quantile) && Number.isFinite(state.config.exit_quantile) && state.config.entry_quantile >= 0 && state.config.exit_quantile <= 1 && state.config.entry_quantile < state.config.exit_quantile;
  if (!(fixedThresholds || rollingThresholds) || !(Number.isFinite(state.config?.a_target_units) || Number.isFinite(state.config?.a_target_weight)) || !(state.config?.b_mode === "hold" || Number.isFinite(state.config?.b_target_weight))) { state.config = null; messages.push("Configuration des indicateurs indisponible."); }
  if (location.protocol === "file:") messages.push("Pour charger les fichiers de suivi, ouvrir cette page via un serveur local ou GitHub Pages.");
  $("status").textContent = messages.length ? messages.join("\n") : "Flux chargés. Les projections sont des estimations ; les autres valeurs proviennent des données disponibles.";
  $("status").classList.toggle("warning", messages.length > 0);
  renderPrices(); renderPortfolio(); renderDecisions();
  $("refreshed").textContent = "Consulté le " + date(new Date().toISOString());
  $("refresh").disabled = false;
}

$("market-source").href = URLS.market;
$("holdings-source").href = URLS.holdings;
$("ranking-source").href = URLS.ranking;
$("refresh").addEventListener("click", refresh);
$("period").addEventListener("change", renderPrices);
$("projection-horizon").addEventListener("change", renderPrices);
Object.keys(chartViews).forEach(id => ["in", "out", "prev", "next", "reset"].forEach(action => $(id + "-" + action).addEventListener("click", () => changeChartView(id, action))));
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
