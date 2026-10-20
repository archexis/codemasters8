async (page) => {
  const results = [];
  for (const [width, height] of [[320, 740], [390, 844], [1440, 1000]]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['Правовой', 'Стройка', 'Реклама']) {
      const tools = page.getByRole('button', { name: 'Слои и фильтры', exact: true });
      if (await tools.getAttribute('aria-expanded') !== 'true') await tools.click();
      await page.getByRole('button', { name: theme, exact: true }).click();
      await tools.click();
      const button = page.getByRole('button', { name: 'Открыть досье', exact: true });
      await button.waitFor({ state: 'visible' });
      const layout = await button.evaluate(element => {
        const card = element.closest('.map-preview').getBoundingClientRect();
        const legend = document.querySelector('.map-legend-float').getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        return {
          viewport: [innerWidth, innerHeight],
          document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
          overlap: card.left < legend.right && card.right > legend.left && card.top < legend.bottom && card.bottom > legend.top,
          receivesClick: element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
        };
      });
      if (layout.overlap || !layout.receivesClick || layout.document[0] > width || (width <= 640 && layout.document[1] > height)) {
        throw new Error(JSON.stringify({ width, theme, layout }));
      }
      await page.screenshot({ path: 'output/playwright/e2e-ui-20261020/fix-verification/map-' + width + '-' + theme + '.png' });
      await button.click();
      await page.waitForURL('**/#/complexes/SQ-002');
      results.push({ width, theme, ...layout, openedDossier: true });
      await page.getByRole('link', { name: 'К карте ↗', exact: true }).click();
    }
  }
  return results;
}
