import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { GeoJSONVT } from '@maplibre/geojson-vt';
import { fromGeojsonVt } from '@maplibre/vt-pbf';

const input = resolve(process.argv[2] || 'output/city-buildings');
const output = resolve(process.argv[3] || 'public/city-buildings');
const manifest = JSON.parse(await readFile(join(input, 'manifest.json'), 'utf8'));
const bytes = await readFile(join(input, 'buildings.geojson'));
if (createHash('sha256').update(bytes).digest('hex') !== manifest.geojsonSha256) {
  throw new Error('GeoJSON does not match the import manifest');
}
const data = JSON.parse(bytes);
if (data.features.length !== manifest.featureCount || !data.features.length || manifest.rejectedCount) {
  throw new Error('Refusing to publish empty, rejected or incomplete import');
}
const minzoom = 12, maxzoom = 15;
const index = new GeoJSONVT(data, { maxZoom: maxzoom, tolerance: 1, extent: 4096, buffer: 64 });
const [west, south, east, north] = manifest.bounds;
const tileX = (lng, z) => Math.floor((lng + 180) / 360 * 2 ** z);
const tileY = (lat, z) => Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z);
// Versioned directories keep the old manifest valid until all new tiles are written.
const version = manifest.geojsonSha256.slice(0, 16);
let tileCount = 0, tileBytes = 0;
for (let z = minzoom; z <= maxzoom; z++) {
  // One tile of padding also supplies empty neighbours instead of HTTP 404s.
  for (let x = tileX(west, z) - 1; x <= tileX(east, z) + 1; x++) {
    const dir = join(output, version, String(z), String(x));
    await mkdir(dir, { recursive: true });
    for (let y = tileY(north, z) - 1; y <= tileY(south, z) + 1; y++) {
      const tile = index.getTile(z, x, y);
      const pbf = fromGeojsonVt(tile ? { buildings: tile } : {}, { version: 2, extent: 4096 });
      await writeFile(join(dir, `${y}.pbf`), pbf);
      tileCount++; tileBytes += pbf.length;
    }
  }
  console.log(`Built z${z}: ${tileCount} tiles so far`);
}
const published = {
  ...manifest, minzoom, maxzoom, tileCount, tileBytes,
  tiles: [`${version}/{z}/{x}/{y}.pbf`], sourceLayer: 'buildings',
};
await writeFile(join(output, 'manifest.json.tmp'), JSON.stringify(published, null, 2) + '\n');
await rename(join(output, 'manifest.json.tmp'), join(output, 'manifest.json'));
console.log(`Published ${data.features.length} official features in ${tileCount} tiles (${(tileBytes / 1048576).toFixed(1)} MiB)`);
