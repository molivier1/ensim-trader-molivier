import json, time
import math
import statistics
from pathlib import Path
import requests

# Fill these in with the URLs the organizer gave you when they registered you:
MARKET_URL = "https://raw.githubusercontent.com/exofri/ensim-trade-center/refs/heads/main/docs/data/market.json"
HOLDINGS_URL = "https://raw.githubusercontent.com/exofri/ensim-trade-center/refs/heads/main/traders/molivier/holdings.json"
LEADERBOARD_URL = "https://raw.githubusercontent.com/exofri/ensim-trade-center/refs/heads/main/docs/data/leaderboard.json"
DASHBOARD_DATA = Path(__file__).resolve().parents[1] / "docs" / "data"

MIN_MONEY_RESERVE = 50 # never let a buy signal spend below this much money

# Modeling choices to explain in the report, not parameters supplied by the TP.
SIGNAL_WINDOW = 20
ENTRY_STANDARD_DEVIATIONS = 1.0
MAX_PRODUCT_WEIGHT = 0.20

def fetch_json(url):
    resp = requests.get(url, proxies={"http": None, "https": None}, timeout=(10, 20))
    resp.raise_for_status()
    return resp.json()

def compute_signal(prices, owned_units, portfolio_value):
    """
    Return a demand in [-1, 1] from observed prices and current holdings.

    The manual permits adding holdings context to compute_signal. Buy below
    the 20-observation mean minus one standard deviation, aiming for 20% of
    portfolio value. Exit at the mean. Otherwise keep the current position,
    reducing it if above the target cap. The budget guard is applied by main.
    """
    if len(prices) < SIGNAL_WINDOW:
        return 0.0

    recent_prices = prices[-SIGNAL_WINDOW:]
    mean = statistics.mean(recent_prices)
    deviation = statistics.pstdev(recent_prices)
    current_price = prices[-1]
    target_cap = MAX_PRODUCT_WEIGHT * portfolio_value
    current_value = owned_units * current_price

    if deviation > 0 and current_price <= mean - ENTRY_STANDARD_DEVIATIONS * deviation:
        target_value = target_cap
    elif current_price >= mean:
        target_value = 0.0
    else:
        target_value = min(current_value, target_cap)

    desired_units = target_value / current_price - owned_units
    raw_signal = max(-1.0, min(1.0, desired_units / 100))
    # Round toward zero so precision cannot request more stock than is held.
    return math.copysign(math.floor(abs(raw_signal) * 1000 + 1e-9) / 1000, raw_signal)

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
    return round(max_affordable_units / 100, 3)

def explain_signal(prices, owned_units, portfolio_value, raw, guarded):
    """Explain the produced demand for the TP's decision log."""
    if len(prices) < SIGNAL_WINDOW:
        return f"Attente : {len(prices)}/{SIGNAL_WINDOW} observations."
    recent = prices[-SIGNAL_WINDOW:]
    mean = statistics.mean(recent)
    deviation = statistics.pstdev(recent)
    if deviation > 0 and prices[-1] <= mean - ENTRY_STANDARD_DEVIATIONS * deviation:
        reason = f"Prix sous le seuil : viser {MAX_PRODUCT_WEIGHT:.0%} du portefeuille."
    elif prices[-1] >= mean:
        reason = "Prix revenu à la moyenne : sortir de la position."
    else:
        reason = "Prix entre seuil et moyenne : conserver sans renforcer."
    if owned_units * prices[-1] > MAX_PRODUCT_WEIGHT * portfolio_value:
        reason += " Réduire la part supérieure à la cible."
    if raw != guarded:
        reason += " Demande réduite par le garde-fou budgétaire."
    return reason


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
               "entry_standard_deviations": ENTRY_STANDARD_DEVIATIONS,
               "max_product_weight": MAX_PRODUCT_WEIGHT, "reserve": MIN_MONEY_RESERVE})
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


def main():
    market = fetch_json(MARKET_URL)
    holdings = fetch_json(HOLDINGS_URL)
    products = market["products"]
    history = market["history"]

    portfolio_value = holdings["money"] + sum(
        holdings["products"].get(p, 0) * history[-1][p] for p in products
    ) if history else holdings["money"]

    decision = {}
    reasons = {}
    for p in products:
        prices = [row[p] for row in history]
        raw = compute_signal(prices, holdings["products"].get(p, 0), portfolio_value)
        current_price = prices[-1] if prices else 0
        decision[p] = round(apply_budget_guard(raw, holdings["money"], current_price), 3)
        reasons[p] = explain_signal(prices, holdings["products"].get(p, 0), portfolio_value, raw, decision[p])

    decision["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with open("decision.json", "w") as f:
        json.dump(decision, f, indent=2)
    print(f"Wrote decision.json: {decision}")
    save_dashboard_data(market, holdings, decision, reasons)

if __name__ == "__main__":
    main()
