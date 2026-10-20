async (page) => {
  return await page.evaluate(() => ({
    viewport: [innerWidth, innerHeight],
    document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    boxes: ['#app', '.topbar', 'main', '.map-page', '.map-shell', '.map-wrap', '.map-preview', '.map-legend-float'].map(selector => {
      const element = document.querySelector(selector);
      const rect = element.getBoundingClientRect();
      const css = getComputedStyle(element);
      return { selector, x: rect.x, y: rect.y, width: rect.width, height: rect.height, minHeight: css.minHeight, flex: css.flex, rows: css.gridTemplateRows };
    }),
  }));
}
