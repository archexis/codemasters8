"""Prepare web assets from images/manifest.csv (requires Pillow). Originals stay intact."""
import csv
import json
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parents[1]
source = root / "images"
output = root / "public" / "demo-construction"
frames = []
original_bytes = 0
web_bytes = 0

with (source / "manifest.csv").open(encoding="utf-8-sig", newline="") as stream:
    for row in csv.DictReader(stream):
        relative = Path(row["file"])
        original = (source / relative).resolve()
        if not original.is_relative_to(source.resolve()):
            raise ValueError(f"Invalid source path: {relative}")
        image_path = output / relative.with_suffix(".webp")
        thumb_path = image_path.with_name(image_path.stem + "_thumb.webp")
        image_path.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(original) as image:
            image = image.convert("RGB")
            image.save(image_path, "WEBP", quality=84, method=6)
            image.thumbnail((400, 300), Image.Resampling.LANCZOS)
            image.save(thumb_path, "WEBP", quality=78, method=6)
        original_bytes += original.stat().st_size
        web_bytes += image_path.stat().st_size + thumb_path.stat().st_size
        frames.append({
            "complexId": row["project_id"],
            "complexName": row["complex_name"],
            "date": row["date"],
            "image": image_path.relative_to(root / "public").as_posix(),
            "thumbnail": thumb_path.relative_to(root / "public").as_posix(),
        })

(root / "src/lib/construction-images.json").write_text(
    json.dumps(frames, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
print(f"{len(frames)} frames: {original_bytes / 1048576:.1f} MiB PNG -> {web_bytes / 1048576:.1f} MiB WebP incl. thumbnails")
