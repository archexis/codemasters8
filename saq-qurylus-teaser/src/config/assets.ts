/** All images are unaltered captures of the local application, 1920 × 1080.
 * Coordinates are in the original screenshot. Replace paths AND anchors together.
 * The selected app object and its source records are explicitly fictional DEMO data.
 */
export const ASSETS = {
  map: 'assets/saq-map.png',
  target: 'assets/saq-target.png',
  dossier: 'assets/saq-dossier.png',
  connections: 'assets/saq-connections.png',
  document: 'assets/saq-document.png',
  verification: 'assets/saq-verification.png',
  logo: null as string | null,
  font: 'fonts/Inter.ttf',
};
export type AssetRole = Exclude<keyof typeof ASSETS, 'logo' | 'font'>;
export type Crop = { x: number; y: number; width: number; height: number };
export const CROPS = {
  map: { x: 0, y: 180, width: 1920, height: 900 },
  target: { x: 0, y: 180, width: 1530, height: 900 },
  selected: { x: 1530, y: 190, width: 375, height: 620 },
  dossier: { x: 375, y: 175, width: 1165, height: 740 },
  connections: { x: 550, y: 300, width: 850, height: 460 },
  document: { x: 733, y: 320, width: 802, height: 500 },
  verification: { x: 480, y: 245, width: 960, height: 600 },
} satisfies Record<string, Crop>;
export const ANCHORS = {
  cityTarget: { x: 925, y: 612 },
  target: { x: 960, y: 618 },
  developer: { x: 751, y: 593, width: 725, height: 46 },
  centralNode: { x: 881, y: 589, width: 158, height: 58 },
  sourceNode: { x: 596, y: 402, width: 158, height: 57 },
  sourcePassage: { x: 769, y: 652, width: 730, height: 49 },
  confirmedFact: { x: 485, y: 670, width: 946, height: 117 },
} as const;
export const CAMERAS = {
  dossier: { x: 315, y: 145, width: 1410 },
  connections: { x: 345, y: 225, width: 1460 },
  document: { x: 590, y: 220, width: 1180 },
  verification: { x: 535, y: 225, width: 1270 },
};
