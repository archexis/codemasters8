"""Small bounded document worker. Results are untrusted extraction candidates."""
import asyncio
import threading
from hashlib import sha256
from io import BytesIO

import httpx
from pypdf import PdfReader

CONCURRENCY = 2
_slots = asyncio.Semaphore(CONCURRENCY)
_tasks: set[asyncio.Task] = set()
_active_job_ids: set[str] = set()
MAX_PENDING_JOBS = 32
# _tasks/_active_job_ids are only mutated in the event-loop thread, but
# launch_job/queue_has_capacity may be called from other threads (tests, a
# threaded server wrapper), so the synchronous sections below take this lock.
# NOTE: single-process scope — every uvicorn worker keeps its own sets, so
# MAX_PENDING_JOBS is a per-process bound, not a global one.
# TODO: move capacity/ownership state to a shared backend (Redis/DB) if the
# API ever scales beyond a single worker process.
_state_lock = threading.Lock()


def queue_has_capacity() -> bool:
    with _state_lock:
        return len(_tasks) < MAX_PENDING_JOBS


def extract_pdf(content: bytes) -> dict:
    if not content.startswith(b"%PDF-"):
        raise ValueError("Invalid PDF")
    reader = PdfReader(BytesIO(content))
    if reader.is_encrypted or len(reader.pages) > 100:
        raise ValueError("PDF must be unencrypted and contain at most 100 pages")
    pages = []
    remaining = 2_000_000
    for i, page in enumerate(reader.pages):
        text = (page.extract_text() or "")[:min(100_000, remaining)]
        remaining -= len(text)
        pages.append({"page": i + 1, "text": text})
    return {"status": "candidate", "sha256": sha256(content).hexdigest(), "bytes": len(content), "pages": pages,
            "limitations": ["Извлечение требует проверки по оригиналу", "OCR недоступен: сканы без текстового слоя требуют ручной обработки"]}


async def bounded_extract(content: bytes) -> dict:
    async with _slots:
        return await asyncio.to_thread(extract_pdf, content)


async def run_job(url: str, headers: dict, job: dict, content: bytes):
    # JWT lives only for this request/worker, never in job rows or logs.
    endpoint = f"{url.rstrip('/')}/rest/v1/document_jobs"
    params = {"id": f"eq.{job['id']}", "owner_id": f"eq.{job['owner_id']}"}
    async with _slots:
        async with httpx.AsyncClient(timeout=30) as client:
            try:
                started = await client.patch(endpoint, params=params, headers=headers, json={"status": "running", "error": None})
                started.raise_for_status()
                if job["kind"] == "ocr":
                    from backend.app.ocr import extract_scanned_pdf
                    result = await asyncio.to_thread(extract_scanned_pdf, content)
                else:
                    result = await asyncio.to_thread(extract_pdf, content)
                finished = await client.patch(endpoint, params=params, headers=headers, json={"status": "succeeded", "result": result})
                finished.raise_for_status()
            except Exception as exc:
                # Never persist token, exception URLs, or source contents in error text.
                from backend.app.ocr import OCRUnavailable
                error = "OCR_UNAVAILABLE" if isinstance(exc, OCRUnavailable) else "OCR_PARSE_FAILED" if job["kind"] == "ocr" else "PDF_PARSE_FAILED: файл повреждён, зашифрован или обработка недоступна"
                try:
                    await client.patch(endpoint, params=params, headers=headers, json={"status": "failed", "error": error})
                except httpx.HTTPError:
                    # Persisted queued/running record and original remain retryable
                    # through an authenticated request when the API recovers.
                    pass


def launch_job(url: str, headers: dict, job: dict, content: bytes):
    with _state_lock:
        if job['id'] in _active_job_ids:
            return False
        _active_job_ids.add(job['id'])
        task = asyncio.create_task(run_job(url, headers, job, content))
        _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    task.add_done_callback(lambda _: _active_job_ids.discard(job['id']))
    return True
