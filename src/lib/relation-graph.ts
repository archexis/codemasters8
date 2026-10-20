import type { AppState } from './types';
import { dossierRelations, type DossierRelation } from './dossier-context';

export const relationLabels: Record<string, string> = {
  developer_of: 'Застройщик', authorized_company_of: 'Уполномоченная компания',
  contractor_of: 'Подрядчик', advertises: 'Рекламирует', covered_by: 'Покрытие документом',
  mentions: 'Упоминает', same_ad_account: 'Общий аккаунт', located_on: 'Расположен на',
};
export const nodeKinds: Record<string, { label: string; color: string }> = {
  complex: { label: 'Жилой комплекс', color: '#235e53' },
  phase: { label: 'Очередь', color: '#235e53' },
  organization: { label: 'Организация', color: '#465fa2' },
  developer: { label: 'Организация', color: '#465fa2' },
  account: { label: 'Рекламный аккаунт', color: '#8b5a24' },
  publication: { label: 'Публикация', color: '#6d5792' },
  document: { label: 'Документ / материал', color: '#536776' },
  label: { label: 'Участник связи', color: '#536776' },
};
export interface GraphNode { id: string; label: string; kind: string; x: number; y: number; degree: number }
export interface GraphEdge { id: string; from: string; to: string; label: string; status: DossierRelation['verificationStatus']; relations: DossierRelation[]; source: boolean }

export function workspaceRelations(state: AppState): DossierRelation[] {
  const relations = state.complexes.flatMap(z => dossierRelations(state, z.id));
  for (const p of state.phases ?? []) relations.push(...dossierRelations(state, p.complexId, p.id));
  const unique = new Map<string, DossierRelation>();
  for (const r of relations) {
    const previous = unique.get(r.id);
    unique.set(r.id, previous ? { ...previous, sourceEvidenceIds: [...new Set([...previous.sourceEvidenceIds, ...r.sourceEvidenceIds])] } : r);
  }
  return [...unique.values()];
}

export function relationEndpoints(r: DossierRelation) {
  // Legacy records without identities remain distinct from typed entities.
  const canonical = (id: string) => id.startsWith('account:') ? id.split(':').map((part, index) => index ? part.trim().toLowerCase() : part).join(':') : id;
  return { from: canonical(r.fromId ?? `label:${r.from}`), to: canonical(r.toId ?? `label:${r.to}`) };
}

export function connectedRelations(relations: DossierRelation[], centerId: string): DossierRelation[] {
  const adjacency = new Map<string, Set<string>>();
  for (const r of relations) {
    const { from, to } = relationEndpoints(r);
    for (const [a, b] of [[from, to], [to, from]]) {
      if (!adjacency.has(a)) adjacency.set(a, new Set());
      adjacency.get(a)!.add(b);
    }
  }
  const visited = new Set([centerId]);
  for (const id of visited) for (const next of adjacency.get(id) ?? []) visited.add(next);
  return relations.filter(r => visited.has(relationEndpoints(r).from));
}

export function buildRelationGraph(state: AppState, relations: DossierRelation[], centerId: string, centerLabel: string, sources = true) {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  function node(id: string, label: string) {
    if (!nodes.has(id)) nodes.set(id, { id, label, kind: id.split(':')[0], x: 0, y: 0, degree: 0 });
  }
  function edge(from: string, to: string, r: DossierRelation, source = false) {
    const id = JSON.stringify([from, to, source ? 'source' : r.type, r.verificationStatus]);
    const previous = edges.get(id);
    if (previous) { if (!previous.relations.some(item => item.id === r.id)) previous.relations.push(r); return; }
    edges.set(id, { id, from, to, label: source ? 'Источник связи' : relationLabels[r.type], status: r.verificationStatus, relations: [r], source });
  }
  node(centerId, centerLabel);
  for (const r of relations) {
    const { from, to } = relationEndpoints(r);
    node(from, r.from); node(to, r.to); edge(from, to, r);
    if (!sources) continue;
    for (const id of r.sourceEvidenceIds) {
      const artifact = state.artifacts?.find(a => a.id === id);
      const ad = state.ads.find(a => a.id === (artifact?.adId ?? id));
      if (!artifact && !ad) continue;
      const sourceId = artifact ? `document:${artifact.id}` : `publication:${ad!.id}`;
      if (sourceId === from || sourceId === to) continue;
      node(sourceId, artifact?.source ?? `${ad!.platform} · ${ad!.date ?? 'дата не указана'}`);
      edge(sourceId, from, r, true);
    }
  }
  for (const e of edges.values()) { nodes.get(e.from)!.degree++; nodes.get(e.to)!.degree++; }
  // Deterministic layered placement. Every card gets its own row; labels and nodes never collide.
  const adjacency = new Map<string, Set<string>>();
  for (const e of edges.values()) {
    for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
      if (!adjacency.has(a)) adjacency.set(a, new Set());
      adjacency.get(a)!.add(b);
    }
  }
  const visited = new Set<string>();
  const components: GraphNode[][] = [];
  const roots = [centerId, ...[...nodes.values()].sort((a, b) => Number(b.kind === 'complex') - Number(a.kind === 'complex') || b.degree - a.degree).map(n => n.id)];
  for (const root of roots) {
    if (visited.has(root)) continue;
    const levels = new Map<string, number>([[root, 0]]);
    const queue = [root]; visited.add(root);
    for (let i = 0; i < queue.length; i++) for (const next of adjacency.get(queue[i]) ?? []) {
      if (!visited.has(next)) { visited.add(next); levels.set(next, levels.get(queue[i])! + 1); queue.push(next); }
    }
    const columns = new Map<number, GraphNode[]>();
    for (const id of queue) {
      const n = nodes.get(id)!;
      const distance = levels.get(id)!;
      const level = id === root ? 0 :
        (['organization', 'developer', 'document', 'account', 'publication'].includes(n.kind) ? -distance : distance);
      if (!columns.has(level)) columns.set(level, []);
      columns.get(level)!.push(n);
    }
    for (const [level, column] of columns) column.sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id)).forEach((n, i) => {
      n.x = level * 420;
      n.y = (i - (column.length - 1) / 2) * 138;
    });
    for (const [level, column] of [...columns].sort((a, b) => Math.abs(a[0]) - Math.abs(b[0]))) {
      if (!level) continue;
      const parentY = (n: GraphNode) => {
        const parents = [...(adjacency.get(n.id) ?? [])].filter(id => levels.get(id)! < levels.get(n.id)!);
        return parents.length ? parents.reduce((sum, id) => sum + nodes.get(id)!.y, 0) / parents.length : 0;
      };
      column.sort((a, b) => parentY(a) - parentY(b) || a.id.localeCompare(b.id)).forEach((n, i) => {
        n.y = (i - (column.length - 1) / 2) * 138;
      });
    }
    components.push(queue.map(id => nodes.get(id)!));
  }
  // Disconnected dossiers keep their own readable network, arranged as a contact sheet.
  if (components.length > 1) {
    const boxes = components.map(group => ({ minX: Math.min(...group.map(n => n.x)), minY: Math.min(...group.map(n => n.y)),
      width: Math.max(...group.map(n => n.x)) - Math.min(...group.map(n => n.x)) + 340,
      height: Math.max(...group.map(n => n.y)) - Math.min(...group.map(n => n.y)) + 220 }));
    const cellWidth = Math.max(...boxes.map(b => b.width));
    const cellHeight = Math.max(...boxes.map(b => b.height));
    const count = Math.ceil(Math.sqrt(components.length));
    components.forEach((group, i) => group.forEach(n => {
      n.x += (i % count) * cellWidth - boxes[i].minX;
      n.y += Math.floor(i / count) * cellHeight - boxes[i].minY;
    }));
  }
  const items = [...nodes.values()];
  return { nodes: items, edges: [...edges.values()], bounds: {
    x: Math.min(...items.map(n => n.x)) - 156, y: Math.min(...items.map(n => n.y)) - 88,
    width: Math.max(...items.map(n => n.x)) - Math.min(...items.map(n => n.x)) + 312,
    height: Math.max(...items.map(n => n.y)) - Math.min(...items.map(n => n.y)) + 176,
  } };
}

export function graphLabelLines(label: string, length = 26): string[] {
  const words = label.match(new RegExp(`.{1,${length}}(?:\\s|$)|.{1,${length}}`, 'g')) ?? [label];
  const lines = words.map(w => w.trim());
  return lines.length > 2 ? [lines[0], `${lines[1].slice(0, length - 1)}…`] : lines;
}
