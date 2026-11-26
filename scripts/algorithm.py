import json, time
import math
from pathlib import Path
import requests

# Fill these in with the URLs the organizer gave you when they registered you:
MARKET_URL = "https://raw.githubusercontent.com/exofri/ensim-trade-center/refs/heads/main/docs/data/market.json"
HOLDINGS_URL = "https://raw.githubusercontent.com/exofri/ensim-trade-center/refs/heads/main/traders/molivier/holdings.json"
LEADERBOARD_URL = "https://raw.githubusercontent.com/exofri/ensim-trade-center/refs/heads/main/docs/data/leaderboard.json"
DASHBOARD_DATA = Path(__file__).resolve().parents[1] / "docs" / "data"

MIN_MONEY_RESERVE = 50

# Modeling choices to explain in the report, not parameters supplied by the TP.
SIGNAL_WINDOW = 60
ENTRY_QUANTILE = 0.20
EXIT_QUANTILE = 0.80
A_TARGET_UNITS = 1000
CYCLE_WINDOW = 240
CYCLE_MIN_OBSERVATIONS = 160
POST_PEAK_TICKS = 5

def fetch_json(url):
    resp = requests.get(url, proxies={"http": None, "https": None}, timeout=(10, 20))
    resp.raise_for_status()
    return resp.json()

def round_signal(signal):
    """Clip and round toward zero, without exceeding the desired quantity."""
    signal = max(-1.0, min(1.0, signal))
    return math.copysign(math.floor(abs(signal) * 1000 + 1e-9) / 1000, signal)

def solve_system(matrix, vector):
    """Solve the four-variable least-squares system used by the dashboard."""
    rows = [row[:] + [vector[i]] for i, row in enumerate(matrix)]
    for column in range(4):
        pivot = max(range(column, 4), key=lambda i: abs(rows[i][column]))
        if abs(rows[pivot][column]) < 1e-10:
            return None
        rows[column], rows[pivot] = rows[pivot], rows[column]
        divisor = rows[column][column]
        for j in range(column, 5):
            rows[column][j] /= divisor
        for row in range(4):
            if row == column:
                continue
            factor = rows[row][column]
            for j in range(column, 5):
                rows[row][j] -= factor * rows[column][j]
    return [row[4] for row in rows]

def estimate_peak_timing(prices):
    """Fit the dashboard's sinusoid plus linear trend; return peak distances."""
    recent = prices[-CYCLE_WINDOW:]
    n = len(recent)
    if n < CYCLE_MIN_OBSERVATIONS:
        return None
    best = None
    for period in range(12, min(160, int(n * 0.6)) + 1):
        matrix = [[0.0] * 4 for _ in range(4)]
        vector = [0.0] * 4
        features = []
        for i, price in enumerate(recent):
            angle = 2 * math.pi * i / period
            f = (1.0, i / (n - 1), math.sin(angle), math.cos(angle))
            features.append(f)
            for j in range(4):
                vector[j] += f[j] * price
                for k in range(4):
                    matrix[j][k] += f[j] * f[k]
        coefficients = solve_system(matrix, vector)
        if coefficients is None:
            continue
        error = sum((price - sum(f[j] * coefficients[j] for j in range(4))) ** 2
                    for price, f in zip(recent, features))
        if best is None or error < best[0]:
            best = (error, period, coefficients)
    if best is None:
        return None
    _, period, c = best
    if math.hypot(c[2], c[3]) < max(abs(sum(recent) / n) * 0.0001, 1e-8):
        return None
    def model(offset):
        i = n - 1 + offset
        angle = 2 * math.pi * i / period
        return c[0] + c[1] * i / (n - 1) + c[2] * math.sin(angle) + c[3] * math.cos(angle)
    peaks = [i for i in range(-period, period + 1)
             if model(i) >= model(i - 1) and model(i) > model(i + 1)]
    future = [i for i in peaks if i >= 0]
    past = [i for i in peaks if i <= 0]
    if not future and not past:
        return None
    return {"period": period, "next": min(future) if future else None,
            "since": -max(past) if past else None}

def sell_near_peak(prices, units_to_sell):
    peak = estimate_peak_timing(prices)
    if peak is None:
        return False, "A : aucun pic estimable, conserver en attendant."
    ticks_needed = math.ceil(units_to_sell / 100)
    if peak["next"] is not None and peak["next"] <= ticks_needed:
        return True, f"A : pic estimé dans {peak['next']} ticks, vente progressive."
    if peak["since"] is not None and peak["since"] <= POST_PEAK_TICKS:
        return True, f"A : pic estimé il y a {peak['since']} ticks, vente progressive."
    if peak["next"] is not None:
        return False, f"A : pic estimé dans {peak['next']} ticks ; attendre avant de vendre."
    return False, "A : prochain pic non estimable, conserver en attendant."

def compute_signal(product, prices, owned_units, portfolio_value):
    if not prices or prices[-1] <= 0:
        return 0.0, "Attente : prix indisponible."
    price = prices[-1]
    if product == "A":
        low = high = None
        if len(prices) >= SIGNAL_WINDOW:
            recent = sorted(prices[-SIGNAL_WINDOW:])
            low = recent[int(ENTRY_QUANTILE * (SIGNAL_WINDOW - 1))]
            high = recent[int(EXIT_QUANTILE * (SIGNAL_WINDOW - 1))]
        if low is not None and low < high and price >= high:
            if owned_units <= 0:
                return 0.0, "A : zone haute, aucune unité à vendre."
            target = 0.0
        elif owned_units > A_TARGET_UNITS:
            target = float(A_TARGET_UNITS)
        elif low is None:
            return 0.0, f"Attente : {len(prices)}/{SIGNAL_WINDOW} observations pour A."
        elif low == high:
            return 0.0, "A : seuils confondus, conserver la position."
        elif price <= low:
            target = float(A_TARGET_UNITS)
            reason = "A : zone basse, acheter jusqu’à 1 000 unités."
        else:
            return 0.0, "A : entre les seuils, conserver la position."
        if target < owned_units:
            allowed, reason = sell_near_peak(prices, owned_units - target)
            if not allowed:
                return 0.0, reason
    elif product == "B":
        return 0.0, "B : conserver la position, sans achat ni vente."
    elif product == "C":
        target = 0.0
        reason = "C : réduire progressivement la position, sans nouvel achat."
    else:
        return 0.0, "Produit sans stratégie définie : conserver."
    return round_signal((target - owned_units) / 100), reason

def apply_budget_guard(raw_signal, money, price, reserve=MIN_MONEY_RESERVE):
    # A buy signal (positive) that would spend into the reserve gets scaled down,
    # not silently zeroed out -- you still act on the signal, just smaller. A sell
    # signal is never touched here: selling only ever adds money, never risks it.
    if raw_signal <= 0:
        return raw_signal
    if money <= reserve:
        return 0.0
    max_affordable_units = (money - reserve) / price
    desired_units = 100 * raw_signal
    if desired_units <= max_affordable_units:
        return raw_signal
    return round_signal(max_affordable_units / 100)


def save_dashboard_data(market, holdings, decision, reasons):
    """Record real observations and generated demands, never simulated fills.

    One portfolio snapshot per observed market timestamp. Include baselines only
    when the official ranking and the market have the same generation date.
    """
    DASHBOARD_DATA.mkdir(parents=True, exist_ok=True)

    def read_records(filename, key):
        path = DASHBOARD_DATA / filename
        if not path.exists():
            return []
        records = json.loads(path.read_text(encoding="utf-8"))[key]
        if not isinstance(records, list):
            raise ValueError(f"Invalid dashboard data: {filename}")
        return records

    def write_json(filename, data):
        path = DASHBOARD_DATA / filename
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False), encoding="utf-8")
        temporary.replace(path)

    write_json("strategy.json", {"window": SIGNAL_WINDOW,
               "entry_quantile": ENTRY_QUANTILE, "exit_quantile": EXIT_QUANTILE,
               "a_target_units": A_TARGET_UNITS, "a_peak_timing": True, "b_mode": "hold",
               "reserve": MIN_MONEY_RESERVE})
    decisions = read_records("decision_log.json", "decisions")
    entry = {"updated_at": decision["updated_at"],
             "market_timestamp": market["history"][-1]["timestamp"] if market["history"] else None,
             "signals": {p: decision[p] for p in market["products"]}, "reasons": reasons}
    decisions = [row for row in decisions if row["updated_at"] != entry["updated_at"]]
    decisions.append(entry)
    decisions.sort(key=lambda row: row["updated_at"])
    write_json("decision_log.json", {"decisions": decisions})
    if not market["history"]:
        return
    latest = market["history"][-1]
    baselines = {}
    try:
        ranking = fetch_json(LEADERBOARD_URL)
        if ranking.get("generated_at") and ranking["generated_at"] == market.get("generated_at"):
            baselines = {row["id"]: row["total_value"] for row in ranking["leaderboard"]
                         if row["id"] in ("random_trader", "random_buyer", "random_seller")
                         and isinstance(row.get("total_value"), (float, int))
                         and math.isfinite(row["total_value"]) and row["total_value"] >= 0}
    except (requests.RequestException, ValueError, KeyError, TypeError) as error:
        print(f"Official ranking unavailable; portfolio still recorded: {error}")
    snapshots = read_records("portfolio_history.json", "snapshots")
    snapshot = {"market_timestamp": latest["timestamp"], "observed_at": decision["updated_at"],
                "money": holdings["money"], "products": holdings["products"],
                "total_value": holdings["money"] + sum(
                    holdings["products"].get(p, 0) * latest[p] for p in market["products"]),
                "baselines": baselines}
    previous = next((row for row in snapshots if row["market_timestamp"] == latest["timestamp"]), None)
    if previous and not baselines:
        snapshot["baselines"] = previous.get("baselines", {})
    snapshots = [row for row in snapshots if row["market_timestamp"] != latest["timestamp"]]
    snapshots.append(snapshot)
    snapshots.sort(key=lambda row: row["market_timestamp"])
    write_json("portfolio_history.json", {"snapshots": snapshots})


def build_decisions(market, holdings):
    products = market["products"]
    history = market["history"]

    portfolio_value = holdings["money"] + sum(
        holdings["products"].get(p, 0) * history[-1][p] for p in products
    ) if history else holdings["money"]

    decision = {}
    reasons = {}
    # Budget purchases together, without assuming any sale will execute.
    remaining_money = holdings["money"]
    for p in sorted(products):
        prices = [row[p] for row in history]
        raw, reason = compute_signal(p, prices, holdings["products"].get(p, 0), portfolio_value)
        current_price = prices[-1] if prices else 0
        decision[p] = apply_budget_guard(raw, remaining_money, current_price)
        if decision[p] > 0:
            remaining_money -= 100 * decision[p] * current_price
        if raw != decision[p]:
            reason += " Achat réduit par le budget disponible et la réserve."
        reasons[p] = reason
    return decision, reasons

def main():
    market = fetch_json(MARKET_URL)
    holdings = fetch_json(HOLDINGS_URL)
    decision, reasons = build_decisions(market, holdings)

    decision["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with open("decision.json", "w") as f:
        json.dump(decision, f, indent=2)
    print(f"Wrote decision.json: {decision}")
    save_dashboard_data(market, holdings, decision, reasons)

if __name__ == "__main__":
    main()
