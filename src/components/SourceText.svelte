<script lang="ts">
 let {text,quote=''}:{text:string;quote?:string}=$props();
 const start=$derived(quote?text.indexOf(quote):-1);
 const imported=$derived.by(()=>{try{const r=JSON.parse(text);return r?.schema==='saq-registry-source/v1'&&typeof r.name==='string'&&typeof r.address==='string'?r:null;}catch{return null;}});
 const types:Record<string,string>={commercial_catalog:'Коммерческий каталог',official_open_data:'Открытый набор госданных',official_registry:'Выгрузка государственного реестра'};
</script>
{#if imported}<div class="import-metadata"><p><b>{imported.name}</b> · {imported.address}</p><p>{types[imported.source_type]??'Тип источника не установлен'} · сведения не проверены</p><p>Застройщик: {imported.developer??'не установлен'} · БИН: {imported.developer_bin??'не установлен'}</p><p>Дата источника: {imported.observed_at??'неизвестна'} · получение: {imported.retrieved_at??'неизвестно'}</p><p>Способ получения: {imported.access_method==='egov_api'?'API data.egov.kz':'подготовленная выгрузка'}</p>{#if imported.geocoding}<p>Геокодирование: {imported.geocoding.provider} · {imported.geocoding.status==='matched'?'найдено точное совпадение':'требуется ручная проверка'}</p>{#if imported.geocoding.datasource?.attribution}<p>{imported.geocoding.datasource.attribution}</p>{/if}{/if}</div>{/if}
<p class="publication-text">{#if start>=0}{text.slice(0,start)}<mark>{text.slice(start,start+quote.length)}</mark>{text.slice(start+quote.length)}{:else}{text}{/if}</p>
<style>.import-metadata{border-left:3px solid #739781;padding:10px 14px;margin-bottom:16px;background:#f3f7f4;font-size:12px;line-height:1.7;overflow-wrap:anywhere}</style>
