<script lang="ts">
 let {text,quote=''}:{text:string;quote?:string}=$props();
 const start=$derived(quote?text.indexOf(quote):-1);
</script>
<p class="publication-text">{#if start>=0}{text.slice(0,start)}<mark>{text.slice(start,start+quote.length)}</mark>{text.slice(start+quote.length)}{:else}{text}{/if}</p>
