import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { initialState, validateFactor } from '../../src/lib/domain';
import { validateLoadedState } from '../../src/lib/validation';
import { computeScore } from '../../src/lib/scoring';

describe('демонстрационные документы по формам РК', () => {
  it('сохраняет происхождение, ссылки на формы и целостность всех текстов', () => {
    const state = validateLoadedState(initialState());
    expect(state.artifacts).toHaveLength(35);
    for (const artifact of state.artifacts!) {
      expect(artifact.origin).toBe('demo');
      expect(artifact.sha256).toBe(createHash('sha256').update(artifact.text, 'utf8').digest('hex'));
      expect(artifact.bytes).toBe(Buffer.byteLength(artifact.text, 'utf8'));
      expect(artifact.capturedAt.slice(0, 10) >= artifact.date!).toBe(true);
      if (artifact.url) {
        expect(['adilet.zan.kz', 'www.gov.kz']).toContain(new URL(artifact.url).hostname);
        expect(artifact.text).toContain(artifact.url);
      }
    }
    for (const ad of state.ads) {
      expect(state.artifacts!.find(a => a.adId === ad.id)).toMatchObject({
        complexId: ad.zkId, text: ad.text, date: ad.date,
      });
    }
  });

  it('отделяет период отчета и измерение технадзора от рекламного заявления', () => {
    const state = initialState();
    for (const complex of state.complexes.filter(c => c.id !== 'SQ-008')) {
      const report = state.artifacts!.find(a => a.id === `ART-${complex.id}-SKVR-202609`)!;
      expect(report.text).toContain('приказом и.о. Министра промышленности и строительства РК от 22.06.2026 № 321');
      expect(report.text).toContain('Текстовый фрагмент');
      expect(report.text).toContain(`общая готовность — ${complex.readinessConfirmed}%`);
      expect(report.text).toContain('ЭЦП специалиста: отсутствует');
      expect(report.date).toBe('2026-10-02');
      expect(complex.readinessClaimedSource?.date).toBe('2026-10-14');
      expect(complex.readinessSources.at(-1)).toMatchObject({
        date: '2026-09-30', value: complex.readinessConfirmed,
      });
    }
    // На стадии проектирования отчёт о фактически начавшихся СМР не создаётся.
    expect(state.artifacts!.some(a => a.id === 'ART-SQ-008-SKVR-202609')).toBe(false);
    expect(state.complexes.find(c => c.id === 'SQ-003')!.readinessClaimed).toBe(18);
  });

  it('первичные материалы согласованы с решениями и не меняют контрольный скоринг', () => {
    const state = initialState();
    const evidenceIds: Record<string, string> = {
      'SQ-002:R1': 'ART-SQ002-LEG',
      'SQ-005:R6': 'ART-SQ005-OBS',
      'SQ-006:R4': 'ART-SQ006-DOC',
    };
    for (const complex of state.complexes) {
      for (const factor of complex.factors) {
        if (factor.status === 'confirmed') {
          expect(() => validateFactor(state, complex, factor.code, factor.status, factor.evidence!)).not.toThrow();
        }
        const artifactId = evidenceIds[`${complex.id}:${factor.code}`];
        if (artifactId) {
          const artifact = state.artifacts!.find(a => a.id === artifactId)!;
          expect(factor.evidence).toMatchObject({ source: artifact.source, date: artifact.date, text: artifact.text });
        }
      }
    }
    for (const [id, score] of [['SQ-001', 35], ['SQ-002', 70], ['SQ-003', 10]] as const) {
      expect(computeScore(state.complexes.find(c => c.id === id)!.factors).score).toBe(score);
    }
    const delayed = state.artifacts!.find(a => a.id === 'ART-SQ005-OBS')!;
    expect(delayed.text).toContain('80 календарных дней');
    expect(delayed.text).toContain('срок этапа, а не срок ввода дома');
    const appeal = state.artifacts!.find(a => a.id === 'ART-SQ006-DOC')!;
    expect(appeal.text).toContain('единой специальной формы');
    expect(appeal.text).toContain('Файлы в DEMO не приложены');
  });
});
