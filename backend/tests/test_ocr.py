from io import BytesIO
from types import SimpleNamespace

import pytest
from PIL import Image
from fastapi.testclient import TestClient

from backend.app.main import app, fetch_workspace
from backend.app.ocr import extract_image, OCRUnavailable


def image_bytes():
    output = BytesIO()
    Image.new('RGB', (20, 20), 'white').save(output, format='PNG')
    return output.getvalue()


def test_optional_ocr_adapter_runs_without_shell_and_returns_only_candidate(monkeypatch):
    monkeypatch.setattr('backend.app.ocr.shutil.which', lambda _: 'tesseract.exe')
    calls = []
    def run(args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(stdout='Бронирование квартиры')
    monkeypatch.setattr('backend.app.ocr.subprocess.run', run)
    result = extract_image(image_bytes())
    assert result['text'] == 'Бронирование квартиры' and result['status'] == 'candidate'
    assert len(result['sha256']) == 64
    assert calls[0][1]['shell'] is False and calls[0][1]['timeout'] == 30
    assert calls[0][0][-1] == 'rus+eng'
    with pytest.raises(ValueError):
        extract_image(b'not an image')


def test_ocr_unavailable_is_explicit_authenticated_degradation(monkeypatch):
    monkeypatch.setattr('backend.app.ocr.shutil.which', lambda _: None)
    with pytest.raises(OCRUnavailable):
        extract_image(image_bytes())
    client = TestClient(app)
    assert client.post('/api/import/image', content=image_bytes(), headers={'content-type': 'image/png'}).status_code == 401
    app.dependency_overrides[fetch_workspace] = lambda: {'version': 1, 'data': {}}
    try:
        assert client.post('/api/import/image', content=image_bytes(), headers={'content-type': 'image/png'}).status_code == 503
    finally:
        app.dependency_overrides.clear()
