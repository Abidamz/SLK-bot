"""
SLK Model — MetaTrader 5 (MT5) Auto-Execution Webhook Bridge
=============================================================
Lightweight FastAPI execution service designed to run on a Windows VPS
alongside the MetaTrader 5 desktop terminal.

Receives authenticated live trade webhooks from the SLK Cloudflare Alert Worker,
calculates dynamic lot sizing based on account equity and risk parameters, and
submits institutional execution orders directly to MT5 brokers (FTMO, IC Markets,
FundedNext, Pepperstone, etc.).

Requirements (on Windows VPS):
    pip install fastapi uvicorn MetaTrader5 pydantic requests

Run server:
    uvicorn mt5_bridge:app --host 0.0.0.0 --port 8000
"""

import os
import hmac
import hashlib
import logging
from typing import Optional, Literal
from fastapi import FastAPI, HTTPException, Header, Request, status
from pydantic import BaseModel, Field

# Configure institutional logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("slk.mt5_bridge")

# Try importing MetaTrader5; gracefully fallback for dry-run testing on Linux/Mac
try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    mt5 = None
    MT5_AVAILABLE = False
    logger.warning("MetaTrader5 package not available on this OS. Running in DRY-RUN / SIMULATION mode.")

# Configuration from environment
WEBHOOK_SECRET = os.getenv("SLK_WEBHOOK_SECRET", "slk_secret_key_change_in_prod")
DEFAULT_RISK_USD = float(os.getenv("DEFAULT_RISK_USD", "100.0"))  # $100 fixed risk per trade
DEFAULT_RISK_PCT = float(os.getenv("DEFAULT_RISK_PCT", "1.0"))    # or 1% of account equity
USE_PERCENT_RISK = os.getenv("USE_PERCENT_RISK", "false").lower() == "true"
MAGIC_NUMBER = int(os.getenv("SLK_MAGIC_NUMBER", "20260930"))
DEVIATION = int(os.getenv("SLK_DEVIATION_POINTS", "20"))
DRY_RUN = os.getenv("DRY_RUN", "false").lower() == "true" or not MT5_AVAILABLE

# Instrument symbol mappings (Broker specific suffixes, e.g., EURUSD.pro or XAUUSD.raw)
SYMBOL_MAP = {
    "EURUSD": os.getenv("SYM_EURUSD", "EURUSD"),
    "GBPUSD": os.getenv("SYM_GBPUSD", "GBPUSD"),
    "USDJPY": os.getenv("SYM_USDJPY", "USDJPY"),
    "AUDJPY": os.getenv("SYM_AUDJPY", "AUDJPY"),
    "GBPJPY": os.getenv("SYM_GBPJPY", "GBPJPY"),
    "XAUUSD": os.getenv("SYM_XAUUSD", "XAUUSD"),
    "US30": os.getenv("SYM_US30", "US30"),
    "NAS100": os.getenv("SYM_NAS100", "NAS100"),
    "GER40": os.getenv("SYM_GER40", "GER40"),
    "JAPAN225": os.getenv("SYM_JAPAN225", "JAPAN225"),
}

app = FastAPI(
    title="SLK Radar MT5 Bridge",
    description="Automated Institutional Execution Bridge between Cloudflare Worker and MetaTrader 5",
    version="1.0.0",
)


class TradePayload(BaseModel):
    setup_id: str = Field(..., description="Unique setup identifier")
    pair: str = Field(..., description="Canonical instrument symbol (e.g. EURUSD, XAUUSD)")
    direction: Literal["LONG", "SHORT"] = Field(..., description="Trade direction")
    entry: float = Field(..., description="Target execution price")
    stop_loss: float = Field(..., description="Initial structural stop loss level")
    tp_internal: float = Field(..., description="Target 1 (internal liquidity)")
    tp_external: Optional[float] = Field(None, description="Target 2 (external liquidity)")
    entry_timeframe: str = Field("30m", description="Execution timeframe")
    risk_usd: Optional[float] = Field(None, description="Custom risk amount override in USD")


class BreakevenPayload(BaseModel):
    setup_id: str = Field(..., description="Unique setup identifier")
    pair: str = Field(..., description="Canonical instrument symbol")
    entry_price: float = Field(..., description="Price level to move stop loss to")


def verify_signature(body_bytes: bytes, signature_header: Optional[str]) -> bool:
    """Verifies HMAC-SHA256 signature from SLK Alert Worker."""
    if not WEBHOOK_SECRET or WEBHOOK_SECRET == "disabled":
        return True
    if not signature_header:
        return False
    computed = hmac.new(WEBHOOK_SECRET.encode("utf-8"), body_bytes, hashlib.sha256).hexdigest()
    return hmac.compare_digest(computed.lower(), signature_header.lower())


def initialize_mt5() -> bool:
    """Ensures MT5 terminal connection is active."""
    if not MT5_AVAILABLE:
        return False
    if not mt5.initialize():
        logger.error(f"mt5.initialize() failed, error code: {mt5.last_error()}")
        return False
    return True


def calculate_lot_size(symbol: str, entry: float, stop_loss: float, risk_usd: float) -> float:
    """Calculates broker-compliant dynamic lot size based on point value and stop distance."""
    if DRY_RUN or not MT5_AVAILABLE:
        return 0.10  # Simulation fallback

    info = mt5.symbol_info(symbol)
    if not info:
        logger.error(f"Cannot get symbol_info for {symbol}")
        return 0.01

    point = info.point
    contract_size = info.trade_contract_size
    price_diff = abs(entry - stop_loss)
    points_at_risk = price_diff / point

    if points_at_risk <= 0:
        return info.volume_min

    # Calculate tick value in account currency
    tick_value = info.trade_tick_value
    tick_size = info.trade_tick_size
    point_value = (tick_value / tick_size) * point if tick_size > 0 else 1.0

    raw_lots = risk_usd / (points_at_risk * point_value)

    # Step rounding
    step = info.volume_step
    lots = round(raw_lots / step) * step
    lots = max(info.volume_min, min(info.volume_max, lots))
    return round(lots, 2)


@app.on_event("startup")
def startup_event():
    if MT5_AVAILABLE:
        if initialize_mt5():
            account_info = mt5.account_info()
            if account_info:
                logger.info(f"MT5 Connected! Account: {account_info.login}, Balance: ${account_info.balance:.2f}, Equity: ${account_info.equity:.2f}")
        else:
            logger.error("Failed to connect to MT5 on startup.")
    else:
        logger.info("Startup complete (Simulation / Dry-Run Mode).")


@app.on_event("shutdown")
def shutdown_event():
    if MT5_AVAILABLE:
        mt5.shutdown()
        logger.info("MT5 connection closed.")


@app.get("/health")
def health_check():
    """Health check endpoint for Cloudflare Worker probes."""
    connected = False
    equity = 0.0
    balance = 0.0
    account_id = None

    if MT5_AVAILABLE:
        acc = mt5.account_info()
        if acc:
            connected = True
            equity = acc.equity
            balance = acc.balance
            account_id = acc.login

    return {
        "status": "healthy",
        "mt5_available": MT5_AVAILABLE,
        "mt5_connected": connected,
        "dry_run": DRY_RUN,
        "account_id": account_id,
        "balance": balance,
        "equity": equity,
    }


@app.post("/webhook/trade")
async def execute_trade(
    payload: TradePayload,
    request: Request,
    x_slk_signature: Optional[str] = Header(None),
):
    """
    Submits an instant market execution order to MetaTrader 5 with exact SL and TP1.
    """
    body_bytes = await request.body()
    if not verify_signature(body_bytes, x_slk_signature):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid HMAC signature")

    broker_symbol = SYMBOL_MAP.get(payload.pair, payload.pair)
    logger.info(f"Received trade execution signal: {payload.pair} {payload.direction} (Setup: {payload.setup_id})")

    # Risk sizing calculation
    risk_amount = payload.risk_usd or DEFAULT_RISK_USD
    if USE_PERCENT_RISK and MT5_AVAILABLE:
        acc = mt5.account_info()
        if acc:
            risk_amount = (acc.equity * DEFAULT_RISK_PCT) / 100.0

    lots = calculate_lot_size(broker_symbol, payload.entry, payload.stop_loss, risk_amount)

    if DRY_RUN:
        logger.info(f"[DRY-RUN] Simulated Order: {broker_symbol} {payload.direction} {lots} lots | SL: {payload.stop_loss} | TP: {payload.tp_internal}")
        return {
            "status": "simulated",
            "setup_id": payload.setup_id,
            "symbol": broker_symbol,
            "direction": payload.direction,
            "volume": lots,
            "entry": payload.entry,
            "stop_loss": payload.stop_loss,
            "tp_internal": payload.tp_internal,
        }

    if not initialize_mt5():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="MT5 terminal not reachable")

    # Select symbol in Market Watch if needed
    if not mt5.symbol_select(broker_symbol, True):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Failed to select symbol {broker_symbol} in MT5")

    tick = mt5.symbol_info_tick(broker_symbol)
    if not tick:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"No tick data available for {broker_symbol}")

    is_buy = payload.direction == "LONG"
    order_type = mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL
    price = tick.ask if is_buy else tick.bid

    request_dict = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": broker_symbol,
        "volume": lots,
        "type": order_type,
        "price": price,
        "sl": payload.stop_loss,
        "tp": payload.tp_internal,
        "deviation": DEVIATION,
        "magic": MAGIC_NUMBER,
        "comment": f"SLK:{payload.setup_id[:15]}",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }

    result = mt5.order_send(request_dict)
    if result.retcode != mt5.TRADE_RETCODE_DONE:
        logger.error(f"MT5 execution failed: retcode={result.retcode}, comment={result.comment}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"MT5 order rejected: {result.retcode} ({result.comment})",
        )

    logger.info(f"Trade successfully placed! Ticket: {result.order}, Volume: {result.volume}, Price: {result.price}")
    return {
        "status": "executed",
        "ticket": result.order,
        "symbol": broker_symbol,
        "direction": payload.direction,
        "volume": result.volume,
        "fill_price": result.price,
        "sl": payload.stop_loss,
        "tp": payload.tp_internal,
    }


@app.post("/webhook/breakeven")
async def update_breakeven(
    payload: BreakevenPayload,
    request: Request,
    x_slk_signature: Optional[str] = Header(None),
):
    """
    Trails the stop loss to breakeven (entry price) for an open MT5 trade.
    """
    body_bytes = await request.body()
    if not verify_signature(body_bytes, x_slk_signature):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid HMAC signature")

    broker_symbol = SYMBOL_MAP.get(payload.pair, payload.pair)
    logger.info(f"Received Breakeven trailing request for {payload.pair} to {payload.entry_price}")

    if DRY_RUN:
        logger.info(f"[DRY-RUN] Moved SL to Breakeven {payload.entry_price} for {broker_symbol}")
        return {"status": "simulated", "pair": payload.pair, "breakeven_price": payload.entry_price}

    if not initialize_mt5():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="MT5 terminal not reachable")

    positions = mt5.positions_get(symbol=broker_symbol)
    if not positions:
        return {"status": "no_open_positions", "symbol": broker_symbol}

    updated_count = 0
    for pos in positions:
        if pos.magic == MAGIC_NUMBER or f"SLK:{payload.setup_id[:15]}" in pos.comment:
            mod_req = {
                "action": mt5.TRADE_ACTION_SLTP,
                "position": pos.ticket,
                "sl": payload.entry_price,
                "tp": pos.tp,
            }
            res = mt5.order_send(mod_req)
            if res.retcode == mt5.TRADE_RETCODE_DONE:
                updated_count += 1
                logger.info(f"Position #{pos.ticket} stop loss moved to breakeven {payload.entry_price}")

    return {"status": "updated", "symbol": broker_symbol, "positions_modified": updated_count}
