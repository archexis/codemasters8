"""Snapshot-only PDF rendering: no network fetches and no AI-generated fields."""
from io import BytesIO
from pathlib import Path
import os
from xml.sax.saxutils import escape

from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.enums import TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer


def render_signal(snapshot: dict) -> bytes:
    candidates = [os.getenv("PDF_FONT_PATH", ""), "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "C:/Windows/Fonts/arial.ttf"]
    font = next((p for p in candidates if p and Path(p).is_file()), None)
    if font is None:
        raise RuntimeError("Cyrillic PDF font unavailable; configure PDF_FONT_PATH")
    if "SaqUnicode" not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont("SaqUnicode", font))
    styles = getSampleStyleSheet()
    for style in styles.byName.values():
        style.fontName = "SaqUnicode"
        style.wordWrap = "CJK"
        style.alignment = TA_LEFT
    body = []

    def line(text: object, style="Normal"):
        body.append(Paragraph(escape(str(text)).replace("\n", "<br/>"), styles[style]))
        body.append(Spacer(1, 7))

    if snapshot.get("demo"):
        line("DEMO — синтетические демонстрационные данные", "Heading1")
    if snapshot.get("imported"):
        line("Импортированная история; не новое подтверждение", "Heading1")
    line("SAQ QURYLYS — карточка сигнала", "Title")
    line("Сигнал является основанием для ручной проверки. Балл риска и приведённые признаки не устанавливают нарушение закона и не заменяют решение уполномоченного органа.")
    for key in ("id", "caseId", "revision", "status", "actor", "at", "comment", "score", "zone", "weightsVersion"):
        line(f"{key}: {snapshot.get(key, '')}")
    if snapshot.get('period'):
        line(f"Период применимости: {snapshot['period']['from']} — {snapshot['period'].get('to', 'открыт')}")
    complex_ = snapshot["complex"]
    for key in ("id", "name", "address", "developer", "bin", "stage"):
        line(f"{key}: {complex_.get(key, '')}")
    line(f"Очередь: {snapshot.get('phase', {}).get('name', 'Весь объект')}")
    basis = complex_.get("legalBasis", {})
    line("Применимое основание", "Heading2")
    for key in ("type", "status", "source", "checkedAt", "reviewText"):
        line(f"{key}: {basis.get(key, '')}")
    if basis.get('period'):
        line(f"Период правового основания: {basis['period']['from']} — {basis['period'].get('to', 'открыт')}")
    line("Проверенные утверждения", "Heading2")
    for a in snapshot.get("assertions", []):
        line(f"{a['code']} — {a['status']}; {a.get('actor', '')}; {a.get('at', '')}")
        ev = a.get("evidence", {})
        for key in ("source", "date", "quote", "text", "adId", "mediaIds", "runId", "hypothesisId"):
            if ev.get(key):
                line(f"{key}: {ev[key]}")
    line("Материалы и приложения", "Heading2")
    for a in snapshot.get("artifacts", []):
        for key in ("id", "kind", "origin", "availability", "source", "date", "capturedAt", "pageNumber", "sha256", "bytes", "url", "mediaId", "text"):
            if a.get(key):
                line(f"{key}: {a[key]}")
    for a in snapshot.get("ads", []):
        line(f"Публикация: {a['id']}; {a.get('platform', '')}; {a.get('account', '')}; {a.get('date', '')}")
        line(a.get("url", ""))
        line(a.get("text", ""))
    for media in snapshot.get("mediaManifest", []):
        line(f"Приложение: {media['id']}; {media.get('name', '')}; SHA256: {media.get('sha256', '')}; bytes: {media.get('bytes', '')}")
    for relation in snapshot.get('relations', []):
        line(f"Связь: {relation['fromId']} → {relation['toId']}; {relation['relationType']}; {relation['verificationStatus']}; материалы: {', '.join(relation['sourceArtifactIds'])}")
    line("Ограничения", "Heading2")
    for limitation in snapshot.get("limitations", []):
        line(limitation)
    result = BytesIO()
    doc = SimpleDocTemplate(result, title=f"SAQ signal {snapshot['id']}", author="SAQ QURYLYS", invariant=1)
    doc.build(body)
    return result.getvalue()
