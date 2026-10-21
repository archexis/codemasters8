"""Auditable ArcGIS import; floor counts are not measured building heights."""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

SOURCE = 'https://gis.kgp.kz/arcgis/rest/services/KPSSU/Gray_basemap/FeatureServer/1'
CITY = 'Усть-Каменогорск'
WHERE = f"location = '{CITY}'"
FIELDS = 'objectid,floor,h,street,homenum'


def request_json(url, params=None):
    encoded = urlencode(params or {})
    # ArcGIS supports read-only form POST for long objectIds lists (GET can hit 414).
    body = encoded.encode() if len(encoded) > 1800 else None
    if body is None:
        url += ('&' if '?' in url else '?') + encoded
    for attempt in range(4):
        try:
            req = Request(url, data=body, headers={'User-Agent': 'SAQ-QURYLYS-building-import/1.0', 'Accept': 'application/json'})
            with urlopen(req, timeout=90) as response:
                result = json.load(response)
            if result.get('error'):
                raise RuntimeError(f"ArcGIS error: {result['error']}")
            return result
        except HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 3:
                raise
            time.sleep(2 ** attempt)
        except (URLError, TimeoutError, OSError):
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    temporary.replace(path)


def normalize_feature(feature, floor_height):
    props = feature.get('properties') or {}
    oid = props.get('objectid')
    if type(oid) is not int or oid <= 0:
        raise ValueError('Missing stable official object ID')
    geometry = feature.get('geometry') or {}
    if geometry.get('type') not in ('Polygon', 'MultiPolygon'):
        raise ValueError(f'Invalid polygon: {oid}')
    polygons = geometry.get('coordinates', [])
    if geometry['type'] == 'Polygon':
        polygons = [polygons]
    if not polygons:
        raise ValueError(f'Empty polygon: {oid}')
    bounds = [180.0, 90.0, -180.0, -90.0]
    rounded = []
    for polygon in polygons:
        if not polygon:
            raise ValueError(f'Empty polygon rings: {oid}')
        rings = []
        for ring in polygon:
            if len(ring) < 4 or ring[0][:2] != ring[-1][:2]:
                raise ValueError(f'Invalid ring: {oid}')
            points = []
            for point in ring:
                x, y = point[:2]
                if not all(type(v) in (float, int) and math.isfinite(v) for v in (x, y)) or not (-180 <= x <= 180 and -85 <= y <= 85):
                    raise ValueError(f'Invalid coordinates: {oid}')
                bounds = [min(bounds[0], x), min(bounds[1], y), max(bounds[2], x), max(bounds[3], y)]
                points.append([round(x, 7), round(y, 7)])
            rings.append(points)
        rounded.append(rings)
    # Deliberately broad sanity bounds, not a substitute for the source city filter.
    if not (82 < bounds[0] <= bounds[2] < 84 and 49 < bounds[1] <= bounds[3] < 51):
        raise ValueError(f'Coordinates outside Oskemen region: {oid}')
    floors = props.get('floor')
    known = type(floors) is int and 1 <= floors <= 150
    return {
        'type': 'Feature', 'id': oid,
        'geometry': {'type': geometry['type'], 'coordinates': rounded[0] if geometry['type'] == 'Polygon' else rounded},
        'properties': {
            'sourceId': oid, 'floors': floors if known else None,
            'height': round(floors * floor_height, 2) if known else 0,
            'heightMethod': 'floors-estimate' if known else 'unknown',
            # The source does not document units/measurement provenance for h.
            'sourceHeightRaw': props.get('h'),
            'address': ' '.join(str(props[k]).strip() for k in ('street', 'homenum') if props.get(k)),
        },
    }, bounds


def download(output, cache, floor_height=3.2, refresh=False, workers=3):
    metadata = request_json(SOURCE, {'f': 'json'})
    fields = {f['name'] for f in metadata.get('fields', [])}
    if not set(FIELDS.split(',')).issubset(fields):
        raise RuntimeError('Official source schema changed; refusing an incomplete import')
    count_result = request_json(SOURCE + '/query', {'f': 'json', 'where': WHERE, 'returnCountOnly': 'true'})
    count = count_result.get('count', 0)
    if type(count) is not int or count <= 0:
        raise RuntimeError('Official source returned an empty register')
    if not metadata.get('advancedQueryCapabilities', {}).get('supportsPagination'):
        raise RuntimeError('Source no longer supports stable pagination')
    size = min(1000, metadata.get('maxRecordCount', 1000))
    pages = list(range(0, count, size))
    namespace = hashlib.sha256((SOURCE + WHERE + FIELDS + str(count)).encode()).hexdigest()[:12]
    cache = cache / namespace
    cache.mkdir(parents=True, exist_ok=True)

    def page(offset):
        expected = min(size, count - offset)
        file = cache / f'{offset}-{size}.geojson'
        if file.exists() and not refresh:
            result = json.loads(file.read_text(encoding='utf-8'))
        else:
            result = request_json(SOURCE + '/query', {
                'f': 'geojson', 'where': WHERE, 'resultOffset': offset,
                'resultRecordCount': size, 'orderByFields': 'objectid ASC',
                'outFields': FIELDS, 'outSR': '4326', 'returnGeometry': 'true',
            })
            # Never cache truncated/error pages as a successful import.
            actual = [f.get('properties', {}).get('objectid') for f in result.get('features', [])]
            if len(actual) != expected or len(set(actual)) != expected:
                raise RuntimeError(f'Incomplete page: expected {expected}, received {len(actual)}')
            write_json(file, result)
        actual = [f.get('properties', {}).get('objectid') for f in result.get('features', [])]
        if len(actual) != expected or actual != sorted(set(actual)):
            raise RuntimeError('Cached page is incomplete or unordered')
        return result['features']

    print(f'Official records: {count}; pages: {len(pages)}', flush=True)
    features, rejected, ids = [], [], []
    bounds = [180.0, 90.0, -180.0, -90.0]
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for index, batch in enumerate(pool.map(page, pages)):
            for feature in batch:
                ids.append(feature.get('properties', {}).get('objectid'))
                try:
                    normalized, box = normalize_feature(feature, floor_height)
                    features.append(normalized)
                    bounds = [min(bounds[0], box[0]), min(bounds[1], box[1]), max(bounds[2], box[2]), max(bounds[3], box[3])]
                except ValueError as error:
                    rejected.append({'id': feature.get('id'), 'reason': str(error)})
            if index % 10 == 0 or index == len(pages) - 1:
                print(f'Pages {index + 1}/{len(pages)}; accepted {len(features)}', flush=True)
    # Detect additions/deletions during the export; never publish partial coverage silently.
    final = request_json(SOURCE + '/query', {'f': 'json', 'where': WHERE, 'returnCountOnly': 'true'})
    if final.get('count') != count or len(ids) != count or len(set(ids)) != count or ids != sorted(ids):
        raise RuntimeError('Source changed during export; rerun with --refresh')
    floors = Counter(str(f['properties']['floors']) for f in features)
    known = sum(f['properties']['heightMethod'] == 'floors-estimate' for f in features)
    manifest = {
        'schemaVersion': 1, 'city': CITY, 'source': SOURCE, 'where': WHERE,
        'publisher': 'КПСиСУ — публичный картографический сервис gis.kgp.kz',
        'retrievedAt': datetime.now(timezone.utc).isoformat(),
        'sourceUpdatedAt': None, 'sourceRecordCount': count, 'featureCount': len(features),
        'oldestPageFetchedAt': datetime.fromtimestamp(min(p.stat().st_mtime for p in cache.glob('*.geojson')), timezone.utc).isoformat(),
        'knownFloors': known, 'unknownFloors': len(features) - known,
        'rejectedCount': len(rejected), 'rejected': rejected,
        'bounds': bounds, 'floorCounts': dict(sorted(floors.items())),
        'heightMethod': 'floors-estimate', 'metersPerFloor': floor_height,
        'measuredHeights': 0,
        'coverageScope': 'All records matching the source city filter; completeness against actual city buildings is unknown.',
        'heightNote': 'Official floor counts; display height = floors × metersPerFloor. Not measured heights. Raw h is retained but not treated as a measurement.',
        'sourceSchema': [{'name': f['name'], 'alias': f.get('alias'), 'type': f['type']} for f in metadata['fields'] if f['name'] in FIELDS.split(',')],
    }
    output.mkdir(parents=True, exist_ok=True)
    write_json(output / 'buildings.geojson', {'type': 'FeatureCollection', 'features': sorted(features, key=lambda f: f['id'])})
    manifest['geojsonSha256'] = hashlib.sha256((output / 'buildings.geojson').read_bytes()).hexdigest()
    write_json(output / 'manifest.json', manifest)
    print(json.dumps({k: manifest[k] for k in ('sourceRecordCount', 'featureCount', 'knownFloors', 'unknownFloors', 'rejectedCount')}, ensure_ascii=True), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('output/city-buildings'))
    parser.add_argument('--cache', type=Path, default=Path('output/city-buildings-cache'))
    parser.add_argument('--meters-per-floor', type=float, default=3.2)
    parser.add_argument('--refresh', action='store_true')
    parser.add_argument('--workers', type=int, choices=range(1, 5), default=3)
    args = parser.parse_args()
    if not math.isfinite(args.meters_per_floor) or not 2 <= args.meters_per_floor <= 6:
        parser.error('--meters-per-floor must be between 2 and 6 (visual estimate only)')
    download(args.output, args.cache, args.meters_per_floor, args.refresh, args.workers)
