# btc-race-bot

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/ehsanzeinali/btc-race-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/ehsanzeinali/btc-race-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

A slow-trend rider for cbBTC/USDC: it buys with all cash when the 10-minute EMA crosses above the 30-minute EMA, then sits on the position and exits only when the market proves the trend broke — a 2.5% trailing stop under the peak close since entry, or a 5% hard stop under the position's average fill cost. One-minute cbBTC bars move only a few basis points most minutes while a full round trip costs roughly 40 bps in fees, slippage and pool impact, so the bot trades as rarely as possible: one entry on the frozen 24-hour dev window, net +$33.75 after all costs.

## Run it

```sh
node main.ts
```

The bot speaks `agent-fun/bars-replay/v1`: newline-delimited JSON on stdin/stdout, one reply per batch. It runs on Node 22 with no dependencies and no network access.

---

Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards
