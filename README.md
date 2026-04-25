# Sauron Wallet

> **Point your phone at any product. Get a hedge-fund-grade investment thesis in 90 seconds. Move real (sandbox) money in two taps.**

A multimodal AI investment analyst, built for **bunq Hackathon 7.0 — Multimodal AI**. Sauron Wallet ingests text, images, audio, video, sensor (GPS) and behavioural (Bunq spending) data, runs each modality through Claude Sonnet 4 on AWS Bedrock, synthesises a sourced **BUY / HOLD / AVOID** verdict with a next-quarter revenue forecast, and — on user approval — moves euros between Bunq sandbox accounts and fires a paper trade on Alpaca.

---

## Try it now

The repo ships with a public demo account, pre-loaded with a Bunq sandbox link and **€1,000 in the Main Wallet** ready to invest. The seeder runs on every backend boot and self-heals — you can't break it.

```text
email:    demo@sauron.app
password: demo1234
```

The login screen shows a green banner with a one-click *use these* button that prefills the form.

---

## The thesis

Hedge funds pay firms like YipitData and Earnest Analytics **millions per year** for one specific signal: aggregated, anonymised consumer-card spending data, because it's a 0.6–0.8-correlation **leading indicator of quarterly revenue.** When card-panel spend at a merchant rises N% YoY in April–June, the company's reported Q2 revenue typically follows.

Bunq sits on this signal **natively** — every transaction across millions of users. Sauron Wallet is the retail-investor product on top of that data, with a layer of multimodal evidence stacked on top so the verdict isn't naked alt-data — it's alt-data cross-checked against fundamentals, news sentiment, chart vision, earnings-call audio, geopolitical video, your own personal spend, and anything else you paste in mid-analysis.

---

## The "wow" loop, in 90 seconds

1. **Point your phone camera** at a six-pack of Heineken in your fridge.
2. The **AR HUD** (over a persistent WebSocket → Claude vision) draws a green box around the bottle: `HEIA.AS · Heineken · 92% sure · ↗`. It also resolves *Dove → Unilever / UNA.AS* style sub-brands automatically.
3. A **wallet strip** shows underneath: *"loyal · €342 spent · 11 visits · last yesterday · accelerating ↗"* — your own Bunq spending history at every Heineken venue, surfaced live from the API.
4. **Tap the box** → routes you to `/analyze/HEIA.AS`. A Bloomberg-terminal-style log starts streaming as 12 analyzer modules fan out in parallel.
5. Sixty seconds later you have a **verdict banner** (BUY · 78% confidence · `+3 to +5%` Q2 revenue beat), a **panel-forecast card** with a 12-month YoY chart and a 0.74 historical correlation, **geopolitical overlays** with deepfake-check chips on every clip, an **earnings-call tone breakdown**, and a **sentiment pulse** stitched together from Reddit + StockTwits + HackerNews + news + YouTube.
6. **Tap "Choose amount"**. Slider. Confirm. Watch your **Bunq Main Wallet drop by €X**, the **Sauron · HEIA.AS pot** appear with €X, and an **Alpaca paper order ID** print on the receipt — all in real Bunq sandbox API calls. No mocks.

The same flow works from a barcode, a website screenshot, a brand logo on a billboard, or a typed ticker.

---

## Headline features

### 📷 Live AR scan over WebSocket

Hold your camera up to anything branded — products, store fronts, vehicles, billboards, labels. A persistent `ws://` connection streams JPEG frames straight to Claude vision (no per-frame HTTP overhead), and bounding boxes pop into the live feed with the parent ticker, your wallet relationship to the brand, and a one-tap link to the full analysis. Sub-brand resolution is built in: a Dove bottle resolves to **UNA.AS / Unilever**, a Cadillac resolves to **GM**.

### 🎙️ Voice analyst with tool use

Hold-to-talk button. Web Audio noise gating + local **faster-whisper** for sub-1s transcription (10× faster than AWS Transcribe). Claude replies with **tool use** — it can search the live newsroom, query the web, pull ticker quotes, and look up the consumer-panel forecast on its own, announcing each tool call inline. The reply is streamed back through **AWS Polly Generative voice (Ruth)** for an actually-human-sounding answer.

### 📊 Aggregated Bunq panel forecast

The flagship feature. Aggregates merchant-level spend across the panel, computes YoY/QoQ, fits historical correlation against reported revenue, and emits a **next-quarter forecast** (`beat / in-line / miss · +3 to +5% vs consensus · confidence 0.7`). Prominent chart + arrow + correlation figure. K-anonymity floor (`N_MIN = 500`) — never exposes a merchant aggregate without enough panel coverage.

### 📺 Geopolitical clips with deepfake check

The system pulls clips from market-moving figures (Trump, Lagarde, Powell, Xi, EU Commission, OPEC) via yt-dlp, runs **AWS Transcribe + librosa prosody + ffmpeg 9-frame grid → Claude multimodal** to score each clip's relevance to the target ticker. Every clip carries an **authenticity report**: trusted-source verification (curated YouTube channel IDs + .gov / .europa.eu / .un.org / Reuters / AP / Bloomberg) plus a prosody fingerprint (pitch jitter, RMS variability, silence fraction). Synthesizer down-weights overlays scoring < 0.5 and drops `likely_synthetic` clips entirely. Chip on every overlay: ✓ verified · ✓ likely real · ? unverified · ✗ deepfake-suspected.

### 🧾 Receipt OCR + Bunq bill-split

Snap a receipt → Claude vision parses every line item, attributes each to its publicly-traded parent, and computes per-person totals. **Real** Bunq `request-inquiry` calls fire to each tagged friend's email; the bunq.me share URL surfaces in the UI as a tap-to-pay chip per recipient.

### 💬 Add Evidence (mid-analysis)

A floating **+ Add Evidence** button on every report. Paste a URL, paste raw text, drop a PDF (PyMuPDF text + per-page screenshots), drop an image (Claude vision), drop a video clip (ffmpeg + Transcribe + frame grid), or drop an audio file (Transcribe + prosody). Tag it `supporting / contradicting / neutral`. The synthesizer ingests it as a `UserSource` analyzer module, weights it as supplementary evidence (capped at 20%), surfaces the contradiction loudly if your bear-case article disagrees with the panel forecast, and re-emits the verdict.

### 🗺️ Map mode

Every covered HQ pinned on a CartoDB Dark Matter basemap, coloured by your most-recent verdict (BUY green / HOLD amber / AVOID red / grey if not yet analysed) and sized by how much you've spent at that company. Click a pin to jump to the analysis.

### 🔄 Multimodal portfolio rebalance

Cross-tabs your Bunq spending × your existing investments × the most-recent verdicts. Surfaces underweight positions ("you spend €340/year at Heineken but hold zero shares — suggested rebalance: +€50") and overweight informational warnings. One-tap opens the Invest modal pre-filled.

### 📡 Live newsroom + earnings copilot

A background poller scrapes 7 outlets (Reuters, Bloomberg, AP, WSJ, FT, Yahoo Finance, CNBC) on a 3-minute cadence. The earnings copilot streams a live transcribed scoring of any earnings call URL — yt-dlp pulls the audio, AWS Transcribe runs in batch, and chunked Claude scoring streams back over SSE so the user sees a tone-and-implications breakdown growing line-by-line.

### 💚 Real Bunq integration

No mocks. Every account has its own minted Bunq sandbox user with API key stored server-side, their own Main account, their own auto-created **Sauron · TICKER** pots per investment, real `request-inquiry` calls for receipt splits with bunq.me share URLs, real balance reads, real payment IDs on every receipt. The seeder uses sugardaddy@bunq.com for the demo top-up — chunked to ≤€100 per request because sandbox caps it there.

---

## Architecture

```
┌──────────────┐      ┌────────────────────────────────────────┐
│  Next.js UI  │─────▶│         FastAPI orchestrator            │
│  (App Router)│◀─────│   /analyze/stream  /scan/ws  /chat ...  │
└──────────────┘      └────────┬───────────────────────────────┘
                               │
          ┌────────────────────┼────────────────────────┐
          ▼                    ▼                        ▼
   ┌─────────────┐     ┌──────────────┐        ┌───────────────┐
   │  Scrapers   │     │   Analyzers  │        │  Integrations │
   │             │     │              │        │               │
   │ • yfinance  │     │ • text       │        │ • Bunq SDK    │
   │ • SEC EDGAR │     │ • vision     │        │   (per-user)  │
   │ • NewsAPI   │     │ • audio      │        │ • Alpaca      │
   │ • Reddit    │     │ • video      │        │   (paper)     │
   │ • StockTw.  │     │ • synthesize │        │ • AWS Polly   │
   │ • HN / YT   │     │              │        │ • AWS Trnscb. │
   │ • yt-dlp    │     │              │        │ • Claude on   │
   │ • RSS       │     │              │        │   Bedrock     │
   └─────────────┘     └──────────────┘        └───────────────┘
                               │
                               ▼
                      ┌────────────────┐
                      │  SQLite +      │
                      │  per-user JWT  │
                      │  + S3 artifacts│
                      └────────────────┘
```

12 analyzer modules run in parallel via `asyncio.gather`. Each emits a partial result over SSE the moment it's done, so the UI streams the report section by section.

---

## Quick start (local)

### Prereqs
- Python 3.11+
- Node 20+
- `ffmpeg`, `yt-dlp` on `$PATH`
- AWS account with Bedrock model access enabled for `claude-sonnet-4-20250514` in `us-east-1`
- Bunq sandbox API key (free, takes 30 seconds at https://together.bunq.com)
- Alpaca paper API key (free at https://alpaca.markets)

### Setup
```bash
# 1. Clone & enter
git clone git@github.com:valyntyler/bunq-clanker.git
cd bunq-clanker

# 2. Backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in your keys

# 3. Frontend
cd frontend
npm install
cp .env.example .env.local

# 4. Run
cd ..
./.venv/bin/uvicorn backend.main:app --port 8080 &
cd frontend && npm run dev -- --port 3000
```

The backend's startup hook seeds the demo account on first boot — sign in at http://localhost:3000 with the credentials at the top of this README.

---

## Tech stack

| Layer            | Tech                                                                      |
|------------------|---------------------------------------------------------------------------|
| LLM              | Claude Sonnet 4 via **AWS Bedrock** (text + vision + tool use)            |
| Voice TTS        | **AWS Polly Generative** (Ruth) with Polly Neural fallback                |
| Voice ASR        | **faster-whisper** (local, int8 CPU) with **AWS Transcribe** fallback     |
| Audio prosody    | librosa (pitch / RMS / silence)                                           |
| Video            | yt-dlp + ffmpeg (audio extract + 9-frame grid)                            |
| Backend          | FastAPI + SQLModel + SQLite + SSE + WebSockets                            |
| Frontend         | Next.js 16 (App Router) + Tailwind + Recharts + Leaflet + react-markdown  |
| Banking          | **Bunq sandbox** SDK (per-user creds, pots, request-inquiry, bunq.me)     |
| Brokerage        | Alpaca paper trading                                                      |
| Object storage   | AWS S3 (clips + frame grids + chart PNGs + report snapshots)              |
| Auth             | bcrypt + HS256 JWT                                                        |

---

## Multimodal stack at a glance

| Modality       | What it is                                | How we use it                                                                                    |
|----------------|-------------------------------------------|--------------------------------------------------------------------------------------------------|
| 📝 **Text**     | News, filings, transcripts, social posts  | Claude scoring on SEC EDGAR 10-Ks, NewsAPI, Reddit, StockTwits, Hacker News                      |
| 🖼️ **Image**    | Camera scans, charts, screenshots, PDFs   | Claude vision: brand→ticker resolution + chart pattern reading + receipt OCR + PDF figure pages |
| 🎙️ **Audio**    | Earnings calls + voice analyst            | AWS Transcribe + librosa prosody → Claude tone analysis; faster-whisper for the user's own voice |
| 🎬 **Video**    | Geopolitical clips                        | yt-dlp + ffmpeg → 9-frame grid + audio extract → Claude multimodal + deepfake authenticity check |
| 📍 **Sensor**   | Browser GPS                               | Haversine over a curated EU/US HQ registry → "you're 120m from Heineken HQ — analyse HEIA.AS?"   |
| 💳 **Behavioural** | Bunq panel + personal spending         | Aggregated panel YoY/QoQ → next-quarter revenue forecast; per-user spend × ticker conviction      |

---

## License & hackathon notes

- All financial figures, verdicts, and signals are LLM-generated. **Not financial advice.**
- All money movements happen in **Bunq sandbox** + **Alpaca paper trading**. No real funds touched.
- Aggregated panel data is **simulated** for the prototype — the architecture assumes Bunq would expose an opt-in, anonymised aggregated panel API as a natural product extension. Methodology is honest about this in the UI.
- API keys committed to `.env.example` only. The real `.env` is gitignored.

Built in two days for **bunq Hackathon 7.0 — Amsterdam, April 2026**. Sponsors: AWS, Anthropic.
