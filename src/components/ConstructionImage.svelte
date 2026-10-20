<script lang="ts">
  import { frameDate, type ConstructionFrame } from '../lib/construction-images';
  let { frame }: { frame: ConstructionFrame } = $props();
</script>

<figure class="construction-image">
  <img src={frame.image} alt={`AI-реконструкция ЖК «${frame.complexName}» · ${frameDate(frame.date)}`} width="1600" height="1200" decoding="async" />
  <figcaption>
    <span class="badge">AI-реконструкция</span>
    <span>Условная дата: <time datetime={frame.date}>{frameDate(frame.date)}</time></span>
  </figcaption>
</figure>

<style>
  .construction-image { margin:0; min-width:0; }
  img { display:block; width:100%; height:auto; aspect-ratio:4/3; object-fit:contain; border-radius:10px; background:#e8ece4; }
  figcaption { display:flex; align-items:center; flex-wrap:wrap; gap:6px 10px; margin-top:10px; color:var(--muted, #627064); font-size:11px; }
</style>
