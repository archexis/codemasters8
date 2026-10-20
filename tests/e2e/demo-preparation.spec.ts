import {expect,test} from '@playwright/test';

test('each demo preparation adds one different source and candidate, with no extra source on reload',async({page})=>{
  await page.goto('/#/complexes/SQ-003?tab=verification');
  await page.getByRole('button',{name:'Начать расследование',exact:true}).click();
  const panel=page.getByRole('region',{name:'Автоматическая подготовка расследования'});
  const texts=new Set<string>();
  for(let pass=1;pass<=3;pass++){
    if(pass>1)await panel.getByRole('button',{name:'Подготовить материалы',exact:true}).click();
    await expect(panel.getByRole('status')).toContainText('Подготовка завершена',{timeout:15000});
    await expect(panel.getByText('Добавлен 1 новый демо-материал на проверку.',{exact:true})).toBeVisible();
    const demo=await page.evaluate(()=>{
      const state=JSON.parse(localStorage.getItem('sq_svelte_demo_v2')!).state;
      const artifacts=state.artifacts.filter((a:any)=>a.id.startsWith('DEMO-'));
      return {artifacts,claims:state.claims.filter((c:any)=>artifacts.some((a:any)=>a.id===c.artifactId)),assertions:state.assertions??[]};
    });
    expect(demo.artifacts).toHaveLength(pass);expect(demo.claims).toHaveLength(pass);
    expect(demo.assertions).toHaveLength(0);
    texts.add(demo.artifacts.at(-1).text);expect(texts.size).toBe(pass);
    expect(demo.claims.every((c:any)=>!c.triage&&!c.runId)).toBe(true);
  }
  await page.reload();
  await expect(page.locator('.hypothesis')).toHaveCount(3);
  await expect(panel.locator('.demo-steps .done')).toHaveCount(4);
});
