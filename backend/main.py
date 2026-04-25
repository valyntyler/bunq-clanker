"""FastAPI entrypoint.

Tier-1 surface only:
    GET  /health
    POST /analyze           -> Report JSON (fake until orchestrator lands)
    GET  /nearby-tickers    -> NearbyTicker[]
    GET  /panel/{ticker}    -> ConsumerPanelForecast
    POST /invest            -> InvestReceipt (stub until Bunq/Alpaca wired)

Streaming (SSE) will be added once the real orchestrator is in place —
frontend's TerminalLog will subscribe to that feed.
"""

from __future__ import annotations

import logging
import math
import os
from datetime import datetime, timezone
from pathlib import Path

import asyncio
import json as _json

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

load_dotenv()

from backend.analyzers.consumer_panel import analyze_consumer_panel
from backend.analyzers.user_image import analyze_user_image
from backend.analyzers.user_pdf import analyze_user_pdf
from backend.analyzers.user_text import analyze_user_text
from backend.analyzers.user_video import analyze_user_video
from backend.integrations import alpaca as alpaca_i
from backend.integrations import bunq as bunq_i
from backend.analyzers.chat import chat_once, chat_stream
from backend.analyzers.ipo_thesis import list_ipos, get_brief as get_ipo_brief, thesis_for
from backend.analyzers.synthesizer import synthesize
from backend.auth import (
    create_token,
    decode_token,
    hash_password,
    require_user,
    verify_password,
)
from backend.db import (
    AnalysisRun,
    CachedReport,
    Investment,
    User,
    UserEvidence,
    engine,
    get_session,
    init_db,
)
from sqlmodel import Session, select
from backend.models import (
    AnalyzeRequest,
    AuthResponse,
    ChatRequest,
    ChatResponse,
    ConsumerPanelForecast,
    EvidenceRequest,
    InvestReceipt,
    InvestRequest,
    LoginRequest,
    NearbyTicker,
    RegisterRequest,
    Report,
    ResynthesizeRequest,
    UserSource,
)
from fastapi import Depends
from backend.orchestrator import analyze_async, analyze_stream
from backend.report_pdf import render_report_pdf
from backend.scrapers.compress import compress_audio, compress_image, compress_video
from backend.scrapers.user_evidence import fetch_url, passthrough_text
from backend.scrapers.yahoo import fetch_ohlcv, validate_ticker

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("prospectus")

app = FastAPI(title="Prospectus / Sauron Wallet", version="0.0.1")


@app.on_event("startup")
def _startup() -> None:
    init_db()

# frontend is served from a different port in dev — allow localhost origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---- fixtures loaded once at boot ----
FIXTURES = Path(__file__).parent / "fixtures"
HQ_REGISTRY = Path(__file__).parent / "location" / "hq_registry.json"


def _load_hq_registry() -> list[dict]:
    import json

    if not HQ_REGISTRY.exists():
        return []
    return json.loads(HQ_REGISTRY.read_text())


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in meters."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


# ---- auth -------------------------------------------------------------

EMAIL_RE = __import__("re").compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@app.post("/auth/register", response_model=AuthResponse)
def auth_register(req: RegisterRequest, session: Session = Depends(get_session)) -> AuthResponse:
    email = req.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "invalid email")
    if len(req.password) < 8:
        raise HTTPException(400, "password must be at least 8 characters")
    existing = session.exec(select(User).where(User.email == email)).first()
    if existing:
        raise HTTPException(409, "an account with that email already exists")
    user = User(email=email, password_hash=hash_password(req.password))
    session.add(user)
    session.commit()
    session.refresh(user)
    token = create_token(user.id)
    return AuthResponse(
        token=token,
        user={"id": user.id, "email": user.email, "created_at": user.created_at.isoformat()},
    )


@app.post("/auth/login", response_model=AuthResponse)
def auth_login(req: LoginRequest, session: Session = Depends(get_session)) -> AuthResponse:
    email = req.email.strip().lower()
    user = session.exec(select(User).where(User.email == email)).first()
    if user is None or not verify_password(req.password, user.password_hash):
        # Keep the message generic — don't leak which side was wrong
        raise HTTPException(401, "invalid credentials")
    token = create_token(user.id)
    return AuthResponse(
        token=token,
        user={"id": user.id, "email": user.email, "created_at": user.created_at.isoformat()},
    )


@app.get("/auth/me")
def auth_me(user: User = Depends(require_user)) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "created_at": user.created_at.isoformat(),
    }


# ---- per-user dashboard --------------------------------------------------


# ---- pre-IPO ------------------------------------------------------------


@app.post("/evidence/from-url/stream")
async def evidence_from_url_stream(
    payload: dict,
    user: User = Depends(require_user),
    session: Session = Depends(get_session),
) -> StreamingResponse:
    """Ingest a YouTube URL on-demand: download a 30-60s segment, run the full
    multimodal pipeline (audio extract + Transcribe + frame grid + prosody +
    Claude vision), append the result as a UserSource for the user's analysis
    of <ticker>.

    Body:
        { url: str, ticker: str, company_name?: str,
          start_s?: int (default 0), duration_s?: int (default 60),
          user_note?: str, user_tag?: 'supporting'|'contradicting'|'neutral' }

    SSE events:
        {step, status} per stage (yt_dlp, audio_extract, prosody, frame_grid,
        transcribe, vision_claude), then {result: UserSource}.
    """
    url = (payload.get("url") or "").strip()
    ticker = (payload.get("ticker") or "").upper().strip()
    company_name = payload.get("company_name")
    start_s = int(payload.get("start_s") or 0)
    duration_s = int(payload.get("duration_s") or 60)
    user_note = payload.get("user_note") or ""
    user_tag = payload.get("user_tag") or "neutral"
    if user_tag not in ("supporting", "contradicting", "neutral"):
        user_tag = "neutral"
    if not url or not ticker:
        raise HTTPException(400, "url and ticker required")
    if duration_s > 180:
        duration_s = 180  # cap at 3 min so Transcribe doesn't run forever

    queue: asyncio.Queue[dict] = asyncio.Queue()
    loop = asyncio.get_event_loop()

    def on_step(name: str, status: str, detail: dict | None = None) -> None:
        ev: dict = {"step": name, "status": status}
        if detail:
            ev["detail"] = detail
        loop.call_soon_threadsafe(queue.put_nowait, ev)

    def run_pipeline() -> None:
        try:
            from backend.scrapers.geopolitical_clips import yt_dlp_segment
            from backend.analyzers.user_video import analyze_user_video
            import tempfile
            from pathlib import Path

            on_step("yt_dlp", "running")
            with tempfile.TemporaryDirectory(prefix="from-url-") as td:
                mp4 = Path(td) / "clip.mp4"
                yt_dlp_segment(url, start_s, duration_s, mp4)
                mp4_bytes = mp4.read_bytes()
            on_step("yt_dlp", "done", {"bytes": len(mp4_bytes)})

            src = analyze_user_video(
                ticker=ticker,
                company_name=company_name,
                video_bytes=mp4_bytes,
                content_type="video/mp4",
                user_note=user_note or f"Ingested from {url}",
                user_tag=user_tag,  # type: ignore[arg-type]
                filename=url[-60:],
                is_audio_only=False,
                on_step=on_step,
            )
            _persist_user_evidence(session, user, src, ticker, company_name)
            asyncio.run_coroutine_threadsafe(
                queue.put({"result": src.model_dump()}), loop
            )
        except Exception as e:  # noqa: BLE001
            log.exception("evidence_from_url_stream failed")
            asyncio.run_coroutine_threadsafe(queue.put({"error": str(e)}), loop)
        finally:
            asyncio.run_coroutine_threadsafe(queue.put({"_done": True}), loop)

    loop.run_in_executor(None, run_pipeline)

    async def event_gen():
        while True:
            ev = await queue.get()
            if ev.get("_done"):
                return
            yield f"data: {_json.dumps(ev)}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "cache-control": "no-cache",
            "x-accel-buffering": "no",
            "connection": "keep-alive",
        },
    )


@app.get("/geopolitical/search")
async def geopolitical_search(
    q: str,
    max_results: int = 10,
    user: User = Depends(require_user),
) -> dict:
    """Live YouTube search for geopolitical clips. Returns metadata only —
    no download. The frontend can deep-link to YouTube; the seed_clips
    pipeline can be triggered separately to ingest a specific result."""
    if not q.strip():
        raise HTTPException(400, "empty query")
    try:
        from backend.scrapers.geopolitical_clips import yt_dlp_search

        results = await asyncio.to_thread(
            yt_dlp_search, q.strip(), min(max_results, 20)
        )
    except Exception as e:  # noqa: BLE001
        log.exception("yt-dlp search failed")
        raise HTTPException(503, f"search unavailable: {e}")
    return {"query": q, "results": results}


@app.get("/ipos")
def ipos_list(user: User = Depends(require_user)) -> dict:
    """Curated calendar of upcoming / rumored IPOs with the brief view."""
    return list_ipos()


@app.get("/ipos/{slug}")
def ipos_detail(slug: str, user: User = Depends(require_user)) -> dict:
    """Brief + Claude thesis for one IPO. Thesis is cached per slug."""
    brief = get_ipo_brief(slug)
    if brief is None:
        raise HTTPException(404, f"unknown IPO slug {slug!r}")
    thesis = thesis_for(slug)
    return {"brief": brief, "thesis": thesis}


@app.get("/trending")
async def trending(
    hours: int = 168,           # default 7 days
    limit: int = 12,
    include_spark: bool = True,
    user: User = Depends(require_user),
    session: Session = Depends(get_session),
) -> dict:
    """Top tickers analyzed across all users in the last `hours` window.

    Returns aggregated counts plus the most-recent verdict per ticker and
    (optionally) a 30-day daily-close sparkline from yfinance.
    """
    from datetime import timedelta
    from sqlalchemy import func as sa_func

    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    rows = session.exec(
        select(
            AnalysisRun.ticker,
            sa_func.count(AnalysisRun.id).label("n"),
            sa_func.max(AnalysisRun.created_at).label("last_at"),
        )
        .where(AnalysisRun.created_at >= cutoff)
        .group_by(AnalysisRun.ticker)
        .order_by(sa_func.count(AnalysisRun.id).desc())
        .limit(limit)
    ).all()

    out: list[dict] = []
    for r in rows:
        ticker = r[0]
        n = int(r[1])
        last_at = r[2]
        latest = session.exec(
            select(AnalysisRun)
            .where(AnalysisRun.ticker == ticker)
            .order_by(AnalysisRun.created_at.desc())
            .limit(1)
        ).first()
        if last_at is not None and last_at.tzinfo is None:
            last_at = last_at.replace(tzinfo=timezone.utc)
        out.append(
            {
                "ticker": ticker,
                "company_name": (latest.company_name if latest else ticker) or ticker,
                "search_count": n,
                "last_at": last_at.isoformat() if last_at else None,
                "latest_verdict": latest.verdict if latest else None,
                "latest_confidence": latest.confidence if latest else None,
                "one_liner": latest.one_liner if latest else None,
            }
        )

    if include_spark and out:
        async def _fetch_spark(ticker: str) -> tuple[list[float], str | None]:
            try:
                bars, currency = await asyncio.to_thread(
                    fetch_ohlcv, ticker, "1mo"
                )
                return [b["close"] for b in bars], currency
            except Exception:  # noqa: BLE001
                return [], None

        sparks = await asyncio.gather(*[_fetch_spark(r["ticker"]) for r in out])
        for entry, (closes, currency) in zip(out, sparks):
            entry["spark"] = closes
            entry["currency"] = currency

    return {
        "as_of": datetime.now(timezone.utc).isoformat(),
        "window_hours": hours,
        "trending": out,
    }


@app.get("/me/investments")
def me_investments(
    user: User = Depends(require_user),
    session: Session = Depends(get_session),
    enrich: bool = True,
) -> dict:
    """List the user's invest receipts. When `enrich=true`, each one is
    augmented with the Alpaca order's current status + fill data + last
    trade price + unrealized P&L."""
    rows = session.exec(
        select(Investment)
        .where(Investment.user_id == user.id)
        .order_by(Investment.created_at.desc())
        .limit(200)
    ).all()
    out: list[dict] = []
    total_invested_eur = 0.0
    total_unrealized_pnl_usd = 0.0
    for r in rows:
        d = r.model_dump()
        d["created_at"] = r.created_at.isoformat()
        total_invested_eur += r.amount_eur
        if enrich and r.alpaca_order_id:
            o = alpaca_i.get_order(r.alpaca_order_id)
            d["alpaca"] = o
            if o and o.get("filled_avg_price") and o.get("filled_qty"):
                last = alpaca_i.latest_trade_price(r.alpaca_symbol)
                if last:
                    d["current_price_usd"] = last
                    d["unrealized_pnl_usd"] = round(
                        (last - o["filled_avg_price"]) * o["filled_qty"], 2
                    )
                    d["unrealized_pnl_pct"] = round(
                        (last / o["filled_avg_price"] - 1) * 100, 2
                    )
                    total_unrealized_pnl_usd += d["unrealized_pnl_usd"]
        out.append(d)
    return {
        "investments": out,
        "summary": {
            "count": len(out),
            "total_invested_eur": round(total_invested_eur, 2),
            "total_unrealized_pnl_usd": round(total_unrealized_pnl_usd, 2),
        },
    }


@app.get("/me/evidence")
def me_evidence(
    user: User = Depends(require_user),
    session: Session = Depends(get_session),
) -> dict:
    rows = session.exec(
        select(UserEvidence)
        .where(UserEvidence.user_id == user.id)
        .order_by(UserEvidence.created_at.desc())
        .limit(200)
    ).all()
    return {
        "evidence": [
            {**r.model_dump(), "created_at": r.created_at.isoformat()} for r in rows
        ]
    }


@app.get("/me/analyses")
def me_analyses(
    user: User = Depends(require_user),
    session: Session = Depends(get_session),
    limit: int = 50,
) -> dict:
    rows = session.exec(
        select(AnalysisRun)
        .where(AnalysisRun.user_id == user.id)
        .order_by(AnalysisRun.created_at.desc())
        .limit(min(limit, 200))
    ).all()
    return {
        "analyses": [
            {**r.model_dump(), "created_at": r.created_at.isoformat()} for r in rows
        ]
    }


# ---- public endpoints (intentionally unauthenticated) ----------------


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "time": datetime.now(timezone.utc).isoformat(),
        "llm_provider": os.getenv("LLM_PROVIDER", "bedrock"),
        "bedrock_model": os.getenv("BEDROCK_MODEL_ID"),
        "s3_bucket": os.getenv("AWS_S3_BUCKET"),
    }


@app.post("/analyze/stream")
async def analyze_stream_route(
    req: AnalyzeRequest,
    user: User = Depends(require_user),
    session: Session = Depends(get_session),
) -> StreamingResponse:
    """SSE stream of pipeline events. Events:
        start, module_start, module_done, synthesizing, report, error

    On the final 'report' event, also persists a CachedReport row so the
    frontend can re-hydrate this analysis instantly on navigate-back.
    """
    coords = (req.lat, req.lng) if req.lat is not None and req.lng is not None else None
    location_label = _nearest_label(coords) if coords else None
    ticker_upper = req.ticker.upper()

    # Validate the ticker before kicking off any modules so we fail fast
    # rather than fabricating analysis on a non-existent symbol.
    valid, _name = await asyncio.to_thread(validate_ticker, ticker_upper)

    async def event_gen():
        if not valid:
            yield f"data: {_json.dumps({'event': 'error', 'message': f'Unknown ticker: {ticker_upper}. Try a real listed symbol (e.g. HEIA.AS, AAPL, NVDA).'})}\n\n"
            return
        try:
            async for ev in analyze_stream(
                ticker_upper, coords=coords, location_label=location_label
            ):
                yield f"data: {_json.dumps(ev)}\n\n"
                # Cache the final report so navigate-back hydrates instantly.
                if ev.get("event") == "report":
                    try:
                        report_obj = Report(**ev["report"])
                        _persist_cached_report(session, user, report_obj)
                    except Exception:  # noqa: BLE001
                        log.exception("failed to cache stream report (non-fatal)")
        except Exception as e:  # noqa: BLE001
            log.exception("analyze_stream failed")
            yield f"data: {_json.dumps({'event': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "cache-control": "no-cache",
            "x-accel-buffering": "no",  # disable nginx-style buffering
            "connection": "keep-alive",
        },
    )


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, user: User = Depends(require_user)) -> ChatResponse:
    """Single-shot chat about an existing report."""
    if not req.message.strip():
        raise HTTPException(400, "empty message")
    text = await asyncio.to_thread(chat_once, req.report, req.history, req.message)
    return ChatResponse(role="assistant", content=text)


@app.post("/chat/stream")
async def chat_stream_route(
    req: ChatRequest, user: User = Depends(require_user)
) -> StreamingResponse:
    """SSE-streamed chat — emits {token: '...'} per content delta."""
    if not req.message.strip():
        raise HTTPException(400, "empty message")

    async def event_gen():
        try:
            for token in chat_stream(req.report, req.history, req.message):
                yield f"data: {_json.dumps({'token': token})}\n\n"
            yield f"data: {_json.dumps({'done': True})}\n\n"
        except Exception as e:  # noqa: BLE001
            log.exception("chat_stream failed")
            yield f"data: {_json.dumps({'error': str(e)})}\n\n"

    # Run the blocking generator in a thread so we don't starve the event loop
    async def threaded_gen():
        loop = asyncio.get_event_loop()
        queue: asyncio.Queue[str | None] = asyncio.Queue()

        def producer():
            try:
                for token in chat_stream(req.report, req.history, req.message):
                    asyncio.run_coroutine_threadsafe(queue.put(token), loop)
            except Exception as e:  # noqa: BLE001
                asyncio.run_coroutine_threadsafe(
                    queue.put(f"__error__:{e}"), loop
                )
            finally:
                asyncio.run_coroutine_threadsafe(queue.put(None), loop)

        loop.run_in_executor(None, producer)

        while True:
            item = await queue.get()
            if item is None:
                yield f"data: {_json.dumps({'done': True})}\n\n"
                return
            if isinstance(item, str) and item.startswith("__error__:"):
                yield f"data: {_json.dumps({'error': item[10:]})}\n\n"
                return
            yield f"data: {_json.dumps({'token': item})}\n\n"

    return StreamingResponse(
        threaded_gen(),
        media_type="text/event-stream",
        headers={
            "cache-control": "no-cache",
            "x-accel-buffering": "no",
            "connection": "keep-alive",
        },
    )


@app.post("/report/pdf")
async def report_pdf(
    report: Report, user: User = Depends(require_user)
) -> StreamingResponse:
    """Render the synthesized Report into a Bunq-themed PDF download."""
    from fastapi.responses import Response

    pdf_bytes = await asyncio.to_thread(render_report_pdf, report)
    fname = f"sauron-{report.ticker.replace('.', '_')}-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"content-disposition": f'attachment; filename="{fname}"'},
    )


@app.post("/resynthesize", response_model=Report)
async def resynthesize(
    req: ResynthesizeRequest, user: User = Depends(require_user)
) -> Report:
    """Re-run the synthesizer with the original modules + new user_sources.
    Returns a fresh Report with updated verdict/confidence/one_liner/conflicts.
    Skips all the expensive scraping; only the synthesizer Claude call fires.
    """
    synth = await asyncio.to_thread(
        synthesize,
        ticker=req.ticker,
        company_name=req.company_name,
        sections=req.sections,
        consumer_panel=req.consumer_panel_forecast,
        bunq_spending=req.bunq_spending_overlay,
        geopolitical_overlays=req.geopolitical_overlays,
        user_sources=req.user_sources,
    )
    from datetime import datetime, timezone

    return Report(
        ticker=req.ticker,
        company_name=req.company_name,
        generated_at=datetime.now(timezone.utc).isoformat(),
        verdict=synth["verdict"],
        confidence=float(synth["confidence"]),
        position_size_pct=float(synth["position_size_pct"]),
        one_liner=synth["one_liner"],
        sections=req.sections,
        consumer_panel_forecast=req.consumer_panel_forecast,
        bunq_spending_overlay=req.bunq_spending_overlay,
        geopolitical_overlays=req.geopolitical_overlays,
        user_sources=req.user_sources,
        location_context=req.location_context,
        risks=synth.get("risks", []),
        conflicts=synth.get("conflicts", []),
        data_gaps=synth.get("data_gaps", []),
    )


MAX_UPLOAD_BYTES = {
    "image": 10 * 1024 * 1024,   # 10 MB
    "video": 60 * 1024 * 1024,   # 60 MB (~1 min @ 720p)
    "audio": 30 * 1024 * 1024,   # 30 MB
    "pdf":   15 * 1024 * 1024,   # 15 MB
}


@app.post("/evidence/upload", response_model=UserSource)
async def evidence_upload(
    ticker: str = Form(...),
    source_type: str = Form(...),  # "image" | "video" | "audio" | "pdf"
    user_note: str = Form(""),
    user_tag: str = Form("neutral"),
    company_name: str | None = Form(None),
    file: UploadFile = File(...),
    user: User = Depends(require_user),
    session: Session = Depends(get_session),
) -> UserSource:
    """Multipart upload for image / video / audio / pdf evidence."""
    if source_type not in MAX_UPLOAD_BYTES:
        raise HTTPException(400, f"unsupported source_type {source_type}")

    content = await file.read()
    if not content:
        raise HTTPException(400, "empty upload")
    if len(content) > MAX_UPLOAD_BYTES[source_type]:
        raise HTTPException(
            413,
            f"file too large for source_type={source_type} "
            f"(>{MAX_UPLOAD_BYTES[source_type] // (1024 * 1024)}MB)",
        )

    if user_tag not in ("supporting", "contradicting", "neutral"):
        user_tag = "neutral"

    src = await _run_upload_analyzer(
        source_type=source_type,
        content=content,
        ticker=ticker,
        company_name=company_name,
        user_note=user_note,
        user_tag=user_tag,
        filename=file.filename,
        on_step=None,
    )
    _persist_user_evidence(session, user, src, ticker, company_name)
    return src


async def _run_upload_analyzer(
    *,
    source_type: str,
    content: bytes,
    ticker: str,
    company_name: str | None,
    user_note: str,
    user_tag: str,
    filename: str | None,
    on_step,
) -> UserSource:
    """Shared body of /evidence/upload and /evidence/upload/stream — runs
    compression + the right analyzer with an optional step callback."""

    def _emit(name: str, status: str, detail: dict | None = None) -> None:
        if on_step is not None:
            on_step(name, status, detail)

    if source_type == "image":
        _emit("compress", "running")
        compressed, ctype, stats = await asyncio.to_thread(compress_image, content)
        log.info(
            "compress image %s: %d→%d bytes (%.1f%%) in %.1fs [%s]",
            filename, stats["in_bytes"], stats["out_bytes"],
            100 * stats["ratio"], stats["elapsed_s"], stats["format"],
        )
        _emit("compress", "done", {
            "in_bytes": stats["in_bytes"],
            "out_bytes": stats["out_bytes"],
            "ratio": stats["ratio"],
        })
        return await asyncio.to_thread(
            analyze_user_image,
            ticker=ticker,
            company_name=company_name,
            image_bytes=compressed,
            content_type=ctype,
            user_note=user_note,
            user_tag=user_tag,  # type: ignore[arg-type]
            filename=filename,
            on_step=on_step,
        )
    if source_type == "video":
        _emit("compress", "running")
        compressed, ctype, stats = await asyncio.to_thread(compress_video, content)
        log.info(
            "compress video %s: %d→%d bytes (%.1f%%) in %.1fs [%s]",
            filename, stats["in_bytes"], stats["out_bytes"],
            100 * stats["ratio"], stats["elapsed_s"], stats["format"],
        )
        _emit("compress", "done", {
            "in_bytes": stats["in_bytes"],
            "out_bytes": stats["out_bytes"],
            "ratio": stats["ratio"],
        })
        return await asyncio.to_thread(
            analyze_user_video,
            ticker=ticker,
            company_name=company_name,
            video_bytes=compressed,
            content_type=ctype,
            user_note=user_note,
            user_tag=user_tag,  # type: ignore[arg-type]
            filename=filename,
            is_audio_only=False,
            on_step=on_step,
        )
    if source_type == "audio":
        _emit("compress", "running")
        compressed, ctype, stats = await asyncio.to_thread(compress_audio, content)
        log.info(
            "compress audio %s: %d→%d bytes (%.1f%%) in %.1fs [%s]",
            filename, stats["in_bytes"], stats["out_bytes"],
            100 * stats["ratio"], stats["elapsed_s"], stats["format"],
        )
        _emit("compress", "done", {
            "in_bytes": stats["in_bytes"],
            "out_bytes": stats["out_bytes"],
            "ratio": stats["ratio"],
        })
        return await asyncio.to_thread(
            analyze_user_video,
            ticker=ticker,
            company_name=company_name,
            video_bytes=compressed,
            content_type=ctype,
            user_note=user_note,
            user_tag=user_tag,  # type: ignore[arg-type]
            filename=filename,
            is_audio_only=True,
            on_step=on_step,
        )
    if source_type == "pdf":
        log.info("pdf %s: %d bytes (no compression)", filename, len(content))
        _emit("compress", "skipped")
        return await asyncio.to_thread(
            analyze_user_pdf,
            ticker=ticker,
            company_name=company_name,
            pdf_bytes=content,
            user_note=user_note,
            user_tag=user_tag,  # type: ignore[arg-type]
            filename=filename,
            on_step=on_step,
        )
    raise HTTPException(500, f"unhandled source_type {source_type}")


@app.post("/evidence/upload/stream")
async def evidence_upload_stream(
    ticker: str = Form(...),
    source_type: str = Form(...),
    user_note: str = Form(""),
    user_tag: str = Form("neutral"),
    company_name: str | None = Form(None),
    file: UploadFile = File(...),
    user: User = Depends(require_user),
    session: Session = Depends(get_session),
) -> StreamingResponse:
    """Same as /evidence/upload but streams stage events as SSE.

    Events:
        {"step": <name>, "status": "running" | "done" | "skipped" | "error",
         "detail": {...}}
        {"result": UserSource}
        {"error": str}
    """
    if source_type not in MAX_UPLOAD_BYTES:
        raise HTTPException(400, f"unsupported source_type {source_type}")
    content = await file.read()
    if not content:
        raise HTTPException(400, "empty upload")
    if len(content) > MAX_UPLOAD_BYTES[source_type]:
        raise HTTPException(
            413,
            f"file too large for source_type={source_type} "
            f"(>{MAX_UPLOAD_BYTES[source_type] // (1024 * 1024)}MB)",
        )
    if user_tag not in ("supporting", "contradicting", "neutral"):
        user_tag = "neutral"

    queue: asyncio.Queue[dict] = asyncio.Queue()
    loop = asyncio.get_event_loop()

    def on_step(name: str, status: str, detail: dict | None = None) -> None:
        # Step callbacks fire from a worker thread; schedule on the main loop.
        ev = {"step": name, "status": status}
        if detail:
            ev["detail"] = detail
        loop.call_soon_threadsafe(queue.put_nowait, ev)

    async def run_and_finish() -> None:
        try:
            src = await _run_upload_analyzer(
                source_type=source_type,
                content=content,
                ticker=ticker,
                company_name=company_name,
                user_note=user_note,
                user_tag=user_tag,
                filename=file.filename,
                on_step=on_step,
            )
            _persist_user_evidence(session, user, src, ticker, company_name)
            await queue.put({"result": src.model_dump()})
        except Exception as e:  # noqa: BLE001
            log.exception("evidence_upload_stream failed")
            await queue.put({"error": str(e)})
        finally:
            await queue.put({"_done": True})

    asyncio.create_task(run_and_finish())

    async def event_gen():
        while True:
            ev = await queue.get()
            if ev.get("_done"):
                return
            yield f"data: {_json.dumps(ev)}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "cache-control": "no-cache",
            "x-accel-buffering": "no",
            "connection": "keep-alive",
        },
    )


@app.post("/evidence", response_model=UserSource)
async def evidence(
    req: EvidenceRequest,
    user: User = Depends(require_user),
    session: Session = Depends(get_session),
) -> UserSource:
    """Ingest a user-provided URL or text and return an analyzed UserSource."""
    if req.source_type == "url":
        if not req.url:
            raise HTTPException(400, "url is required for source_type=url")
        try:
            extracted = await asyncio.to_thread(fetch_url, req.url)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(400, f"failed to fetch url: {e}")
    elif req.source_type == "text":
        if not req.text:
            raise HTTPException(400, "text is required for source_type=text")
        if len(req.text.strip()) < 30:
            raise HTTPException(
                400,
                "text is too short to analyze — paste at least a sentence or two (≥30 chars).",
            )
        extracted = passthrough_text(req.text)
    else:
        raise HTTPException(400, f"unsupported source_type {req.source_type}")

    if not extracted.text.strip():
        raise HTTPException(400, "no text could be extracted from the source")

    src = await asyncio.to_thread(
        analyze_user_text,
        ticker=req.ticker,
        company_name=req.company_name,
        text=extracted.text,
        title=extracted.title,
        origin=extracted.origin,
        user_note=req.user_note,
        user_tag=req.user_tag,
        source_type=req.source_type,
    )
    _persist_user_evidence(session, user, src, req.ticker, req.company_name)
    return src


def _persist_cached_report(session: Session, user: User, report: Report) -> None:
    """Replace the cached report for (user, ticker). Best-effort — never
    blocks the user-visible response on persistence."""
    try:
        existing = session.exec(
            select(CachedReport)
            .where(CachedReport.user_id == user.id)
            .where(CachedReport.ticker == report.ticker)
        ).first()
        payload = report.model_dump_json()
        now = datetime.now(timezone.utc)
        if existing is not None:
            existing.report_json = payload
            existing.generated_at = now
            session.add(existing)
        else:
            session.add(
                CachedReport(
                    user_id=user.id,
                    ticker=report.ticker,
                    report_json=payload,
                    generated_at=now,
                )
            )
        session.commit()
    except Exception:  # noqa: BLE001
        log.exception("failed to persist CachedReport (non-fatal)")
        session.rollback()


def _persist_user_evidence(
    session: Session,
    user: User,
    src: UserSource,
    ticker: str,
    company_name: str | None,
) -> None:
    try:
        session.add(
            UserEvidence(
                id=src.source_id,
                user_id=user.id,
                ticker=ticker.upper(),
                company_name=company_name,
                source_type=src.source_type,
                origin=src.origin,
                user_note=src.user_note,
                user_tag=src.user_tag,
                score=src.score,
                summary=src.summary,
                trust_level=src.trust_level,
            )
        )
        session.commit()
    except Exception:  # noqa: BLE001
        log.exception("failed to persist UserEvidence row (non-fatal)")
        session.rollback()


@app.post("/analyze", response_model=Report)
async def analyze(
    req: AnalyzeRequest,
    user: User = Depends(require_user),
    session: Session = Depends(get_session),
) -> Report:
    """Full pipeline: fundamentals + news + chart-vision + consumer_panel in
    parallel, then synthesized by Claude into a final verdict.
    """
    log.info("analyze: ticker=%s lat=%s lng=%s", req.ticker, req.lat, req.lng)
    ticker_upper = req.ticker.upper()
    valid, _name = await asyncio.to_thread(validate_ticker, ticker_upper)
    if not valid:
        raise HTTPException(
            404,
            f"Unknown ticker: {ticker_upper}. Try a real listed symbol (e.g. HEIA.AS, AAPL, NVDA).",
        )
    coords = (req.lat, req.lng) if req.lat is not None and req.lng is not None else None
    # Location label comes from the nearest HQ hit if coords are present.
    location_label = _nearest_label(coords) if coords else None
    report = await analyze_async(
        ticker_upper, coords=coords, location_label=location_label
    )
    try:
        session.add(
            AnalysisRun(
                user_id=user.id,
                ticker=report.ticker,
                company_name=report.company_name,
                verdict=report.verdict,
                confidence=report.confidence,
                position_size_pct=report.position_size_pct,
                one_liner=report.one_liner,
            )
        )
        session.commit()
    except Exception:  # noqa: BLE001
        log.exception("failed to persist AnalysisRun (non-fatal)")
        session.rollback()
    _persist_cached_report(session, user, report)
    return report


@app.get("/me/reports/{ticker}/latest")
def me_report_latest(
    ticker: str,
    user: User = Depends(require_user),
    session: Session = Depends(get_session),
) -> dict:
    """Most recent full Report for (user, ticker). 404 if never analyzed.
    The frontend uses this to skip the 25-second pipeline on navigate-back."""
    row = session.exec(
        select(CachedReport)
        .where(CachedReport.user_id == user.id)
        .where(CachedReport.ticker == ticker.upper())
    ).first()
    if row is None:
        raise HTTPException(404, f"no cached report for {ticker}")
    # SQLite via SQLModel may return a naive datetime — coerce both to UTC
    # before subtracting.
    generated = row.generated_at
    if generated.tzinfo is None:
        generated = generated.replace(tzinfo=timezone.utc)
    age_s = (datetime.now(timezone.utc) - generated).total_seconds()
    return {
        "ticker": row.ticker,
        "generated_at": generated.isoformat(),
        "age_s": age_s,
        "report": _json.loads(row.report_json),
    }


@app.delete("/me/reports/{ticker}")
def me_report_clear(
    ticker: str,
    user: User = Depends(require_user),
    session: Session = Depends(get_session),
) -> dict:
    """Drop the cached report for (user, ticker) so the next analyze runs fresh."""
    row = session.exec(
        select(CachedReport)
        .where(CachedReport.user_id == user.id)
        .where(CachedReport.ticker == ticker.upper())
    ).first()
    if row is not None:
        session.delete(row)
        session.commit()
    return {"ok": True}


def _nearest_label(coords: tuple[float, float] | None) -> str | None:
    if not coords:
        return None
    lat, lng = coords
    nearest = None
    best = float("inf")
    for row in _load_hq_registry():
        d = _haversine_m(lat, lng, row["lat"], row["lng"])
        if d < best:
            best = d
            nearest = row
    if nearest is None or best > 5000:
        return None
    return f"{nearest['name']}, {nearest.get('type', 'hq')} ({int(best)}m)"


@app.get("/nearby-tickers", response_model=list[NearbyTicker])
def nearby_tickers(
    lat: float,
    lng: float,
    radius_m: float = 5000,
    user: User = Depends(require_user),
) -> list[NearbyTicker]:
    results: list[NearbyTicker] = []
    for row in _load_hq_registry():
        d = _haversine_m(lat, lng, row["lat"], row["lng"])
        if d <= radius_m:
            results.append(
                NearbyTicker(
                    ticker=row["ticker"],
                    name=row["name"],
                    lat=row["lat"],
                    lng=row["lng"],
                    distance_m=d,
                    type=row.get("type", "hq"),
                )
            )
    results.sort(key=lambda r: r.distance_m)
    return results


@app.get("/panel/{ticker}", response_model=ConsumerPanelForecast)
def panel(
    ticker: str, user: User = Depends(require_user)
) -> ConsumerPanelForecast:
    try:
        return analyze_consumer_panel(ticker.upper())
    except KeyError:
        raise HTTPException(404, f"no panel data for ticker {ticker}")


_VALID_PERIODS = {"1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "max"}


@app.get("/chart-data/{ticker}")
async def chart_data(
    ticker: str,
    period: str = "1y",
    user: User = Depends(require_user),
) -> dict:
    """OHLCV bars + currency for the interactive price chart."""
    if period not in _VALID_PERIODS:
        raise HTTPException(
            400,
            f"unsupported period {period!r}; one of {sorted(_VALID_PERIODS)}",
        )
    bars, currency = await asyncio.to_thread(fetch_ohlcv, ticker.upper(), period)
    if not bars:
        raise HTTPException(404, f"no price data for {ticker}")
    return {
        "ticker": ticker.upper(),
        "period": period,
        "currency": currency,
        "bars": bars,
    }


@app.get("/panel-data/{ticker}")
async def panel_data(
    ticker: str,
    user: User = Depends(require_user),
) -> dict:
    """Monthly panel spend series for the interactive Bunq panel chart.

    Returns 24 months of {month, spend_eur, prior_year_spend_eur}.
    """
    import json
    from pathlib import Path

    fixture = (
        Path(__file__).parent / "fixtures" / "panel_spend.json"
    )
    if not fixture.exists():
        raise HTTPException(404, "panel fixture missing")
    data = json.loads(fixture.read_text())
    entry = data.get(ticker.upper())
    if not entry:
        raise HTTPException(404, f"no panel data for {ticker}")
    months = entry["months"]
    sorted_keys = sorted(months.keys())
    series: list[dict] = []
    for k in sorted_keys:
        prior_k = f"{int(k[:4]) - 1}-{k[5:]}"
        series.append(
            {
                "month": k,
                "spend_eur": months[k],
                "prior_year_eur": months.get(prior_k),
            }
        )
    return {
        "ticker": ticker.upper(),
        "panel_size_n": entry["panel_size_n"],
        "series": series,
    }


@app.get("/validate-ticker/{ticker}")
async def validate_ticker_route(ticker: str) -> dict:
    """Cheap existence check used by the frontend before kicking off a full
    /analyze. Returns {ok: bool, name: str | None}.
    """
    valid, name = await asyncio.to_thread(validate_ticker, ticker.upper())
    return {"ok": valid, "name": name, "ticker": ticker.upper()}


FX_EUR_USD = 1.08  # stub rate — we don't need a live FX feed for a paper-trade demo


@app.get("/balance")
def balance(user: User = Depends(require_user)) -> dict:
    """Live Bunq sandbox balances (main + pot). Powers the Invest modal."""
    try:
        return bunq_i.get_balance()
    except Exception as e:  # noqa: BLE001
        log.exception("bunq balance failed")
        raise HTTPException(503, f"bunq unavailable: {e}")


@app.post("/invest", response_model=InvestReceipt)
def invest(
    req: InvestRequest,
    user: User = Depends(require_user),
    session: Session = Depends(get_session),
) -> InvestReceipt:
    """1) Top-up Bunq Main from sugardaddy if needed.
       2) Transfer EUR Main → Prospectus Investments pot.
       3) Submit an Alpaca paper market-buy at the mapped US-ADR symbol.
    """
    if req.amount_eur <= 0:
        raise HTTPException(400, "amount must be > 0")
    if req.amount_eur > 10_000:
        raise HTTPException(400, "amount capped at €10,000 in sandbox")

    # 1+2: ensure funds, then transfer Main -> Pot
    try:
        bal = bunq_i.get_balance()
        if bal["main"] < req.amount_eur:
            needed = req.amount_eur - bal["main"]
            bunq_i.fund_main_from_sugardaddy(
                max(needed, 50.0),
                description=f"prospectus top-up for {req.ticker}",
            )
        bunq_payment_id = bunq_i.transfer_main_to_pot(
            req.amount_eur,
            description=f"prospectus: {req.ticker} position",
        )
    except Exception as e:  # noqa: BLE001
        log.exception("bunq transfer failed")
        raise HTTPException(503, f"bunq transfer failed: {e}")

    # 3: Alpaca paper trade (best-effort — we don't fail the whole flow if it hiccups)
    amount_usd = req.amount_eur * FX_EUR_USD
    alpaca_symbol = alpaca_i.map_to_alpaca_symbol(req.ticker)
    alpaca_order_id: str | None = None
    shares = 0.0
    try:
        order = alpaca_i.submit_market_buy(alpaca_symbol, amount_usd)
        alpaca_order_id = order.id
        shares = order.qty
    except Exception as e:  # noqa: BLE001
        log.warning("alpaca buy failed (non-fatal): %s", e)

    receipt = InvestReceipt(
        bunq_payment_id=bunq_payment_id,
        alpaca_order_id=alpaca_order_id,
        ticker=req.ticker.upper(),
        amount_eur=req.amount_eur,
        amount_usd=round(amount_usd, 2),
        shares=shares,
        timestamp=datetime.now(timezone.utc).isoformat(),
        verdict_snapshot={
            "alpaca_symbol": alpaca_symbol,
            "fx_rate": FX_EUR_USD,
            "note": "sandbox Bunq + Alpaca paper",
        },
    )
    # Persist for the user's dashboard
    try:
        session.add(
            Investment(
                user_id=user.id,
                ticker=req.ticker.upper(),
                amount_eur=req.amount_eur,
                amount_usd=round(amount_usd, 2),
                fx_rate=FX_EUR_USD,
                bunq_payment_id=bunq_payment_id,
                alpaca_order_id=alpaca_order_id,
                alpaca_symbol=alpaca_symbol,
                shares_estimated=shares,
            )
        )
        session.commit()
    except Exception:  # noqa: BLE001
        log.exception("failed to persist Investment row (non-fatal)")
        session.rollback()
    return receipt
