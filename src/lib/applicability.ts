import type { ApplicabilityPeriod } from './types';
/** Inclusive calendar intervals. Missing end denotes an open future interval. */
export function periodContains(outer: ApplicabilityPeriod, inner: ApplicabilityPeriod): boolean {
  return outer.from <= inner.from && (!outer.to || (!!inner.to && inner.to <= outer.to));
}
export function dateWithinPeriod(date: string, period: ApplicabilityPeriod): boolean {
  const day=date.slice(0,10);
  return day >= period.from && (!period.to || day <= period.to);
}
