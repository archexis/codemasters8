<script lang="ts">
  import { onMount } from 'svelte';
  import type { Media } from '../lib/types';
  import { mediaUrl } from '../lib/repository';
  let { media }: { media: Media } = $props();
  let url = $state(''); let error = $state('');
  onMount(() => {
    let active = true; let objectUrl = '';
    mediaUrl(media).then(value => { if (value.startsWith('blob:')) objectUrl = value; if (active) url = value; else if (objectUrl) URL.revokeObjectURL(objectUrl); }).catch(e => { if (active) error = e.message; });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  });
</script>
<article class="panel">
  {#if url && media.kind.startsWith('image/')}<img class="evidence-image" src={url} alt={media.note || media.name}/>
  {:else if url && media.kind.startsWith('video/')}<video class="evidence-image" src={url} controls><track kind="captions"/></video>
  {:else if url}<a href={url} target="_blank" rel="noopener noreferrer">Открыть {media.name}</a>{/if}
  <p>{media.note || media.name}</p><p class="muted text-xs">{media.date} {media.ready == null ? '' : `· готовность ${media.ready}%`}</p>
  {#if error}<p role="alert">{error}</p>{/if}
</article>
