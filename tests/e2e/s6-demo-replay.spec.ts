import {test,expect} from '@playwright/test';
import {readFileSync,mkdirSync} from 'node:fs';
test('S6 reserve screens replay the exact archived synthetic connected case',async({page},info)=>{
 const r=JSON.parse(readFileSync('docs/acceptance/s5/connected.json','utf8'));
 mkdirSync('docs/acceptance/s6/demo',{recursive:true});
 const z=r.returned.snapshot;
 const signal={status:r.returned.status,at:r.returned.at,reviewer:r.returned.reviewer,comment:r.returned.comment,snapshot:z,basedOnRevision:r.returned.basedOnRevision};
 const state={schemaVersion:3,complexes:[z],ads:r.returned.ads,media:[],signals:{[r.zkId]:signal},signalVersions:{[r.zkId]:[r.v1,r.returned]},audit:r.returned.decisionAudit};
 await page.addInitScript(state=>{localStorage.setItem('sq_svelte_demo_v2',JSON.stringify({envelope:1,state,version:1,receipts:{}}));},state);
 for(const [name,route,text] of [['01-case','detail/'+r.zkId,z.name],['02-publication','ads',r.run.input_snapshot.text],['03-v1','signal/'+r.zkId+'?revision=1','70'],['04-returned','signal/'+r.zkId+'?revision=2','45']]) {
  await page.goto('/#/'+route);await expect(page.locator('main')).toContainText(text);
  await page.evaluate(()=>{const b=document.createElement('p');b.textContent='REPLAY · архив synthetic connected кейса S5-f1827716 · не live inference';b.style.cssText='background:#ffdf80;color:#111;padding:12px;position:sticky;top:0;z-index:9999';document.body.prepend(b);});
  await page.screenshot({path:`docs/acceptance/s6/demo/${name}-${info.project.name}.png`,fullPage:true});
 }
});
