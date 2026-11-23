// btc-race-24h-20261123-0511 entry: a slow-trend rider for cbBTC/USDC.
//
// Idea, in one line: get long early when the short EMA crosses above the long
// EMA, then sit on the position and let a slow grind pay, exiting only when
// the market proves the trend broke (a trailing stop under the peak close, or
// a hard stop under the entry close). The dev window is a slow 1-minute grind
// (per-minute log returns average +0.25 bps with an 8 bps standard deviation),
// so every round trip costs roughly 40 bps in fees, slippage and pool impact
// while a typical minute moves a few bps: any bot that trades often bleeds to
// death on this tape. This bot therefore trades as rarely as possible — one
// entry on the dev window — and lets the trailing stop, not a fast exit
// signal, decide when to get out.
//
// Rules, precisely:
//   - Indicators: EMA(10) and EMA(30) over closes, each seeded as the mean of
//     its first span of closes, then the usual 2 / (span + 1) update.
//   - Entry: on a bar whose close the fast EMA crosses above the slow EMA
//     (fast above slow now, at or under it on the bar before), buy with all
//     cash. Only when flat.
//   - Exit: the whole position, when the close falls 2.5% under the highest
//     close since entry (trailing stop) or 5% under the position's average
//     fill cost (hard stop, read from the account's cost basis).
//     a sell the replay refuses is sent again on the next bar.
//   - No re-entry until the next fresh cross up after an exit.
//   - Buys cap slippage at 150 bps past the close they were decided on;
//     sells at 500 bps, so a stop-out fills through an ordinary gap.
//   - Deterministic: float64 EMA math only, no clock, no network, no files,
//     no randomness; the same hello and bars give the same orders.
//
// Protocol: agent-fun/bars-replay/v1, newline-delimited JSON on stdin/stdout.
// One reply per batch, echoing its seq. Orders decided on a batch fill at the
// next bar's open; the harness reports fills and the account on the next batch.

import { createInterface } from 'node:readline';

const SYMBOL = 'CBBTC';
const FAST_SPAN = 10;
const SLOW_SPAN = 30;
const TRAIL_PCT = 0.025; // exit 2.5% under the peak close since entry
const STOP_PCT = 0.05; // exit 5% under the entry close
const BUY_SLIP_BPS = 150;
const SELL_SLIP_BPS = 500;

interface Ema {
  span: number;
  warm: number[];
  value: number | null;
}

function emaStep(e: Ema, close: number): void {
  if (e.value !== null) {
    e.value += (2 / (e.span + 1)) * (close - e.value);
    return;
  }
  e.warm.push(close);
  if (e.warm.length === e.span) {
    let sum = 0;
    for (const x of e.warm) sum += x;
    e.value = sum / e.span;
  }
}

interface OrderOut {
  side: 'buy' | 'sell';
  client_id: string;
  symbol: string;
  notional_quote_units?: string;
  qty?: string;
  max_slippage_bps: number;
}

async function main(): Promise<void> {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let warmupBars = 0;
  let priceScale = 5;
  let minNotional = 0n;
  let cash = 0n;
  let heldQty = 0n;
  let orderSeq = 1;

  const fast: Ema = { span: FAST_SPAN, warm: [], value: null };
  const slow: Ema = { span: SLOW_SPAN, warm: [], value: null };
  let prevGap: number | null = null;
  let entryClose = 0;
  let peakClose = 0;
  // Average fill cost in USDC per cbBTC, from the account's cost basis: the
  // hard stop is measured against what the position actually cost (fees and
  // impact included), not the close the entry was decided on, so a stop-out
  // means a true 5% economic loss rather than 5% plus the entry's costs.
  let entryCost = 0;
  let prevHeldQty = 0n;

  for await (const line of lines) {
    if (line.trim() === '') continue;
    const msg = JSON.parse(line) as Record<string, unknown>;
    const type = msg.type as string;

    if (type === 'hello') {
      const hello = msg as unknown as {
        symbols: { symbol: string; price_scale: number }[];
        capital: { quote_units: string };
        fees: { min_notional_quote_units: string };
        warmup_bars?: number;
      };
      warmupBars = hello.warmup_bars ?? 0;
      for (const s of hello.symbols) {
        if (s.symbol === SYMBOL) priceScale = s.price_scale;
      }
      minNotional = BigInt(hello.fees.min_notional_quote_units);
      cash = BigInt(hello.capital.quote_units);
      continue;
    }

    if (type === 'done') break;

    if (type !== 'batch') continue;
    const batch = msg as unknown as {
      seq: number;
      bars: { symbol: string; c: string }[];
      account: {
        cash_quote_units: string;
        positions: { symbol: string; qty: string }[];
      };
    };

    cash = BigInt(batch.account.cash_quote_units);
    heldQty = 0n;
    let heldCost = 0n;
    for (const p of batch.account.positions) {
      if (p.symbol === SYMBOL) {
        heldQty = BigInt(p.qty);
        heldCost = BigInt(p.cost_quote_units);
      }
    }
    // The position first shows up in the account on the batch after its fill.
    if (heldQty > 0n && prevHeldQty === 0n) {
      entryCost = (Number(heldCost) / 1e6) / (Number(heldQty) / 1e8);
    }
    if (heldQty === 0n) entryCost = 0;
    prevHeldQty = heldQty;

    const orders: OrderOut[] = [];
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar !== undefined) {
      const close = Number(bar.c) / 10 ** priceScale;
      emaStep(fast, close);
      emaStep(slow, close);
      if (fast.value !== null && slow.value !== null) {
        const gap = fast.value - slow.value;
        const warmingUp = warmupBars > 0 && batch.seq < warmupBars;
        if (!warmingUp) {
          if (heldQty > 0n) {
            if (close > peakClose) peakClose = close;
            const stopRef = entryCost > 0 ? entryCost : entryClose;
            if (close < peakClose * (1 - TRAIL_PCT) || close < stopRef * (1 - STOP_PCT)) {
              orders.push({
                side: 'sell',
                client_id: `o${orderSeq++}`,
                symbol: SYMBOL,
                qty: heldQty.toString(),
                max_slippage_bps: SELL_SLIP_BPS,
              });
              entryClose = 0;
              peakClose = 0;
            }
          } else if (prevGap !== null && gap > 0 && prevGap <= 0) {
            if (cash >= minNotional) {
              orders.push({
                side: 'buy',
                client_id: `o${orderSeq++}`,
                symbol: SYMBOL,
                notional_quote_units: cash.toString(),
                max_slippage_bps: BUY_SLIP_BPS,
              });
              entryClose = close;
              peakClose = close;
            }
          }
        }
        prevGap = gap;
      }
    }

    process.stdout.write(JSON.stringify({ type: 'reply', seq: batch.seq, orders }) + '\n');
  }
  lines.close();
  process.stdin.destroy();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
