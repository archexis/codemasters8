async (page) => {
  const imagery = [];
  const errors = [];
  const osm = [];
  page.on('response', response => {
    const match = response.url().match(/World_Imagery\/MapServer\/tile\/(\d+)\//);
    if (match) imagery.push({ zoom: Number(match[1]), status: response.status() });
    if (response.url().includes('tile.openstreetmap.org/')) osm.push(response.url());
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.evaluate(() => sessionStorage.setItem('saq-map-view-v1', JSON.stringify({
    center: [82.614, 49.984], zoom: 19, bearing: 0,
    satellite: true, city3d: true, dimensional: false, theme: 'legal'
  })));
  await page.reload();
  await page.locator('.map-wrap[data-map-ready="true"]').waitFor({ timeout: 20000 });
  await page.waitForResponse(response => response.url().includes('World_Imagery/MapServer/tile/17/') && response.ok(), { timeout: 20000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 });
  await page.screenshot({ path: 'output/playwright/satellite-fix/satellite-3d-zoom19.png', fullPage: true });
  if (await page.locator('.fallback-map').count()) throw new Error('WebGL did not render');
  if (!imagery.length || imagery.some(tile => tile.zoom > 17 || tile.status !== 200)) throw new Error(JSON.stringify(imagery));
  if (errors.length) throw new Error(errors.join('\n'));
  if (osm.length) throw new Error('Hidden street map requested tiles');
  if (await page.locator('.map-status').count()) throw new Error('Unexpected map warning');
  return { cameraZoom: 19, imageryLevels: [...new Set(imagery.map(tile => tile.zoom))], imageryResponses: imagery.length, hiddenStreetMapRequests: osm.length, pageErrors: errors };
}
