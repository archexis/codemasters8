<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { AppState } from '../lib/types';
  import { safeUrl } from '../lib/domain';
  import type { DossierRelation } from '../lib/dossier-context';
  import { buildRelationGraph, graphLabelLines, nodeKinds, relationLabels, type GraphEdge, type GraphNode } from '../lib/relation-graph';
  let { workspace, relations, centerId, centerLabel, selectedId, onselect, details }: {
    workspace: AppState; relations: DossierRelation[]; centerId: string; centerLabel: string;
    selectedId: string; onselect: (id: string) => void; details?: Snippet;
  } = $props();
  let sources = $state(true);
  let query = $state('');
  let selectedNodeId = $state('');
  let width = $state(1000);
  let height = $state(560);
  let svg: SVGSVGElement;
  let zoom = $state(1);
  let offset = $state({ x: 0, y: 0 });
  let drag: { x: number; y: number; offsetX: number; offsetY: number } | undefined;
  let moved = false;
  const graph = $derived(buildRelationGraph(workspace, relations, centerId, centerLabel, sources));
  const positions = $derived(new Map(graph.nodes.map(n => [n.id, n])));
  const lanes = $derived.by(() => {
    const groups = new Map<string, GraphEdge[]>();
    for (const edge of graph.edges) {
      const key = JSON.stringify([edge.from, edge.to].sort());
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(edge);
    }
    const result = new Map<string, number>();
    for (const group of groups.values()) group.forEach((e, i) => result.set(e.id, (i - (group.length - 1) / 2) * 42));
    return result;
  });
  const node = $derived(graph.nodes.find(n => n.id === selectedNodeId));
  const adjacent = $derived([...new Map(graph.edges.filter(e => e.from === selectedNodeId || e.to === selectedNodeId).flatMap(e => e.relations).map(r => [r.id, r])).values()]);
  const selectedGroup = $derived(graph.edges.find(e => !e.source && e.relations.some(r => r.id === selectedId))?.relations ?? []);
  const material = $derived(node?.kind === 'document' ? workspace.artifacts?.find(a => `document:${a.id}` === node?.id) : node?.kind === 'publication' ? workspace.ads.find(a => `publication:${a.id}` === node?.id) : undefined);
  const focus = $derived(new Set(graph.edges.filter(e => e.from === selectedNodeId || e.to === selectedNodeId).flatMap(e => [e.from, e.to])));
  const hits = $derived(query.trim() ? graph.nodes.filter(n => n.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : []);
  function fit(automatic = false) {
    const b = graph.bounds;
    let nextZoom = Math.min(1.15, (width - 48) / b.width, (height - 64) / b.height);
    if (automatic && width < 600 && nextZoom < .65) {
      nextZoom = .65;
      const subject = graph.nodes.find(n => n.id === centerId)!;
      offset = { x: width * .68 - subject.x * nextZoom, y: height / 2 - subject.y * nextZoom };
    } else offset = { x: width / 2 - (b.x + b.width / 2) * nextZoom, y: height / 2 - (b.y + b.height / 2) * nextZoom };
    zoom = nextZoom;
  }
  $effect(() => { graph; width; height; fit(true); });
  $effect(() => { if (selectedNodeId && !graph.nodes.some(n => n.id === selectedNodeId)) selectedNodeId = ''; });
  function scale(factor: number, x = width / 2, y = height / 2) {
    const next = Math.max(0.12, Math.min(2.5, zoom * factor));
    offset = { x: x - (x - offset.x) * next / zoom, y: y - (y - offset.y) * next / zoom }; zoom = next;
  }
  function chooseNode(n: GraphNode) { if (moved) return; selectedNodeId = n.id; onselect(''); }
  function chooseEdge(e: GraphEdge) { if (moved) return; selectedNodeId = ''; onselect(e.relations[0].id); }
  function locate(n: GraphNode) { selectedNodeId = n.id; onselect(''); zoom = 1; offset = { x: width / 2 - n.x, y: height / 2 - n.y }; }
  function path(e: GraphEdge) {
    const a = positions.get(e.from)!; const b = positions.get(e.to)!;
    const sameColumn = a.x === b.x;
    const direction = b.x >= a.x ? 1 : -1;
    const x1 = a.x + (sameColumn ? 116 : direction * 116), x2 = b.x - (sameColumn ? -116 : direction * 116);
    if (e.from === e.to) return `M ${a.x + 116} ${a.y - 12} C ${a.x + 230} ${a.y - 120}, ${a.x + 230} ${a.y + 120}, ${a.x + 116} ${a.y + 12}`;
    // Separate parallel relations so every type and review status stays selectable.
    const lane = lanes.get(e.id) ?? 0;
    return sameColumn ? `M ${x1} ${a.y} C ${x1 + 100 + Math.abs(lane)} ${a.y}, ${x2 + 100 + Math.abs(lane)} ${b.y}, ${x2} ${b.y}` :
      `M ${x1} ${a.y} C ${(x1 + x2) / 2} ${a.y + lane * 2}, ${(x1 + x2) / 2} ${b.y + lane * 2}, ${x2} ${b.y}`;
  }
  function labelPosition(e: GraphEdge) {
    const a = positions.get(e.from)!; const b = positions.get(e.to)!;
    const lane = lanes.get(e.id) ?? 0;
    return { x: a.x === b.x ? a.x + 194 + Math.abs(lane) * .75 : (a.x + b.x) / 2, y: (a.y + b.y) / 2 + (a.x === b.x ? 0 : lane * 1.5) };
  }
</script>

<div class="network-workbench">
  <div class="network-header">
    <div><b>Карта связей</b><span>Узлы: {graph.nodes.length} · Связи: {relations.length}</span></div>
    <label class="source-toggle"><input type="checkbox" bind:checked={sources}/>Показать источники</label>
    <label class="network-search"><span class="sr-only">Найти узел</span><input type="search" placeholder="Найти участника, аккаунт, документ…" bind:value={query}/></label>
  </div>
  {#if query.trim()}<div class="network-results" aria-live="polite">{#each hits as hit}<button onclick={() => locate(hit)}>{hit.label}</button>{:else}<span>Узлы не найдены</span>{/each}</div>{/if}
  <div class="network-body" class:inspecting={!!node || !!selectedId}>
    <div class="network-canvas" bind:clientWidth={width} bind:clientHeight={height}>
      <svg bind:this={svg} class="relation-graph-v2" aria-label="Граф связей выбранного объекта" role="img" viewBox={`0 0 ${width} ${height}`}
        onwheel={e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); const r = svg.getBoundingClientRect(); scale(Math.exp(-e.deltaY * .003), e.clientX - r.left, e.clientY - r.top); } }}
        onpointerdown={e => { if (e.button !== 0) return; moved = false; drag = { x: e.clientX, y: e.clientY, offsetX: offset.x, offsetY: offset.y }; }}
        onpointermove={e => { if (!drag) return; if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) { moved = true; svg.setPointerCapture(e.pointerId); } if (moved) offset = { x: drag.offsetX + e.clientX - drag.x, y: drag.offsetY + e.clientY - drag.y }; }}
        onpointerup={e => { drag = undefined; if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId); }} onpointercancel={() => drag = undefined}>
        <defs><pattern id="relation-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="#c7cfce"/></pattern>
          <marker id="relation-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="context-stroke" stroke-width="1.5"/></marker></defs>
        <rect width="100%" height="100%" fill="url(#relation-grid)"/>
        <g transform={`translate(${offset.x} ${offset.y}) scale(${zoom})`}>
          {#each graph.edges as edge (edge.id)}
            {@const active = edge.relations.some(r => r.id === selectedId)}
            {@const lp = labelPosition(edge)}
            <g class="graph-edge" class:active class:dimmed={!!node && !edge.relations.some(r => adjacent.includes(r))} class:source={edge.source} role="button" tabindex="0"
              aria-label={`${edge.label}: ${positions.get(edge.from)?.label} → ${positions.get(edge.to)?.label}`} onclick={() => chooseEdge(edge)} onkeydown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); moved = false; chooseEdge(edge); } }}>
              <title>{edge.label} · {edge.status === 'verified' ? 'Подтверждена' : edge.status === 'rejected' ? 'Отклонена' : 'Кандидат'} · {edge.relations.length} записей</title>
              <path class="edge-hit" d={path(edge)}/>
              <path class="edge-line" class:verified={edge.status === 'verified'} class:rejected={edge.status === 'rejected'} d={path(edge)} marker-end="url(#relation-arrow)"/>
              <g transform={`translate(${lp.x} ${lp.y})`}><rect x={-(edge.label.length * 3.2 + 13)} y="-12" width={edge.label.length * 6.4 + 26} height="24" rx="3"/><text text-anchor="middle" dy="4">{edge.label}{edge.relations.length > 1 ? ` · ${edge.relations.length}` : ''}</text></g>
            </g>
          {/each}
          {#each graph.nodes as n (n.id)}
            {@const kind = nodeKinds[n.kind] ?? nodeKinds.label}
            <g class="graph-node" class:subject={n.id === centerId} class:chosen={n.id === selectedNodeId} class:dimmed={!!node && n.id !== node.id && !focus.has(n.id)} transform={`translate(${n.x} ${n.y})`}
              role="button" tabindex="0" aria-label={`${kind.label}: ${n.label}`} onclick={() => chooseNode(n)} onkeydown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); moved = false; chooseNode(n); } }}>
              <title>{kind.label}: {n.label}</title>
              <rect class="node-card" x="-116" y="-43" width="232" height="86" rx="4"/>
              <path d="M -115 -39 V 39" stroke={kind.color} stroke-width="4"/>
              <text class="node-kind" x="-100" y="-23" fill={kind.color}>{kind.label.toLocaleUpperCase()}</text>
              {#each graphLabelLines(n.label) as line, i}<text class="node-label" x="-100" y={i * 18 - 1}>{line}</text>{/each}
              <text class="node-count" x="100" y="-23" text-anchor="end">{n.degree}</text>
              {#if n.id === centerId}<text class="node-subject" x="-100" y="32">ОТКРЫТОЕ ДОСЬЕ</text>{/if}
            </g>
          {/each}
        </g>
      </svg>
      <div class="network-zoom"><button aria-label="Увеличить граф" onclick={() => scale(1.25)}>+</button><output aria-label="Масштаб графа">{Math.round(zoom * 100)}%</output><button aria-label="Уменьшить граф" onclick={() => scale(.8)}>−</button><button onclick={() => fit()} title="Показать все узлы">Вписать</button></div>
      {#if !relations.length}<div class="network-empty"><b>Связи пока не зафиксированы</b><span>Добавьте отношение или материал для этого объекта.</span></div>{/if}
    </div>
    {#if node || selectedId}<aside class="network-inspector" aria-label="Подробности выбранной связи">
      <div class="inspector-heading"><b>{node ? 'Участник графа' : 'Отношение'}</b><button aria-label="Закрыть подробности графа" onclick={() => { selectedNodeId = ''; onselect(''); }}>×</button></div>
      {#if node}<small>{(nodeKinds[node.kind] ?? nodeKinds.label).label}</small><h3>{node.label}</h3><p class="inspector-note">Соединений на графе: {node.degree}. Выберите отношение, чтобы проверить его основания.</p>
        {#if node.id.startsWith('complex:') && node.id !== centerId}<a class="button small" href={`#/complexes/${node.id.slice(8)}?tab=relations`}>Открыть досье ↗</a>{/if}
        {#if material}<p class="inspector-note">{material.text}</p>{#if safeUrl(material.url)}<a class="button small" href={safeUrl(material.url)} target="_blank" rel="noopener noreferrer">К оригиналу ↗</a>{/if}{/if}
        <div class="inspector-relations">{#each adjacent as r}<button onclick={() => { selectedNodeId = ''; onselect(r.id); }}><b>{relationLabels[r.type]}</b><span>{r.from} → {r.to}</span><small>{r.verificationStatus === 'verified' ? 'Подтверждена' : r.verificationStatus === 'rejected' ? 'Отклонена' : 'Кандидат'} · источников: {r.sourceEvidenceIds.length}</small></button>{/each}</div>
      {:else if details}{#if selectedGroup.length > 1}<div class="inspector-relations"><small>На линии {selectedGroup.length} записей. Выберите источник:</small>{#each selectedGroup as r}<button aria-pressed={selectedId === r.id} onclick={() => onselect(r.id)}>{r.capturedAt} · {r.sourceEvidenceIds.join(', ')}</button>{/each}</div>{/if}{@render details()}{/if}
    </aside>{/if}
  </div>
  <div class="network-footer"><div class="network-legend"><span><i class="verified"></i>Подтверждена</span><span><i></i>Кандидат</span><span><i class="rejected"></i>Отклонена</span></div><span>Перетаскивайте поле · Ctrl + прокрутка — масштаб · нажмите узел или линию</span></div>
</div>

<style>
  .network-workbench{border:1px solid #a9b2ac;background:#f5f6f4;color:#17251f;font-family:'Segoe UI',Arial,sans-serif;overflow:hidden;border-radius:4px}
  .network-header{display:flex;align-items:center;gap:20px;padding:14px 16px;border-bottom:1px solid #bdc6c1;background:#fff;flex-wrap:wrap}
  .network-header>div{display:flex;align-items:baseline;gap:12px}.network-header b{font-size:15px}.network-header span,.source-toggle{font-size:12px;color:#52615a}
  .source-toggle{display:flex;flex-direction:row;align-items:center;gap:7px;margin-left:auto;white-space:nowrap}.source-toggle input{width:14px;height:14px;accent-color:#235e53}
  .network-search{width:280px}.network-search input{width:100%;font-size:12px;border:1px solid #bdc6c1;border-radius:3px;background:#f5f6f4;padding:8px 10px;box-shadow:none}
  .network-body{display:grid;grid-template-columns:minmax(0,1fr)}.network-body.inspecting{grid-template-columns:minmax(0,1fr) 310px}
  .network-canvas{height:560px;min-width:0;position:relative;overflow:hidden;background:#edf1f2}.relation-graph-v2{display:block;width:100%;height:100%;cursor:grab;touch-action:none;user-select:none}.relation-graph-v2:active{cursor:grabbing}
  .graph-node,.graph-edge{cursor:pointer;outline:none}.node-card{fill:#fff;stroke:#9eaeb3;stroke-width:1}.graph-node.subject .node-card{fill:#e6f0eb;stroke:#235e53;stroke-width:2}.graph-node.chosen .node-card,.graph-node:focus .node-card,.graph-node:hover .node-card{stroke:#234f85;stroke-width:2.5}
  .node-kind{font-size:9px;font-weight:700;letter-spacing:.7px}.node-label{font-size:13px;font-weight:600;fill:#17251f}.node-count{font-size:10px;fill:#63736e}.node-subject{font-size:8px;font-weight:600;letter-spacing:1px;fill:#235e53}
  .edge-line{fill:none;stroke:#967438;stroke-width:1.7;stroke-dasharray:6 4}.edge-line.verified{stroke:#3c7261;stroke-dasharray:none}.edge-line.rejected{stroke:#7e898e;stroke-dasharray:2 5}.source .edge-line{stroke:#8b99a2;stroke-width:1.2;stroke-dasharray:3 4}
  .edge-hit{fill:none;stroke:transparent;stroke-width:22}.graph-edge rect{fill:#edf1f2;stroke:#d4dcde;stroke-width:.7}.graph-edge text{font-size:10px;fill:#4a5b61;font-weight:600}.graph-edge.active .edge-line,.graph-edge:hover .edge-line,.graph-edge:focus .edge-line{stroke:#235e9c;stroke-width:3}.graph-edge.active rect,.graph-edge:hover rect,.graph-edge:focus rect{fill:#dce9f5;stroke:#235e9c}
  .dimmed{opacity:.23}.network-zoom{position:absolute;bottom:16px;left:16px;display:flex;align-items:center;background:#fff;border:1px solid #a9b2ac;border-radius:3px;overflow:hidden}.network-zoom button,.inspector-heading button{border:0;border-radius:0;box-shadow:none;background:#fff;padding:7px 12px;font-size:16px}.network-zoom button:last-child{font-size:11px;border-left:1px solid #c9d1ce}.network-zoom output{font-size:11px;min-width:44px;text-align:center;font-variant-numeric:tabular-nums}
  .network-footer{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 16px;border-top:1px solid #bdc6c1;font-size:10px;color:#52615a;background:#fff}.network-legend{display:flex;gap:18px}.network-legend span{display:flex;align-items:center;gap:6px}.network-legend i{width:22px;border-top:2px dashed #967438}.network-legend i.verified{border-top:2px solid #3c7261}.network-legend i.rejected{border-top:2px dotted #7e898e}
  .network-inspector{border-left:1px solid #bdc6c1;padding:16px;background:#fff;max-height:560px;overflow:auto;overflow-wrap:anywhere}.inspector-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;font-size:12px}.inspector-heading button{padding:0 4px;font-size:22px}.network-inspector small{font-size:11px;color:#52615a}.network-inspector h3{font-size:17px;margin:6px 0 12px;line-height:1.35}.inspector-note{font-size:12px;color:#52615a;line-height:1.6;margin-bottom:16px}.inspector-relations{margin-top:16px}.inspector-relations button{display:block;width:100%;text-align:left;border:0;border-top:1px solid #d6deda;border-radius:0;box-shadow:none;padding:12px 0;background:#fff}.inspector-relations b,.inspector-relations span,.inspector-relations small{display:block}.inspector-relations b{font-size:12px}.inspector-relations span{font-size:12px;font-weight:400;margin:4px 0}
  .network-results{padding:8px 16px;border-bottom:1px solid #bdc6c1;display:flex;gap:8px;flex-wrap:wrap;font-size:12px;max-height:140px;overflow:auto}.network-results button{font-size:12px;border-radius:3px;box-shadow:none;padding:6px 10px}.network-empty{position:absolute;inset:25% 20px auto;text-align:center;pointer-events:none;background:#edf1f2;padding:20px}.network-empty span{display:block;font-size:12px;margin-top:8px}
  :global(.graph-expanded) .network-workbench{display:flex;flex-direction:column;flex:1;min-height:0}
  :global(.graph-expanded) .network-body{flex:1;min-height:0}
  :global(.graph-expanded) .network-canvas{height:100%;min-height:280px}
  :global(.graph-expanded) .network-inspector{max-height:100%;min-height:0}
  @media(max-width:900px){.network-header{gap:10px}.network-search{width:100%;order:3}.network-body.inspecting{grid-template-columns:minmax(0,1fr)}.network-inspector{border-left:0;border-top:1px solid #bdc6c1;max-height:360px}.network-canvas{height:500px}.network-footer>span{display:none}.network-header>div{gap:8px}.network-header b{font-size:13px}.network-header span{font-size:11px}.source-toggle{margin-left:0}}
  @media(max-width:900px){:global(.graph-expanded) .network-body.inspecting{grid-template-rows:minmax(200px,1fr) auto}:global(.graph-expanded) .network-inspector{max-height:28dvh}:global(.graph-expanded) .network-canvas{min-height:200px}}
</style>
