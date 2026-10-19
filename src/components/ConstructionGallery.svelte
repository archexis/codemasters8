<script lang="ts">
  import type { ConstructionFrame } from '../lib/construction-images';
  import ConstructionImage from './ConstructionImage.svelte';
  let { frames }: { frames: ConstructionFrame[] } = $props();
  const current = $derived(frames.at(-1));
</script>

{#if current}
<section class="construction-gallery" aria-label="Последнее изображение строительства">
  <ConstructionImage frame={current} />
  <p class="muted text-xs">Вымышленная хронология строительства. Иллюстрации созданы с помощью AI.</p>
  <a class="text-xs" href={current.image} target="_blank" rel="noopener noreferrer">Открыть изображение ↗</a>
</section>
{/if}

<style>
  .construction-gallery { margin-top:12px; }
  p { margin-top:12px; }
  a { display:inline-block; margin-top:10px; }
</style>
