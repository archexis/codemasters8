export const VIDEO = { fps: 30, width: 1920, height: 1080, durationInFrames: 450 };
export const SCENES = {
  city: { start: 0, duration: 75 },
  target: { start: 75, duration: 60 },
  dossier: { start: 135, duration: 45 },
  connections: { start: 180, duration: 60 },
  document: { start: 240, duration: 60 },
  verification: { start: 300, duration: 51 },
  reverseZoom: { start: 351, duration: 24 },
  brand: { start: 375, duration: 75 },
} as const;
export const MOTION = { titleIn: 8, plateIn: 9, brandDelay: 6, brandIn: 10 };
