import catalog from './construction-images.json';
import type { Complex } from './types';

export interface ConstructionFrame {
  id: string;
  complexId: string;
  complexName: string;
  date: string;
  image: string;
  thumbnail: string;
}

/** Presentation assets only: never persisted as uploaded evidence or readiness observations. */
export function constructionFrames(complex: Pick<Complex, 'id' | 'name' | 'demo'> | undefined, phaseId?: string): ConstructionFrame[] {
  if (!complex?.demo || phaseId) return [];
  return catalog
    .filter(frame => frame.complexId === complex.id && frame.complexName === complex.name)
    .map(frame => ({
      ...frame,
      id: `illustration-${frame.complexId}-${frame.date}`,
      image: `${import.meta.env.BASE_URL}${frame.image}`,
      thumbnail: `${import.meta.env.BASE_URL}${frame.thumbnail}`,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function frameDate(date: string): string {
  return date.split('-').reverse().join('.');
}
