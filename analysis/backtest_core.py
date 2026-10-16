from __future__ import annotations

import itertools
import json
import math
import time
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "analysis" / "data"
OUTPUT_DIR = ROOT / "analysis" / "output"
BASE_URL = "https://data-api.binance.vision/api/v3/klines"
SYMBOLS = ["ETHUSDT", "CRCLBUSDT"]
INTERVALS = ["5m", "15m", "1h"]
START_UTC = "2026-06-11T00:00:00Z"
COST = 0.005
HOLD_BARS = 8


def fetch_klines(symbol: str, interval: str, refresh: bool = False) -> pd.DataFrame:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / f"{symbol}_{interval}.csv"
    if path.exists() and not refresh:
        return pd.read_csv(path, parse_dates=["open_time", "close_time"])

    start_ms = int(pd.Timestamp(START_UTC).timestamp() * 1000)
    rows: list[list] = []
    while True:
        query = urllib.parse.urlencode({
            "symbol": symbol,
            "interval": interval,
            "startTime": start_ms,
            "limit": 1000,
        })
        with urllib.request.urlopen(f"{BASE_URL}?{query}", timeout=30) as response:
            batch = json.load(response)
        if not batch:
            break
        rows.extend(batch)
        next_start = int(batch[-1][6]) + 1
        if len(batch) < 1000 or next_start <= start_ms:
            break
        start_ms = next_start
        time.sleep(0.08)

    cols = ["open_time", "open", "high", "low", "close", "volume", "close_time",
            "quote_volume", "trades", "taker_base", "taker_quote", "ignore"]
    frame = pd.DataFrame(rows, columns=cols)
    if frame.empty:
        raise RuntimeError(f"Binance returned no data for {symbol} {interval}")
    for col in ["open", "high", "low", "close", "volume"]:
        frame[col] = pd.to_numeric(frame[col])
    frame["open_time"] = pd.to_datetime(frame["open_time"], unit="ms", utc=True)
    frame["close_time"] = pd.to_datetime(frame["close_time"], unit="ms", utc=True)
    frame = frame[["open_time", "close_time", "open", "high", "low", "close", "volume"]]
    frame = frame.drop_duplicates("open_time").sort_values("open_time")
    # Ignore the still-forming final candle.
    now = pd.Timestamp.now(tz="UTC")
    frame = frame[frame["close_time"] < now]
    frame.to_csv(path, index=False)
    return frame


def rsi_simple(close: pd.Series, period: int = 14) -> pd.Series:
    change = close.diff()
    gain = change.clip(lower=0).rolling(period).mean()
    loss = (-change.clip(upper=0)).rolling(period).mean()
    rs = gain / loss.replace(0, np.nan)
    result = 100 - 100 / (1 + rs)
    return result.fillna(100).where(gain.notna())


def build_features(symbol: str, refresh: bool = False) -> pd.DataFrame:
    five = fetch_klines(symbol, "5m", refresh)
    fifteen = fetch_klines(symbol, "15m", refresh)
    hour = fetch_klines(symbol, "1h", refresh)

    f = fifteen.copy().set_index("close_time")
    f["ema20_15"] = f["close"].ewm(span=20, adjust=False).mean()
    f["rsi"] = rsi_simple(f["close"])
    prev_close = f["close"].shift()
    tr = pd.concat([
        f["high"] - f["low"],
        (f["high"] - prev_close).abs(),
        (f["low"] - prev_close).abs(),
    ], axis=1).max(axis=1)
    f["atr_pct"] = tr.rolling(14).mean() / f["close"] * 100
    f["volume_median"] = f["volume"].shift().rolling(20).median()
    f["volume_ratio"] = f["volume"] / f["volume_median"]

    h = hour.set_index("close_time")[["close"]].copy()
    h["ema20_1h"] = h["close"].ewm(span=20, adjust=False).mean()
    h["ema50_1h"] = h["close"].ewm(span=50, adjust=False).mean()
    h = h.rename(columns={"close": "close_1h"}).reset_index()

    m = five.set_index("close_time")[["close"]].copy()
    m["ema9_5m"] = m["close"].ewm(span=9, adjust=False).mean()
    m = m.rename(columns={"close": "close_5m"}).reset_index()

    f = f.reset_index().sort_values("close_time")
    f = pd.merge_asof(f, h.sort_values("close_time"), on="close_time", direction="backward")
    f = pd.merge_asof(f, m.sort_values("close_time"), on="close_time", direction="backward")
    f["trend_up"] = f["ema20_1h"] > f["ema50_1h"]
    f["above_ema20"] = f["close"] > f["ema20_15"]
    f["momentum_up"] = f["close_5m"] > f["ema9_5m"]
    f["atr_ok"] = f["atr_pct"].between(0.15, 4.0)
    f["rsi_baseline"] = f["rsi"].between(50, 68)
    f["volume_baseline"] = f["volume_ratio"] > 1.0
    f["score"] = (
        f["trend_up"].astype(int) * 30
        + f["above_ema20"].astype(int) * 20
        + f["rsi_baseline"].astype(int) * 15
        + f["volume_baseline"].astype(int) * 15
        + f["momentum_up"].astype(int) * 10
        + f["atr_ok"].astype(int) * 10
    )
    f["future_close"] = f["close"].shift(-HOLD_BARS)
    f["long_net"] = f["future_close"] / f["close"] - 1 - COST
    f["short_net"] = f["close"] / f["future_close"] - 1 - COST
    f["symbol"] = symbol
    return f.dropna(subset=["ema50_1h", "rsi", "atr_pct", "future_close"]).reset_index(drop=True)


def non_overlapping_returns(frame: pd.DataFrame, mask: pd.Series, direction: str) -> np.ndarray:
    indices = np.flatnonzero(mask.to_numpy())
    chosen: list[int] = []
    next_allowed = -1
    for idx in indices:
        if idx >= next_allowed:
            chosen.append(idx)
            next_allowed = idx + HOLD_BARS
    col = "long_net" if direction == "buy" else "short_net"
    return frame.iloc[chosen][col].dropna().to_numpy()


def metrics(returns: np.ndarray) -> dict:
    n = len(returns)
    if n == 0:
        return {"trades": 0, "win_rate": np.nan, "avg_net": np.nan, "profit_factor": np.nan,
                "cumulative": np.nan, "max_drawdown": np.nan, "wilson_lb": 0.0}
    wins = int((returns > 0).sum())
    p = wins / n
    z = 1.96
    denom = 1 + z * z / n
    centre = p + z * z / (2 * n)
    spread = z * math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)
    wilson = (centre - spread) / denom
    gains = returns[returns > 0].sum()
    losses = -returns[returns < 0].sum()
    pf = gains / losses if losses > 0 else np.inf
    equity = np.cumprod(1 + returns)
    peak = np.maximum.accumulate(np.r_[1.0, equity])
    drawdown = np.r_[1.0, equity] / peak - 1
    return {
        "trades": n,
        "win_rate": p,
        "avg_net": returns.mean(),
        "profit_factor": pf,
        "cumulative": equity[-1] - 1,
        "max_drawdown": drawdown.min(),
        "wilson_lb": wilson,
    }


def signal_mask(frame: pd.DataFrame, direction: str, params: dict) -> pd.Series:
    rsi_good = frame["rsi"].between(params.get("rsi_low", 50), params.get("rsi_high", 68))
    volume_good = frame["volume_ratio"] >= params.get("volume_ratio", 1.0)
    score = (
        frame["trend_up"].astype(int) * 30
        + frame["above_ema20"].astype(int) * 20
        + rsi_good.astype(int) * 15
        + volume_good.astype(int) * 15
        + frame["momentum_up"].astype(int) * 10
        + frame["atr_ok"].astype(int) * 10
    )
    if direction == "buy":
        mask = score >= params["threshold"]
        if params.get("require_trend", False):
            mask &= frame["trend_up"]
        return mask
    mask = (score <= params["threshold"]) & (~frame["above_ema20"])
    if params.get("require_bear_trend", True):
        mask &= ~frame["trend_up"]
    if params.get("require_momentum_down", False):
        mask &= ~frame["momentum_up"]
    mask &= frame["rsi"] >= params.get("rsi_floor", 0)
    return mask


BASELINES = {
    "buy": {"threshold": 70, "rsi_low": 50, "rsi_high": 68, "volume_ratio": 1.0, "require_trend": False},
    "sell": {"threshold": 25, "rsi_low": 50, "rsi_high": 68, "volume_ratio": 1.0,
             "require_bear_trend": True, "require_momentum_down": False, "rsi_floor": 0},
}


def candidates(direction: str):
    if direction == "buy":
        for threshold, rsi_high, volume_ratio, require_trend in itertools.product(
            [55, 60, 65, 70, 75, 80, 85], [60, 65, 68, 72, 75], [0.0, 0.8, 1.0, 1.2], [False, True]
        ):
            yield {"threshold": threshold, "rsi_low": 50, "rsi_high": rsi_high,
                   "volume_ratio": volume_ratio, "require_trend": require_trend}
    else:
        for threshold, rsi_floor, require_bear, require_momentum_down, volume_ratio in itertools.product(
            [15, 20, 25, 30, 35, 40, 45], [0, 25, 30, 35, 40, 45],
            [False, True], [False, True], [0.8, 1.0, 1.2]
        ):
            yield {"threshold": threshold, "rsi_low": 50, "rsi_high": 68,
                   "volume_ratio": volume_ratio, "require_bear_trend": require_bear,
                   "require_momentum_down": require_momentum_down, "rsi_floor": rsi_floor}


def choose_params(train: pd.DataFrame, direction: str) -> tuple[dict, dict]:
    scored = []
    for params in candidates(direction):
        result = metrics(non_overlapping_returns(train, signal_mask(train, direction, params), direction))
        if result["trades"] >= 20:
            # Conservative hit-rate objective, with a modest expectancy tie-breaker.
            objective = result["wilson_lb"] + np.clip(result["avg_net"], -0.01, 0.01) * 2
            scored.append((objective, result["avg_net"], result["trades"], params, result))
    if not scored:
        return BASELINES[direction], metrics(non_overlapping_returns(
            train, signal_mask(train, direction, BASELINES[direction]), direction))
    scored.sort(key=lambda x: (x[0], x[1], x[2]), reverse=True)
    return scored[0][3], scored[0][4]


def run_analysis(refresh: bool = False):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    features = {symbol: build_features(symbol, refresh) for symbol in SYMBOLS}
    rows = []
    selected = {}
    equity_payload = {}

    for symbol, frame in features.items():
        split = int(len(frame) * 0.70)
        train = frame.iloc[:split].reset_index(drop=True)
        validation = frame.iloc[split:].reset_index(drop=True)
        for direction in ["buy", "sell"]:
            optimized, train_metric = choose_params(train, direction)
            selected[f"{symbol}_{direction}"] = optimized
            for variant, params in [("现有规则", BASELINES[direction]), ("优化规则", optimized)]:
                train_returns = non_overlapping_returns(train, signal_mask(train, direction, params), direction)
                val_returns = non_overlapping_returns(validation, signal_mask(validation, direction, params), direction)
                for segment, returns in [("训练集", train_returns), ("验证集", val_returns)]:
                    row = {"symbol": symbol, "direction": direction, "variant": variant,
                           "segment": segment, **metrics(returns)}
                    rows.append(row)
                if variant == "优化规则":
                    equity_payload[f"{symbol}_{direction}"] = val_returns.tolist()

    result = pd.DataFrame(rows)
    result.to_csv(OUTPUT_DIR / "backtest_results.csv", index=False)
    (OUTPUT_DIR / "selected_parameters.json").write_text(
        json.dumps(selected, ensure_ascii=False, indent=2), encoding="utf-8")

    validation = result[result["segment"] == "验证集"].copy()
    validation["方向"] = validation["direction"].map({"buy": "买入", "sell": "卖出"})
    validation["命中率"] = (validation["win_rate"] * 100).round(1).astype(str) + "%"
    validation["平均净收益"] = (validation["avg_net"] * 100).round(3).astype(str) + "%"
    validation["累计净收益"] = (validation["cumulative"] * 100).round(2).astype(str) + "%"
    validation["最大回撤"] = (validation["max_drawdown"] * 100).round(2).astype(str) + "%"
    display_cols = ["symbol", "方向", "variant", "trades", "命中率", "平均净收益", "profit_factor", "累计净收益", "最大回撤"]

    print(f"数据起点：{START_UTC}；2小时固定持有；每笔双边成本假设：{COST:.1%}")
    for symbol, frame in features.items():
        print(f"{symbol}: {len(frame):,} 根15分钟评估点，{frame.close_time.min()} 至 {frame.close_time.max()}")
    print("\n未参与调参的后30%验证集：")
    print(validation[display_cols].to_string(index=False))
    print("\n训练集选出的参数：")
    print(json.dumps(selected, ensure_ascii=False, indent=2))

    try:
        import matplotlib.pyplot as plt
        plt.style.use("seaborn-v0_8-whitegrid")
        fig, axes = plt.subplots(1, 2, figsize=(13, 4.5))
        labels = [f"{r.symbol}\n{r.direction}" for _, r in validation[validation.variant == "现有规则"].iterrows()]
        base = validation[validation.variant == "现有规则"].reset_index(drop=True)
        opt = validation[validation.variant == "优化规则"].reset_index(drop=True)
        x = np.arange(len(labels)); width = 0.35
        axes[0].bar(x - width/2, base.win_rate * 100, width, label="Baseline")
        axes[0].bar(x + width/2, opt.win_rate * 100, width, label="Optimized")
        axes[0].axhline(50, color="#777", linestyle="--", linewidth=1)
        axes[0].set_xticks(x, labels); axes[0].set_ylabel("Win rate (%)"); axes[0].legend()
        axes[0].set_title("Out-of-sample validation: win rate")
        axes[1].bar(x - width/2, base.avg_net * 100, width, label="Baseline")
        axes[1].bar(x + width/2, opt.avg_net * 100, width, label="Optimized")
        axes[1].axhline(0, color="#333", linewidth=1)
        axes[1].set_xticks(x, labels); axes[1].set_ylabel("Average net return per trade (%)")
        axes[1].set_title("Out-of-sample validation: return after costs")
        fig.tight_layout()
        chart = OUTPUT_DIR / "validation_comparison.png"
        fig.savefig(chart, dpi=160, bbox_inches="tight")
        plt.show()
    except ImportError:
        print("matplotlib 不可用，跳过图表。")
    return result, selected


if __name__ == "__main__":
    run_analysis(refresh=True)
