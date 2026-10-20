"""Optional local OCR. Source pixels never become verified facts automatically."""
from hashlib import sha256
from io import BytesIO
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
from itertools import islice

from PIL import Image, UnidentifiedImageError


class OCRUnavailable(RuntimeError):
    pass


def image_text(content: bytes) -> str:
    executable = shutil.which("tesseract")
    if not executable:
        raise OCRUnavailable("OCR недоступен: Tesseract не установлен; используйте ручной ввод")
    if len(content) > 20 * 1024 * 1024:
        raise ValueError("Image exceeds 20 MB")
    try:
        with Image.open(BytesIO(content)) as image:
            if image.format not in ("JPEG", "PNG", "WEBP") or image.width * image.height > 25_000_000:
                raise ValueError("Image must be JPG/PNG/WebP, at most 25 megapixels")
            # load() forces a full decode, catching the truncated/corrupt files
            # verify() used to catch. verify() invalidates the image object, which
            # is why this used to open the same bytes a second time.
            image.load()
            with tempfile.TemporaryDirectory(prefix="saq-ocr-") as directory:
                path = Path(directory) / "original.png"
                image.convert("RGB").save(path, format="PNG")
                flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
                result = subprocess.run([executable, str(path), "stdout", "-l", "rus+eng"], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30, check=True, shell=False, creationflags=flags)
                return result.stdout[:100_000]
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("Image is invalid or unsupported") from exc


def extract_image(content: bytes) -> dict:
    return {"status": "candidate", "sha256": sha256(content).hexdigest(), "bytes": len(content), "text": image_text(content), "source": "tesseract/rus+eng", "limitations": ["OCR может ошибаться: сверяйте цитаты с исходным изображением", "Извлечённый текст не подтверждает факт автоматически"]}


def extract_scanned_pdf(content: bytes) -> dict:
    from pypdf import PdfReader
    if not shutil.which("tesseract"):
        raise OCRUnavailable("OCR_UNAVAILABLE")
    reader = PdfReader(BytesIO(content))
    if reader.is_encrypted or len(reader.pages) > 20:
        raise ValueError("OCR PDF must be unencrypted and contain at most 20 pages")
    started = time.monotonic()
    pages = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        for image in islice(page.images, 5):
            if time.monotonic() - started > 60:
                raise TimeoutError("PDF OCR time limit exceeded")
            text += "\n" + image_text(image.data)
        pages.append({"page": i + 1, "text": text[:100_000]})
    return {"status": "candidate", "sha256": sha256(content).hexdigest(), "bytes": len(content), "pages": pages, "source": "tesseract/rus+eng", "limitations": ["OCR встроенных растровых изображений; сложные PDF требуют ручной проверки", "Текст и цитаты требуют сверки по оригиналу"]}
