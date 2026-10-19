"""Snapshot-only PDF rendering: no network fetches and no AI-generated fields."""
from io import BytesIO
from pathlib import Path
import os
from xml.sax.saxutils import escape

from .projections import WEIGHTS

from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.enums import TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer


LABELS = {
    'id': 'Идентификатор', 'caseId': 'Дело', 'revision': 'Версия', 'status': 'Статус',
    'actor': 'Автор решения', 'at': 'Время решения (UTC)', 'comment': 'Обоснование',
    'score': 'Балл риска', 'zone': 'Зона риска', 'weightsVersion': 'Версия весов',
    'name': 'Название', 'address': 'Адрес', 'developer': 'Застройщик', 'bin': 'БИН',
    'stage': 'Стадия', 'type': 'Тип основания', 'source': 'Источник', 'checkedAt': 'Дата сверки',
    'reviewText': 'Результат сверки', 'date': 'Дата события', 'quote': 'Дословная цитата',
    'text': 'Содержание', 'adId': 'Публикация', 'mediaIds': 'Файлы', 'runId': 'AI run',
    'hypothesisId': 'Гипотеза', 'kind': 'Тип материала', 'origin': 'Происхождение',
    'availability': 'Доступность', 'capturedAt': 'Время фиксации (UTC)',
    'pageNumber': 'Страница', 'sha256': 'SHA256', 'bytes': 'Размер (байт)',
    'url': 'Ссылка', 'mediaId': 'Файл',
}
VALUES = {
    'confirmed': 'Подтверждён', 'returned': 'Возвращён на проверку', 'draft': 'В работе',
    'verified': 'Проверено', 'candidate': 'Требует проверки', 'rejected': 'Отклонено',
    'unknown': 'Не установлено', 'absent-verified': 'Отсутствие проверено',
    'absent': 'Отсутствие оснований', 'guarantee': 'Гарантия Единого оператора',
    'mio-permit': 'Разрешение МИО', 'green': 'Зелёная', 'yellow': 'Жёлтая', 'red': 'Красная',
    'manual': 'Ручной ввод', 'import': 'Импорт', 'demo': 'DEMO', 'official': 'Официальный источник',
    'ok': 'Копия сохранена', 'unavailable': 'Источник недоступен', 'needs_auth': 'Нужен вход',
    'developer_of': 'Застройщик', 'authorized_company_of': 'Уполномоченная компания',
    'contractor_of': 'Подрядчик', 'advertises': 'Рекламирует', 'covered_by': 'Основание',
    'mentions': 'Упоминание', 'same_ad_account': 'Общий рекламный аккаунт', 'located_on': 'Расположение',
    'publication': 'Публикация', 'document': 'Документ', 'legal-review': 'Правовая сверка',
    'observation': 'Наблюдение', 'event': 'Событие', 'relationship': 'Материал о связи',
}


def display_value(key: str, value: object) -> str:
    if value is None or value == '':
        return 'Не установлено'
    if key in ('status', 'type', 'zone', 'origin', 'availability', 'kind', 'relationType'):
        return VALUES.get(str(value), str(value))
    return str(value)


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
        style.wordWrap = None
        style.splitLongWords = True
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
        line(f"{LABELS[key]}: {display_value(key, snapshot.get(key))}")
    if snapshot.get('period'):
        line(f"Период применимости: {snapshot['period']['from']} — {snapshot['period'].get('to', 'открыт')}")
    complex_ = snapshot["complex"]
    for key in ("id", "name", "address", "developer", "bin", "stage"):
        line(f"{LABELS[key]}: {display_value(key, complex_.get(key))}")
    line(f"Очередь: {(snapshot.get('phase') or {}).get('name', 'Весь объект')}")
    basis = complex_.get("legalBasis", {})
    line("Применимое основание", "Heading2")
    for key in ("type", "status", "source", "checkedAt", "reviewText"):
        line(f"{LABELS[key]}: {display_value(key, basis.get(key))}")
    if basis.get('period'):
        line(f"Период правового основания: {basis['period']['from']} — {basis['period'].get('to', 'открыт')}")
    line("Результаты проверки утверждений", "Heading2")
    scored_codes = set()
    for a in snapshot.get("assertions", []):
        weight = WEIGHTS.get(a['code'], 0) if a['status'] == 'verified' and a['code'] not in scored_codes else 0
        if a['status'] == 'verified':
            scored_codes.add(a['code'])
        line(f"{a['code']} +{weight} — {display_value('status', a['status'])}; {a.get('actor', '')}; {a.get('at', '')}")
        if a.get('comment'):
            line(f"Обоснование проверки: {a['comment']}")
        ev = a.get("evidence", {})
        if ev.get('beforeCommissioning'):
            material = ev['beforeCommissioning']
            line(f"Материал о невводе: {material.get('source', 'Не установлено')} · {material.get('date', 'Дата неизвестна')}")
            line(material.get('text', ''))
        for key in ("source", "date", "quote", "text", "adId", "mediaIds", "runId", "hypothesisId"):
            if ev.get(key):
                line(f"{LABELS[key]}: {display_value(key, ev[key])}")
    line("Материалы и приложения", "Heading2")
    for a in snapshot.get("artifacts", []):
        for key in ("id", "kind", "origin", "availability", "source", "date", "capturedAt", "pageNumber", "sha256", "bytes", "url", "mediaId", "text"):
            if a.get(key):
                line(f"{LABELS[key]}: {display_value(key, a[key])}")
    for a in snapshot.get("ads", []):
        line(f"Публикация: {a['id']}; {a.get('platform', '')}; {a.get('account', '')}; {a.get('date', '')}")
        line(a.get("url", ""))
        line(a.get("text", ""))
    for media in snapshot.get("mediaManifest", []):
        line(f"Приложение: {media['id']}; {media.get('name', '')}; SHA256: {media.get('sha256', '')}; размер (байт): {media.get('bytes', '')}")
    for relation in snapshot.get('relations', []):
        line(f"Связь: {relation['fromId']} → {relation['toId']}; {display_value('relationType', relation['relationType'])}; {display_value('status', relation['verificationStatus'])}; материалы: {', '.join(relation['sourceArtifactIds'])}")
    line("Ограничения", "Heading2")
    for limitation in snapshot.get("limitations", []):
        line(limitation)
    result = BytesIO()
    doc = SimpleDocTemplate(result, title=f"SAQ signal {snapshot['id']}", author="SAQ QURYLYS", invariant=1)
    doc.build(body)
    return result.getvalue()
