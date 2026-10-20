async (page) => {
  if (!(await page.getByRole('button', { name: 'Спутник', exact: true }).isVisible())) await page.getByRole('button', { name: 'Слои и фильтры' }).click();
  const streetTiles = [];
  page.on('response', response => {
    const match = response.url().match(/tile.openstreetmap.org\/(\d+)\//);
    if (match) streetTiles.push({ zoom: Number(match[1]), status: response.status() });
  });
  const streetResponse = page.waitForResponse(response => response.url().includes('tile.openstreetmap.org/') && response.ok());
  await page.getByRole('button', { name: 'Карта', exact: true }).click();
  await streetResponse;
  await page.waitForLoadState('networkidle');
  if (!streetTiles.length || streetTiles.some(tile => tile.zoom > 19 || tile.status !== 200)) throw new Error(JSON.stringify(streetTiles));
  await page.getByRole('button', { name: 'Спутник', exact: true }).click();
  for (const mode of ['2D', '2.5D', '3D']) {
    const button = page.getByRole('button', { name: mode, exact: true });
    await button.click();
    await page.waitForLoadState('networkidle');
    if (await button.getAttribute('aria-pressed') !== 'true') throw new Error('Mode not active: ' + mode);
  }
  if (await page.locator('.map-status').count()) throw new Error('Unexpected map warning after switching views');
  return { switchedViews: ['Карта', 'Спутник', '2D', '2.5D', '3D'], streetTileLevels: [...new Set(streetTiles.map(tile => tile.zoom))], warnings: 0 };
}
