"""Authenticated reporting API. Supabase validates JWTs; PostgREST enforces RLS."""
from functools import lru_cache
from typing import Annotated

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    supabase_url: str = ""
    supabase_anon_key: str = ""
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()


WEIGHTS = {"R1": 35, "R2": 25, "R3": 10, "R4": 15, "R5": 10, "R6": 5}


def score_for(confirmed: set[str]) -> int:
    """Deterministic score: sum of confirmed weights, capped at 100. Mirrors src/lib/scoring.ts."""
    return min(100, sum(WEIGHTS.get(code, 0) for code in set(confirmed)))


def zone_for(score: int, confirmed: set[str]) -> str:
    """Red = score>=60 AND R1+R2 both confirmed; else score>=25 -> yellow; else green."""
    has = set(confirmed)
    return "red" if score >= 60 and {"R1", "R2"} <= has else "yellow" if score >= 25 else "green"


app = FastAPI(title="SAQ QURYLYS API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins.split(","),
    allow_methods=["GET"],
    allow_headers=["Authorization"],
)


async def fetch_workspace(
    authorization: Annotated[str | None, Header()] = None,
    settings: Settings = Depends(get_settings),
) -> dict:
    if not authorization or not authorization.startswith("Bearer ") or not authorization[7:].strip():
        raise HTTPException(401, "Bearer token required")
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise HTTPException(503, "Supabase is not configured")
    headers = {"Authorization": authorization, "apikey": settings.supabase_anon_key}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            user = await client.get(f"{settings.supabase_url.rstrip('/')}/auth/v1/user", headers=headers)
            if user.status_code in (400, 401, 403):
                raise HTTPException(401, "Invalid or expired token")
            if not user.is_success:
                raise HTTPException(502, "Auth service unavailable")
            uid = user.json()["id"]
            response = await client.get(
                f"{settings.supabase_url.rstrip('/')}/rest/v1/workspaces",
                params={"owner_id": f"eq.{uid}", "select": "data,version"}, headers=headers,
            )
            if not response.is_success:
                raise HTTPException(502, "Workspace service unavailable")
            rows = response.json()
            if not rows:
                raise HTTPException(404, "Workspace not initialized")
            return rows[0]
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        raise HTTPException(502, "Supabase service unavailable") from exc


@app.get("/health")
async def health(settings: Settings = Depends(get_settings)) -> dict:
    return {"status": "ok", "supabase_configured": bool(settings.supabase_url and settings.supabase_anon_key)}


@app.get("/api/summary")
async def summary(workspace: dict = Depends(fetch_workspace)) -> dict:
    zones = {"red": 0, "yellow": 0, "green": 0}
    for building in workspace["data"]["complexes"]:
        confirmed = {f["code"] for f in building["factors"] if f["status"] == "confirmed"}
        zones[zone_for(score_for(confirmed), confirmed)] += 1
    return {"version": workspace["version"], "complexes": len(workspace["data"]["complexes"]), "ads": len(workspace["data"]["ads"]), "zones": zones}


@app.get("/api/export")
async def export(workspace: dict = Depends(fetch_workspace)) -> JSONResponse:
    # S2.5 (C3). Обычный /api/export — это экспорт ДАННЫХ, а не полный backup:
    # без байтов media и manifest он для restore непригоден. Метки ниже делают
    # это различие явным для клиентов и отчётов; поведение и тело неизменны.
    # S4.4. X-Export-Template фиксирует версию шаблона: workspace-data/v1 —
    # сырой экспорт данных; сигнальные карточки (signal-card/v1,
    # src/lib/export.ts) скачиваются клиентской кнопкой экспорта отдельно.
    return JSONResponse(
        workspace,
        headers={
            "Content-Disposition": 'attachment; filename="saq-workspace-data-export.json"',
            "Cache-Control": "no-store",
            "X-Export-Kind": "data-only",
            "X-Export-Template": "workspace-data/v1",
            "X-Export-Note": "Data export only, not a full backup: no media bytes or manifest. Use the backup ZIP (manifest.json + workspace.json + files/) for restore.",
        },
    )
