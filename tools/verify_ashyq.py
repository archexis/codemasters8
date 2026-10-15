#!/usr/bin/env python3
"""SAQ QURYLYS — verify the curated Ashyq snapshot against the live open dataset.

Downloads the full CSV ("Объекты с долевым участием в жилищном строительстве",
dataset magda-ds-b80110e9-218a-42ba-b8c8-01fa5e4c82c8) and checks that every
curated public-snapshot row in js/data.js still exists with the same permit
number, object name and dates.

Run:  python3 tools/verify_ashyq.py

Exit 0 = all rows match. Exit 1 = drift or download failure (details printed).

NOTE: the MinIO host currently serves a certificate whose subject does not
match its hostname, so this script fetches with an unverified TLS context.
The file is public open data (CC BY 3.0 NZ); the CSV content itself is
validated row-by-row below, not trusted blindly.
"""

import csv
import ssl
import sys
import urllib.parse
import urllib.request

DATASET_PAGE = (
    "https://ashyq.data.gov.kz/dataset/"
    "magda-ds-b80110e9-218a-42ba-b8c8-01fa5e4c82c8"
)
CSV_URL = (
    "https://magda-minio-web.data.gov.kz/magda-datasets/"
    "miir_kazreestr_du_objects/"
    + urllib.parse.quote("Объекты с долевым участием в жилищном строительстве.csv")
)

# id -> (name fragment, permit number, date_start, date_end) as stored in js/data.js
EXPECTED = {
    "3741": ("Жаным", "ДПГ-23-16-068/155", "2023-07-24", "2025-03-21"),
    "4989": ("Золотой квадрат, Пятно 1", "ДПГ-25-16-078/194", "2025-06-01", "2026-07-31"),
    "6176": ("ASYLYM", "ДПГ-25-16-082/200", "2025-08-15", "2026-05-15"),
    "6078": ("Orda", "1383/МҚЗТ-С-331", "2024-10-17", "2027-02-28"),
    "6516": ("Tumar Towers Oskemen, Здание 1", "KZ26VWE00002487", "2025-02-04", "2026-07-04"),
    "5495": ("AINALAIYN", "KZ40VWE00002526", "2024-10-24", "2025-12-31"),
    "6512": ("ASYLTAS", "KZ53VWE00002680", "2025-12-23", "2026-12-31"),
    "3098": ("Diamond", "ДС №1 к ДПГ-22-16-055/120", "2022-05-10", "2026-10-31"),
}


def main() -> int:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # see NOTE above
    try:
        with urllib.request.urlopen(CSV_URL, context=ctx, timeout=90) as r:
            raw = r.read()
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: could not download live CSV: {e}")
        return 1
    text = raw.decode("utf-8-sig")
    rows = {r["id"]: r for r in csv.DictReader(text.splitlines())}
    print(f"live CSV rows: {len(rows)} (source: {DATASET_PAGE})")
    failures = 0
    for rid, (name_frag, number, d0, d1) in EXPECTED.items():
        row = rows.get(rid)
        if row is None:
            print(f"FAIL id={rid}: row disappeared from the live set")
            failures += 1
            continue
        problems = []
        if name_frag not in row["object_name"]:
            problems.append(f"name {row['object_name']!r} lacks {name_frag!r}")
        if row["number"] != number:
            problems.append(f"number {row['number']!r} != {number!r}")
        if (row["date_start"], row["date_end"]) != (d0, d1):
            problems.append(
                f"dates {(row['date_start'], row['date_end'])} != {(d0, d1)}"
            )
        if problems:
            print(f"FAIL id={rid}: " + "; ".join(problems))
            failures += 1
        else:
            print(f"ok id={rid} {row['object_name'][:45]} · {number}")
    if failures:
        print(f"\nFAIL · {failures} mismatched row(s)")
        return 1
    print("\nPASS · 8 snapshot rows match the live open dataset")
    return 0


if __name__ == "__main__":
    sys.exit(main())
