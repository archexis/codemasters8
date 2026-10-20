import { expect, type Page } from '@playwright/test';
export async function manualCase(page:Page, complexId='SQ-003', quote='Платная бронь квартиры 612 000 тенге.', code='R2', attachment=false) {
  await page.goto(`/#/publications?add=1&complex=${complexId}`, {waitUntil:'domcontentloaded'});
  await page.getByLabel('Текст объявления',{exact:true}).fill(quote);
  await page.getByLabel('Дата публикации (пусто — не указана)',{exact:true}).fill('2026-10-19');
  await page.getByLabel('Площадка',{exact:true}).fill('Источник проверки');
  if(attachment) await page.getByLabel('Скриншот / документ').setInputFiles({name:'connected-proof.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')});
  await page.getByRole('button',{name:'Сохранить материал без AI',exact:true}).click();
  await expect(page.getByText(/Материал сохранён:/)).toBeVisible();
  await page.goto(`/#/complexes/${complexId}?tab=verification`,{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Начать расследование',exact:true}).click();
  await expect(page.getByRole('region',{name:'Автоматическая подготовка расследования'}).getByRole('status')).toContainText('Подготовка завершена',{timeout:30000});
  const manual=page.locator('details').filter({has:page.getByText('Выделить утверждение вручную',{exact:true})});
  await manual.locator('summary').click();
  await manual.getByLabel('Первичный материал').selectOption({label:'Источник проверки'});
  await manual.getByLabel('Фактор').selectOption(code);
  await manual.getByLabel('Точная цитата',{exact:true}).fill(quote);
  await manual.getByRole('button',{name:'Создать кандидата',exact:true}).click();
  await expect(page.locator('.hypothesis').filter({hasText:quote})).toContainText('Кандидат');
}
export function manualCandidate(page:Page,quote='Платная бронь квартиры 612 000 тенге.') {
  return page.locator('.hypothesis').filter({has:page.locator('blockquote').filter({hasText:quote})});
}
export async function verifyFact(page:Page, code='R2', attachment=false,quote='Платная бронь квартиры 612 000 тенге.') {
  const candidate=code==='R2'?manualCandidate(page,quote):page.locator('.hypothesis').filter({has:page.getByRole('button',{name:`Подтвердить факт ${code}`,exact:true})});
  await candidate.getByLabel('Обоснование проверки факта',{exact:true}).fill('Сверено с первоисточником');
  await candidate.getByRole('button',{name:`Подтвердить факт ${code}`,exact:true}).click();
}
