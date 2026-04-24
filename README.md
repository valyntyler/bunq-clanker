# Sauron Wallet — Multimodal AI Investment Analyst

> **Bunq Hackathon 7.0** · Amsterdam · 24–25 Apr 2026
> **Theme:** Multimodal AI · text + vision + audio + sensor + structured data

An AI analyst that researches a public company end-to-end — fundamentals, news, candlestick charts, GPS-detected proximity, and **aggregated Bunq panel spending as a leading indicator of next-quarter revenue** — synthesizes a **BUY / HOLD / AVOID** verdict, then on approval moves real money into a Bunq investment pot and submits an Alpaca paper trade.

The wow:

> Stand outside Heineken HQ. Tap a button. Watch Sauron detect the ticker from your GPS, run a 5-module multimodal pipeline in 25 seconds, surface that **12,843 Bunq users are spending +14% YoY at Heineken venues this quarter** (a hedge-fund-grade leading indicator), note that you yourself spent **€342** there, and let you approve a real money move — all in three minutes.

## Why this wins

- **Alt-data for retail.** Aggregated panel spending → quarterly revenue forecast. The signal hedge funds pay YipitData / Earnest Analytics millions per year for. **Bunq has it natively.**
- **Genuine multimodal.** Text (news/filings), vision (candlestick chart read by Claude Sonnet 4 vision), sensor (GPS proximity), behavioural (aggregated panel + personal Bunq spending).
- **Real money movement.** Bunq sandbox transfer + Alpaca paper trade fire on the user's confirm. Live balances drop on stage.
- **AWS native.** Bedrock (Claude Sonnet 4) for every LLM call, S3 for chart artifacts, scoped IAM via Workshop Studio.
- **Research companion, not a black box.** The synthesizer flags conflicts between modules — that disagreement *is* the product's value.

## Demo (3 minutes)

| t | beat |
|---|---|
| 0:00 | "Hedge funds pay millions per year for one signal: aggregated card spending that predicts quarterly revenue. Bunq has it natively. We just shipped it for retail." |
| 0:15 | 📍 **Use my location** → "You're near **Heineken HQ (0m)** — analyze HEIA.AS?" Tap. |
| 0:30 | Terminal scrolls. Pipeline fires 5 Claude calls in parallel. |
| 1:10 | **Panel Forecast card**: 12,843 users · **+14.0% YoY** · ↑ **+2 to +4%** vs consensus · correlation 0.74 |
| 1:30 | **Your Bunq card**: €342 personal spend · 11 visits · accelerating. *"You eat your own cooking."* |
| 1:45 | Verdict: **HOLD** because fundamentals show -2.8% revenue decline + 93.5% D/E. *Conflicts panel — flagged loudly.* |
| 2:00 | **Invest €40** → live balance pills → Confirm. |
| 2:30 | Receipt: real Bunq payment id + Alpaca order id. Main drops, Pot jumps on screen. |
| 2:45 | Close: GPS, panel, fundamentals, your spend, real money moved. **Bedrock + Bunq.** |

## Run it

```bash
# 1. AWS — workshop-studio creds via the 'prospectus' profile in ~/.aws/
export AWS_PROFILE=prospectus

# 2. Backend
./.venv/bin/uvicorn backend.main:app --reload --port 8080 &

# 3. Frontend
cd frontend && npm run dev -- --port 3000 &

# 4. Pre-flight + warm-up + Bunq top-up
./.venv/bin/python scripts/seed_demo.py
```

Then open: **http://localhost:3000**

Demo URL with location pre-baked: `http://localhost:3000/analyze/HEIA.AS?lat=52.3579&lng=4.8931`

## Architecture

```
Next.js (3000) ──► FastAPI (8080) ──► orchestrator
                                       │
                  ┌────────────────────┼─────────────────────┐
                  ▼                    ▼                     ▼
             scrapers              analyzers             integrations
             yfinance              fundamentals          bunq (sandbox)
             Google News           news_sentiment        alpaca (paper)
             mplfinance            chart_vision          AWS S3
                                   consumer_panel
                                   bunq_spending
                                   synthesizer
                                       │
                                       ▼
                            Bedrock (Claude Sonnet 4)
                            via us. inference profile
```

All five module analyzers run in parallel; the synthesizer takes their outputs and produces a Section-cited verdict.

## Modules live for the demo

| # | Module | Source | Output |
|---|---|---|---|
| 1 | `fundamentals` | yfinance JSON | score + red/green flags |
| 2 | `news_sentiment` | Google News RSS (50 headlines) | score + material events |
| 3 | `chart_vision` | mplfinance 1y OHLCV PNG → Claude vision | trend + S/R + patterns |
| 4 | `consumer_panel` | aggregated panel fixture (simulated) | next-Q forecast direction + range |
| 5 | `bunq_spending` | seeded user payments fixture | personal conviction signal |
| 6 | `synthesizer` | all of the above | verdict + position + conflicts |

## What's simulated, what's real

| | Real | Simulated |
|---|---|---|
| Fundamentals | yfinance live | — |
| News | Google News RSS | — |
| Chart | yfinance OHLCV → real PNG | — |
| Panel | — | hand-tuned per-ticker monthly aggregates |
| Personal Bunq | — | seeded user payment history |
| Bunq money move | live sandbox API | — |
| Alpaca trade | live paper API | — |
| Bedrock LLM | Claude Sonnet 4 via Workshop Studio | — |

The panel + personal-spending fixtures are **honest by design** — Bunq does not yet expose an aggregated panel API, but the architecture assumes one. The README/DevPost names this explicitly.

## Sandbox / paper status

- Bunq Main starts at €0; `scripts/seed_demo.py` tops up to €500 from `sugardaddy@bunq.com`.
- Alpaca paper account starts with $100,000 cash. Orders submitted **after 16:00 ET on a weekday or anytime on the weekend will sit as `accepted` until the next US market open** — that's how all stock brokers work. The order id and timestamp are real.
- Demo on Saturday (2026-04-25)? Be honest: *"Order is queued, fills Monday open. The Bunq move is the real-time piece."*

## Disclaimers

- This is a hackathon prototype.
- Nothing produced is financial advice.
- All money movement is sandbox / paper.
- Panel and personal-spending data are simulated. The architecture assumes Bunq would expose an opt-in, anonymized, k-anonymity-floored aggregate panel API.
- Do **not** use any output for real investment decisions.
