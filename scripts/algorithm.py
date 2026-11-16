import json, time
import math
import statistics
import requests

# Fill these in with the URLs the organizer gave you when they registered you:
MARKET_URL = "https://raw.githubusercontent.com/exofri/ensim-trade-center/refs/heads/main/docs/data/market.json"
HOLDINGS_URL = "https://raw.githubusercontent.com/exofri/ensim-trade-center/refs/heads/main/traders/molivier/holdings.json"

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

def main():
    market = fetch_json(MARKET_URL)
    holdings = fetch_json(HOLDINGS_URL)
    products = market["products"]
    history = market["history"]

    portfolio_value = holdings["money"] + sum(
        holdings["products"].get(p, 0) * history[-1][p] for p in products
    ) if history else holdings["money"]

    decision = {}
    for p in products:
        prices = [row[p] for row in history]
        raw = compute_signal(prices, holdings["products"].get(p, 0), portfolio_value)
        current_price = prices[-1] if prices else 0
        decision[p] = round(apply_budget_guard(raw, holdings["money"], current_price), 3)

    decision["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with open("decision.json", "w") as f:
        json.dump(decision, f, indent=2)
    print(f"Wrote decision.json: {decision}")

if __name__ == "__main__":
    main()
