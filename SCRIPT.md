# Sauron Wallet — 3-minute demo video script

> **Target length: 3:00** (DevPost spec is 2–4 min). Recorded as a single screencast on your laptop. Everything runs in the browser — the camera scan uses your laptop's built-in webcam, you just hold a branded product up to it. If you only have time for one take, the script holds together end-to-end.

---

## Pre-roll setup checklist (do this before pressing record)

- [ ] Backend running on `:8080`, frontend on `:3000`. Demo account already signed in: **`demo@sauron.app` / `demo1234`**.
- [ ] Demo account's Bunq Main shows **€1,000** (verify with the dashboard balance pill).
- [ ] On the dashboard, have **Heineken (HEIA.AS)** as a recently analyzed report so it loads instantly when clicked. (Run `/analyze/HEIA.AS` once before recording so it's cached.)
- [ ] Have a **Heineken can/bottle** (or any branded product — Coca-Cola can, Nike shoe, an Apple device, anything where the brand reads clearly) ready by your laptop.
- [ ] **Open browser tabs in this order** so you can `Cmd-1, Cmd-2…` through them without fumbling:
  1. `http://localhost:3000` (dashboard)
  2. `http://localhost:3000/scan`
  3. `http://localhost:3000/analyze/HEIA.AS`
  4. `http://localhost:3000/map` (optional, only if you have time)
- [ ] Microphone test: speak normally, listen back to one sentence — nothing worse than recording 3 min of distorted voice.
- [ ] Close Slack, Notifications, anything that can pop up over your screencast.
- [ ] Use **QuickTime → File → New Screen Recording** or OBS. 1080p, 30 fps, system audio off, mic on.

---

## SCENE 1 · Hook (0:00 – 0:15)

**ON SCREEN:** Dashboard home page. Your verdict banner is visible. The "Sauron Wallet" wordmark is in the corner.

**VOICEOVER:**

> *"Hedge funds pay companies like YipitData millions of dollars a year for one signal: aggregated consumer-card spending, because it predicts quarterly revenue with a 0.7 correlation. Bunq has this signal natively, on every transaction. We built the retail-investor product on top of it."*
>
> *"This is Sauron Wallet."*

**TIP:** Lean into the first sentence. It's the only line judges remember if they tune out. Don't smile through it — say it like a fact.

---

## SCENE 2 · The Camera Wow (0:15 – 0:45)

**ON SCREEN:** Switch to the `/scan` tab. Click **"Open camera"** — your laptop webcam light comes on. Toggle to **Live AR** mode. Hold the branded product up to the webcam, ~30cm away, label facing the camera, well-lit.

**VOICEOVER:**

> *"I can point my camera at anything branded in the real world — and Claude Sonnet 4 vision identifies the product, resolves it to the publicly-traded parent company, and shows me my own Bunq spending history at that brand. Live, over a WebSocket, frame by frame."*
>
> *"This is a Heineken can. The AR HUD draws a box on it: HEIA.AS, 92% confident. Underneath: 'loyal — €342 spent, 11 visits, last yesterday, accelerating.' That's my actual Bunq history, pulled live from the API."*
>
> *"And it resolves sub-brands automatically — a Dove bottle would resolve to Unilever, a Cadillac to GM."*

**ON SCREEN:** Click the green bounding box overlay (it's a link).

**TIPS:**
- **Lighting matters more than the brand.** A well-lit Heineken can is easier to detect than a dim Dove bottle. Sit next to a window or aim a desk lamp at the product.
- If Live AR is jittery on your webcam (slower laptops can stutter), **switch to Snapshot mode**, click "Snap", and let the still-image detection card render. Same wow, more reliable on video.
- If the wallet strip doesn't show on your specific brand, mention it verbally and move on. It populates for Heineken / Coca-Cola / Starbucks / Unilever brands / Apple / Nike — the demo seed has spend at Heineken venues, so a Heineken can is the safest bet.
- **Practical staging**: have the can already in your hand off-screen before you start the scene, so you can lift it into frame in one smooth motion.

---

## SCENE 3 · The Multimodal Pipeline (0:45 – 1:45)

**ON SCREEN:** `/analyze/HEIA.AS` opens. The streaming log scrolls down the left. Section cards appear on the right as each module completes.

**VOICEOVER:**

> *"Now twelve analyzer modules fan out in parallel, each on a different modality. Watch them stream in."*
>
> *(point at terminal log)* *"SEC 10-K filing being read — text. Candlestick chart sent as an image to Claude Vision — that's the chart pattern read off the pixels. Earnings-call audio: AWS Transcribe plus librosa prosody plus Claude tone analysis."*

**ON SCREEN:** Scroll to the **Panel Forecast card** with the YoY chart.

> *"This is the flagship: aggregated Bunq panel data. 12,843 users, 14% YoY spend growth at Heineken venues, 0.74 historical correlation to reported revenue. Forecast: Q2 beats consensus by 3 to 5 percent, confidence 0.7. That's the alt-data signal hedge funds pay for, in a retail UI."*

**ON SCREEN:** Scroll to **Geopolitical overlays**.

> *"And every geopolitical clip carries a verified-human / deepfake check. This one's verified — official ECB YouTube channel, prosody fingerprint matches. If a clip looked synthetic, the synthesizer drops it."*

**ON SCREEN:** Scroll to the **verdict banner** at the top.

> *"Final verdict: BUY, 78% confidence — and every claim is cited back to the module that supports it."*

**TIP:** Move briskly. The cards don't all need to be visible — you're conveying *density of evidence*, not reading every word.

---

## SCENE 4 · Add Evidence + Sentiment (1:45 – 2:15)

**ON SCREEN:** Click the floating **"+ Add Evidence"** button. Choose the **Link** tab. Paste any plausible URL (e.g. `https://seekingalpha.com/...`). Tag **"contradicting"**. Submit.

**VOICEOVER:**

> *"It's a research companion — not a black box. I can paste any URL, PDF, image, video, or audio clip mid-analysis. I read a bearish piece on margins, I tag it 'contradicting', and the synthesizer ingests it as a new module and re-emits the verdict, flagging the disagreement."*

**ON SCREEN:** Scroll briefly past the **Sentiment Pulse** section.

> *"It also pulls public sentiment from five sources — Reddit, StockTwits, Hacker News, news, and YouTube — and weights it as evidence."*

**TIP:** If the user-source ingestion is slow, you can skip the actual paste and just open the modal to show the tab options ("Link / Text / Image / PDF / Video / Audio"), then close it. The point is the *capability*, not the round-trip.

---

## SCENE 5 · Real Bunq Money Moves (2:15 – 2:45)

**ON SCREEN:** Click **"Choose amount · invest"** on the verdict banner. Invest modal opens. Slider visible. Pre-filled with the recommended amount.

**VOICEOVER:**

> *"And this is real. Tap Invest. I see my Bunq Main Wallet balance — €1,000. I pick €100 of Heineken. Confirm."*

**ON SCREEN:** Drag slider to €100. Click **Confirm**.

**VOICEOVER:**

> *"Behind that confirm: a real Bunq sandbox API call moves €100 from my Main account into an auto-created 'Sauron · HEIA.AS' pot, and an Alpaca paper order fires for the equivalent USD."*

**ON SCREEN:** Receipt screen renders — shows Bunq payment ID + Alpaca order ID + new pot balance.

**VOICEOVER:**

> *"Here's the receipt: Bunq payment ID, Alpaca order ID, the new pot balance. No mocks. Every Sauron user gets their own minted Bunq sandbox account on signup — three sign-up paths: Bunq, Google, or email."*

**TIP:** This is the moment that wins the **bunq Integration 15%** category. Make sure the receipt screen is clearly visible for at least 3 seconds.

---

## SCENE 6 · Close (2:45 – 3:00)

**ON SCREEN:** Cut back to the dashboard, or quickly flip through one or two extra surfaces (Map mode, Voice analyst button, Receipts page) as a montage.

**VOICEOVER:**

> *"Webcam, voice, GPS, video, audio, your wallet — six modalities, all routed through Claude Sonnet 4 on AWS Bedrock, all reshaping a single sourced verdict, and real money moving through Bunq at the end of it."*
>
> *"This is what every retail investor should have."*
>
> *"Sauron Wallet."*

**ON SCREEN:** End on the dashboard with the wordmark visible. Hold for 1 second of silence before stopping the recording.

---

## Recording tips

- **Speak ~10% slower than feels natural.** You always speed up under recording pressure.
- **Mouse hover, don't click everything.** Hover the cursor over the thing you're describing — it draws the viewer's eye without a click animation interrupting.
- **One mistake = restart.** Don't try to splice. The script is short enough that one clean take beats five edited fragments.
- **If you fluff a line, pause for a beat and retry the line cleanly.** You can cut the bad take in post with a single jump cut.
- **Don't apologize on camera.** If something doesn't load, mention it casually ("the live RSS poller's just refreshing") and move on.

## After recording

- Trim head + tail. Don't add intro music — the demo speaks for itself.
- Export 1080p H.264, upload to YouTube as **unlisted**.
- Paste the YouTube URL into the DevPost submission form.

## Backup script (90 sec) if everything goes sideways

If you only have time for one take and something is broken:

> *"Hedge funds pay millions for the consumer-spending signal that Bunq has natively. Sauron Wallet is the retail-investor product on top of it. Twelve Claude Sonnet 4 modules — text, image, audio, video, GPS, behavioural — fan out per analysis, with a consumer-panel forecast as the headline alt-data signal and a deepfake check on every geopolitical clip. The signature flow: point your camera at any branded product, get a 60-second analysis, and invest with one tap into a real Bunq sandbox pot. AI on AWS Bedrock, real money on Bunq, multimodal evidence that actually shapes the verdict."*

That's 30 seconds spoken. Then 60 seconds of silently clicking through `/scan` → `/analyze/HEIA.AS` → invest → receipt. Done.
