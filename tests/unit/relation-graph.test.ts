import { describe, expect, it } from 'vitest';
import { initialState } from '../../src/lib/domain';
import { dossierRelations, type DossierRelation } from '../../src/lib/dossier-context';
import { buildRelationGraph, connectedRelations, workspaceRelations } from '../../src/lib/relation-graph';

describe('relationship graph', () => {
  it('retains all pairs sharing an account across three complexes and all supporting publications', () => {
    const state = initialState();state.relations = [];
    state.ads = state.complexes.slice(0, 3).map((z, i) => ({ ...state.ads[0], id: `a${i}`, zkId: z.id, account: 'same', platform: 'Telegram' }));
    state.ads.push({ ...state.ads[0], id: 'a3' });
    const shared = workspaceRelations(state).filter(r => r.type === 'same_ad_account');
    expect(shared).toHaveLength(3);
    const firstPair = shared.find(r => [r.fromId, r.toId].includes(`complex:${state.complexes[0].id}`))!;
    expect(firstPair.sourceEvidenceIds).toContain('a3');
  });

  it('includes phase documents in the workspace graph while keeping the dossier scope separate', () => {
    const state = initialState(); const z = state.complexes[0];
    state.phases = [{ id: 'phase-one', complexId: z.id, name: 'Первая очередь' }];
    state.artifacts = [{ id: 'phase-doc', complexId: z.id, phaseId: 'phase-one', kind: 'document', source: 'Документ очереди', text: 'Текст', capturedAt: '' }];
    expect(workspaceRelations(state).some(r => r.id === 'document-phase-doc')).toBe(true);
    expect(dossierRelations(state, z.id).some(r => r.id === 'document-phase-doc')).toBe(false);
  });

  it('keeps every relationship and endpoint beyond the former 40-edge and 80-node caps', () => {
    const state = initialState();
    const center = state.complexes[0];
    const relations: DossierRelation[] = Array.from({ length: 120 }, (_, i) => ({
      id: `r${i}`, fromId: `document:${i}`, from: `Документ ${i}`, toId: `complex:${center.id}`, to: center.name,
      type: 'mentions', label: '', sourceEvidenceIds: [], verificationStatus: 'candidate', matchMethod: 'manual', capturedAt: '',
    }));
    const graph = buildRelationGraph(state, relations, `complex:${center.id}`, center.name);
    expect(graph.edges).toHaveLength(120);
    expect(graph.nodes).toHaveLength(121);
    for (const node of graph.nodes) {
      expect(Number.isFinite(node.x) && Number.isFinite(node.y)).toBe(true);
      expect(graph.nodes.filter(other => other !== node && Math.abs(other.x - node.x) < 232 && Math.abs(other.y - node.y) < 86)).toEqual([]);
    }
  });

  it('merges repeated publications into a selectable relation while retaining both sources', () => {
    const state = initialState();state.relations = [];const z = state.complexes[0];
    state.ads = [{ ...state.ads[0], id: 'a', zkId: z.id, platform: 'Telegram', account: 'Shared' },
      { ...state.ads[0], id: 'b', zkId: z.id, platform: ' telegram ', account: ' shared ' }];
    const graph = buildRelationGraph(state, dossierRelations(state, z.id), `complex:${z.id}`, z.name);
    expect(graph.nodes.filter(n => n.kind === 'account')).toHaveLength(1);
    expect(graph.nodes.filter(n => n.kind === 'publication')).toHaveLength(2);
    const adverts = graph.edges.filter(e => e.label === 'Рекламирует');
    expect(adverts).toHaveLength(1);
    expect(adverts[0].relations.map(r => r.id)).toEqual(['ad-a', 'ad-b']);
    expect(graph.edges.filter(e => e.source)).toHaveLength(2);
  });

  it('uses stable identities, so equal display names do not collapse distinct complexes', () => {
    const state = initialState();state.relations = [];const [a, b] = state.complexes;
    b.name = a.name;
    state.ads = [{ ...state.ads[0], id: 'a', zkId: a.id, account: 'same' }, { ...state.ads[0], id: 'b', zkId: b.id, account: 'same' }];
    const relations = connectedRelations(workspaceRelations(state), `complex:${a.id}`);
    const graph = buildRelationGraph(state, relations, `complex:${a.id}`, a.name, false);
    expect(graph.nodes.some(n => n.id === `complex:${a.id}`)).toBe(true);
    expect(graph.nodes.some(n => n.id === `complex:${b.id}`)).toBe(true);
    expect(graph.nodes.filter(n => n.kind === 'complex')).toHaveLength(2);
    expect(relations.some(r => r.id === `developer-${state.complexes[2].id}`)).toBe(false);
  });

  it('does not hide conflicting review statuses or self-relations through aggregation', () => {
    const state = initialState(); const z = state.complexes[0];
    const base: DossierRelation = { id: 'one', fromId: `complex:${z.id}`, from: z.name, toId: `complex:${z.id}`, to: z.name,
      type: 'mentions', label: '', sourceEvidenceIds: [], verificationStatus: 'candidate', matchMethod: 'manual', capturedAt: '' };
    const graph = buildRelationGraph(state, [base, { ...base, id: 'two', verificationStatus: 'verified' }], `complex:${z.id}`, z.name);
    expect(graph.edges).toHaveLength(2); expect(graph.nodes).toHaveLength(1);
  });
});
