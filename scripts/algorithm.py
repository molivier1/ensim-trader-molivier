import json, time
import requests

# Fill these in with the URLs the organizer gave you when they registered you:
MARKET_URL = "https://raw.githubusercontent.com/exofri/ensim-trade-center/refs/heads/main/docs/data/market.json"
HOLDINGS_URL = "http://raw.githubusercontent.com/exofri/ensim-trade-center/refs/heads/main/traders/molivier/holdings.json"

MIN_MONEY_RESERVE = 50 # never let a buy signal spend below this much money

# Initial strategy parameters; validate them with a historical simulation.
SHORT_WINDOW = 5
LONG_WINDOW = 20
TREND_THRESHOLD = 0.01  # ignore gaps smaller than 1% of the long average
TRADE_SIGNAL = 0.1  # request 10 units per market tick before budget constraints

def fetch_json(url):
    resp = requests.get(url, proxies={"http": None, "https": None}, timeout=(10, 20))
    resp.raise_for_status()
    return resp.json()

def compute_signal(prices):
    """
    Follow the trend using the last 5 and 20 observed prices.

    Return +0.1 (buy), -0.1 (sell), or 0.0 (hold). A relative gap
    of at least 1% is required to trade. Windows count observations,
    not days. Only the supplied history is used, never future prices.
    """
    if len(prices) < LONG_WINDOW:
        return 0.0

    short_average = sum(prices[-SHORT_WINDOW:]) / SHORT_WINDOW
    long_average = sum(prices[-LONG_WINDOW:]) / LONG_WINDOW
    if long_average <= 0:
        return 0.0

    relative_gap = (short_average - long_average) / long_average
    if relative_gap >= TREND_THRESHOLD:
        return TRADE_SIGNAL
    if relative_gap <= -TREND_THRESHOLD:
        return -TRADE_SIGNAL
    return 0.0

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

    decision = {}
    for p in products:
        prices = [row[p] for row in history]
        raw = compute_signal(prices)
        current_price = prices[-1] if prices else 0
        decision[p] = round(apply_budget_guard(raw, holdings["money"], current_price), 3)

    decision["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with open("decision.json", "w") as f:
        json.dump(decision, f, indent=2)
    print(f"Wrote decision.json: {decision}")

if __name__ == "__main__":
    main()
