export type Code = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6';
export type FactorStatus = 'confirmed' | 'hypothesis' | 'rejected' | 'needs-verification';
export type Zone = 'green' | 'yellow' | 'red';
export interface Evidence { source: string; quote?: string; date?: string; adId?: string }
export interface Factor { code: Code; status: FactorStatus; evidence?: Evidence; reviewer?: string; updatedAt?: string }
export interface Complex {
  id: string; name: string; city: string; address: string; developer: string; bin: string | null;
  lat?: number | null; lng?: number | null; demo?: boolean; origin: string; scenario?: string;
  stage: string; readinessClaimed: number | null; readinessConfirmed: number | null;
  readinessSources: { value: number; source: string; date: string }[];
  legalBasis: { type: string; status: string; source: string; checkedAt: string };
  note: string; factors: Factor[]; events: { date: string; text: string }[];
  sources: { title: string; date: string; url?: string }[];
  version?: number;
}
export interface Ad { id: string; zkId: string; platform: string; account: string; date: string; url: string; captureAt: string; text: string; decision?: string; analysis?: Analysis }
export interface Hypothesis { code: Code; quote: string; reason: string }
export interface Analysis { engine: string; realAI: boolean; hypotheses: Hypothesis[] }
export interface Media { id: string; zkId: string; name: string; kind: string; date: string; note: string; ready: number | null; path: string }
export interface AuditEvent { id: string; zkId: string; at: string; reviewer: string; action: string; comment: string; details?: unknown }
export interface Signal { status: 'draft' | 'confirmed' | 'returned'; snapshot?: Complex; at: string; reviewer: string; comment: string }
export interface AppState { complexes: Complex[]; ads: Ad[]; media: Media[]; signals: Record<string, Signal>; audit: AuditEvent[] }
export interface Registry { name: string; url: string; note: string }
