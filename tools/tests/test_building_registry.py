import importlib.util
from pathlib import Path
import unittest
import tempfile
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('building_registry', Path(__file__).parents[1] / 'building_registry.py')
registry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(registry)


def feature(floors=9, raw_height=36):
    return {'type': 'Feature', 'properties': {'objectid': 123, 'floor': floors, 'h': raw_height, 'street': 'ул. Тестовая', 'homenum': '7'},
            'geometry': {'type': 'Polygon', 'coordinates': [[[82.6, 49.9], [82.601, 49.9], [82.601, 49.901], [82.6, 49.9]]]}}


class BuildingRegistryTests(unittest.TestCase):
    def test_official_floor_count_is_preserved_but_height_is_explicit_estimate(self):
        result, box = registry.normalize_feature(feature(), 3.2)
        self.assertEqual(result['id'], 123)
        self.assertEqual(result['properties']['floors'], 9)
        self.assertEqual(result['properties']['height'], 28.8)
        self.assertEqual(result['properties']['heightMethod'], 'floors-estimate')
        self.assertEqual(result['properties']['sourceHeightRaw'], 36)
        self.assertEqual(result['properties']['address'], 'ул. Тестовая 7')
        self.assertEqual(box, [82.6, 49.9, 82.601, 49.901])

    def test_missing_or_invalid_floors_never_become_invented_storeys(self):
        for floors in [None, 0, -1, '9', True, 500]:
            with self.subTest(floors=floors):
                result, _ = registry.normalize_feature(feature(floors, 4), 3.2)
                self.assertIsNone(result['properties']['floors'])
                self.assertEqual(result['properties']['height'], 0)
                self.assertEqual(result['properties']['heightMethod'], 'unknown')

    def test_multipolygon_and_holes_are_preserved(self):
        value = feature()
        ring = value['geometry']['coordinates'][0]
        value['geometry'] = {'type': 'MultiPolygon', 'coordinates': [[ring, list(reversed(ring))], [ring]]}
        result, _ = registry.normalize_feature(value, 3.2)
        self.assertEqual([len(p) for p in result['geometry']['coordinates']], [2, 1])

    def test_invalid_or_unrelated_geometry_is_rejected(self):
        for geometry in [{'type': 'Point', 'coordinates': [82.6, 49.9]}, {'type': 'Polygon', 'coordinates': []},
                         {'type': 'Polygon', 'coordinates': [[[82.6, 49.9]]]},
                         {'type': 'Polygon', 'coordinates': [[[0, 0], [1, 0], [1, 1], [0, 0]]]}]:
            with self.subTest(geometry=geometry):
                value = feature(); value['geometry'] = geometry
                with self.assertRaises(ValueError):
                    registry.normalize_feature(value, 3.2)

    def mock_register(self, params, incomplete=False, changed=False, duplicates=False):
        if 'returnCountOnly' in params:
            self.count_calls += 1
            return {'count': 4 if changed and self.count_calls > 1 else 3}
        if 'resultOffset' in params:
            offset = params['resultOffset']
            values = []
            for oid in range(offset + 1, min(offset + 3, 4)):
                value = feature(oid)
                value['properties']['objectid'] = 1 if duplicates and offset > 0 else oid
                values.append(value)
            return {'type': 'FeatureCollection', 'features': values[:-1] if incomplete else values}
        return {'fields': [{'name': k, 'type': 'test'} for k in registry.FIELDS.split(',')],
                'maxRecordCount': 2, 'advancedQueryCapabilities': {'supportsPagination': True}}

    def test_export_has_exact_counts_and_keeps_a_verifiable_checksum(self):
        self.count_calls = 0
        with tempfile.TemporaryDirectory() as temp, patch.object(registry, 'request_json', side_effect=lambda url, p: self.mock_register(p)):
            output = Path(temp) / 'published'
            registry.download(output, Path(temp) / 'cache', workers=1)
            manifest = registry.json.loads((output / 'manifest.json').read_text(encoding='utf-8'))
            self.assertEqual(manifest['sourceRecordCount'], 3)
            self.assertEqual(manifest['featureCount'], 3)
            self.assertEqual(manifest['measuredHeights'], 0)
            self.assertEqual(manifest['geojsonSha256'], registry.hashlib.sha256((output / 'buildings.geojson').read_bytes()).hexdigest())

    def test_truncation_source_changes_and_duplicate_pages_never_publish(self):
        for failure in ['incomplete', 'changed', 'duplicates']:
            self.count_calls = 0
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temp:
                output = Path(temp) / 'published'
                with patch.object(registry, 'request_json', side_effect=lambda url, p: self.mock_register(p, **{failure: True})):
                    with self.assertRaises(RuntimeError):
                        registry.download(output, Path(temp) / 'cache', workers=1)
                self.assertFalse((output / 'manifest.json').exists())


if __name__ == '__main__':
    unittest.main()
