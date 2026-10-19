"""Bounded owner-scoped read models. Never include file bytes in summaries."""
from copy import deepcopy

WEIGHTS = {"R1": 35, "R2": 25, "R3": 10, "R4": 15, "R5": 10, "R6": 5}


def latest_assertions(data: dict, case_id: str) -> list:
    latest = {}
    for assertion in data.get("assertions", []):
        if assertion["caseId"] == case_id:
            latest[assertion["claimId"]] = assertion
    return list(latest.values())


def complex_factors(data: dict, complex_: dict, phase_id: str | None = None) -> list:
    cases = [c for c in data.get("cases", []) if c["complexId"] == complex_["id"] and c.get("phaseId") == phase_id]
    if cases:
        case = max(cases, key=lambda c: c["updatedAt"])
        return [{"code": a["code"], "status": "confirmed" if a["status"] == "verified" else "needs-verification" if a["status"] == "candidate" else "rejected"}
                for a in latest_assertions(data, case["id"])]
    return [] if phase_id else complex_.get("factors", [])


def risk(factors: list) -> dict:
    confirmed = {f["code"] for f in factors if f["status"] == "confirmed"}
    score = min(100, sum(WEIGHTS.get(c, 0) for c in confirmed))
    return {"score": score, "zone": "red" if score >= 60 and {"R1", "R2"} <= confirmed else "yellow" if score >= 25 else "green"}


def preview(data: dict, complex_: dict) -> dict:
    return {**{k: complex_.get(k) for k in ("id", "name", "city", "address", "developer", "lat", "lng", "stage", "demo", "origin", "readinessClaimed", "readinessConfirmed")},
            "legalBasisStatus": complex_.get("legalBasis", {}).get("status", "unknown"),
            **risk(complex_factors(data, complex_))}


def page(items: list, cursor: str | None, limit: int, query: str = "") -> dict:
    rows = sorted(items, key=lambda row: str(row["id"]))
    if query:
        query = query.casefold()
        rows = [r for r in rows if query in " ".join(str(r.get(k, "")) for k in ("name", "text", "address", "developer", "bin", "source", "title")).casefold()]
    if cursor:
        rows = [r for r in rows if str(r["id"]) > cursor]
    visible = rows[:limit]
    return {"items": visible, "nextCursor": str(visible[-1]["id"]) if len(rows) > limit else None}


def case_model(data: dict, case_id: str) -> dict | None:
    case = next((c for c in data.get("cases", []) if c["id"] == case_id), None)
    if case is None:
        return None
    complex_ = next((z for z in data["complexes"] if z["id"] == case["complexId"]), None)
    scoped = scope_model(data, case['complexId'], case.get('phaseId'))
    return {"investigation": deepcopy(case), "complex": scoped['complex'] if scoped else None,
            "assertions": latest_assertions(data, case_id),
            "artifacts": [a for a in data.get("artifacts", []) if a["id"] in case["artifactIds"]],
            "snapshots": [{k: s.get(k) for k in ("id", "revision", "status", "at", "actor", "score", "zone")} for s in data.get("caseSnapshots", []) if s["caseId"] == case_id]}


def scope_model(data: dict, complex_id: str, phase_id: str | None = None) -> dict | None:
    z = next((z for z in data["complexes"] if z["id"] == complex_id), None)
    if z is None:
        return None
    phase = next((p for p in data.get("phases", []) if p["id"] == phase_id and p["complexId"] == complex_id), None)
    if phase_id and phase is None:
        return None
    cases = sorted([c for c in data.get("cases", []) if c["complexId"] == complex_id and c.get("phaseId") == phase_id], key=lambda c: c["updatedAt"], reverse=True)
    z = deepcopy(z)
    if phase:
        z['legalBasis'] = phase.get('legalBasis', {'status': 'unknown'})
        for field in ('readinessClaimed', 'readinessConfirmed', 'readinessClaimedSource'):
            z[field] = phase.get(field)
        z['readinessSources'] = phase.get('readinessSources', [])
    return {"complex": {**preview(data, z), **risk(complex_factors(data, z, phase_id))}, "phase": phase,
            "phases": [p for p in data.get("phases", []) if p["complexId"] == complex_id],
            "cases": cases[:100], "caseCount": len(cases), "activeCaseId": next((c["id"] for c in cases if c["status"] == "draft"), None)}


def timeline_items(data: dict, complex_id: str, phase_id: str | None) -> list:
    items = []
    z = next(z for z in data["complexes"] if z["id"] == complex_id)
    if phase_id is None:
        for i, event in enumerate(z.get("events", [])):
            items.append({"id": f"event-{i}", "date": event.get("date"), "kind": "event", "text": event.get("text"), "origin": z.get("origin")})
    for a in data.get("artifacts", []):
        if a["complexId"] == complex_id and a.get("phaseId") == phase_id:
            items.append({"id": f"artifact-{a['id']}", "artifactId": a["id"], "date": a.get("date"), "capturedAt": a.get("capturedAt"), "kind": a["kind"], "text": a.get("source"), "origin": a.get("origin", "manual")})
    for s in data.get("caseSnapshots", []):
        if s["complexId"] == complex_id and s.get("phaseId") == phase_id:
            items.append({"id": f"decision-{s['id']}", "caseId": s["caseId"], "date": s["at"][:10], "at": s["at"], "kind": "decision", "text": s.get("comment"), "status": s["status"], "score": s["score"], "zone": s["zone"]})
    return items
