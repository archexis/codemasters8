# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: supabase.spec.ts >> Supabase SDK login, server analysis, optimistic RPC save and logout
- Location: tests\cloud\supabase.spec.ts:4:1

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.click: Test timeout of 60000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Войти в систему' })

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - banner [ref=e3]:
    - link "S SAQ QURYLYS САҚ · МОНИТОРИНГ РИСКОВ" [ref=e4] [cursor=pointer]:
      - /url: "#/home"
      - generic [ref=e5]: S
      - generic [ref=e6]:
        - text: SAQ QURYLYS
        - generic [ref=e7]: САҚ · МОНИТОРИНГ РИСКОВ
    - navigation "Основная навигация" [ref=e8]:
      - link "Главная" [ref=e9] [cursor=pointer]:
        - /url: "#/home"
      - link "Объекты" [ref=e10] [cursor=pointer]:
        - /url: "#/overview"
      - link "Публикации" [ref=e11] [cursor=pointer]:
        - /url: "#/ads"
      - link "Проверка" [ref=e12] [cursor=pointer]:
        - /url: "#/analyze"
      - link "Реестры" [ref=e13] [cursor=pointer]:
        - /url: "#/registries"
      - link "Резервная копия" [ref=e14] [cursor=pointer]:
        - /url: "#/backup"
    - button "Демо-аналитик" [ref=e17] [cursor=pointer]
  - generic [ref=e18]:
    - generic [ref=e19]: SUPABASE · персональное рабочее пространство
    - generic [ref=e20]: Өскемен / Усть-Каменогорск
  - main [ref=e21]:
    - generic [ref=e22]:
      - generic [ref=e23]:
        - paragraph [ref=e24]: АНАЛИТИЧЕСКАЯ СИСТЕМА / ӨСКЕМЕН
        - heading [level=1] [ref=e25]:
          - text: Видеть риски.
          - emphasis [ref=e26]: Действовать вовремя.
        - paragraph [ref=e27]: От публикации о продаже квартиры — к проверяемому сигналу. Источники, факты и решения в одном рабочем пространстве.
        - generic [ref=e28]:
          - link "Открыть мониторинг ↗" [ref=e29] [cursor=pointer]:
            - /url: "#/overview"
          - link "Проверить объявление" [ref=e30] [cursor=pointer]:
            - /url: "#/analyze"
        - paragraph [ref=e31]: Решение принимает человек. Система не устанавливает факт правонарушения.
      - complementary [ref=e32]:
        - paragraph [ref=e33]: СВОДКА РИСКОВ
        - generic [ref=e34]:
          - text: "16"
          - generic [ref=e35]: объектовв мониторинге
        - generic [ref=e36]:
          - generic [ref=e38]: Красная зона
          - generic [ref=e39]: "1"
        - generic [ref=e40]:
          - generic [ref=e42]: Жёлтая зона
          - generic [ref=e43]: "3"
        - generic [ref=e44]:
          - generic [ref=e46]: Зелёная зона
          - generic [ref=e47]: "12"
        - paragraph [ref=e48]: Нулевой балл означает отсутствие подтверждённых факторов, а не доказанную безопасность.
    - generic [ref=e49]:
      - generic [ref=e50]: 01 Публикация
      - generic [ref=e51]: →
      - generic [ref=e52]: 02 Анализ и источники
      - generic [ref=e53]: →
      - generic [ref=e54]: 03 Решение аналитика
      - generic [ref=e55]: →
      - generic [ref=e56]: 04 Сигнал
    - generic [ref=e57]:
      - heading "Попробуйте прямо сейчас" [level=2] [ref=e58]
      - generic [ref=e59]:
        - text: Быстрая проверка фразы
        - textbox "Быстрая проверка фразы" [ref=e60]:
          - /placeholder: Бронь квартиры — 500 000 тенге
      - generic [ref=e61]:
        - button "Проверить фразу" [ref=e62] [cursor=pointer]
        - link "К полной проверке ↗" [ref=e63] [cursor=pointer]:
          - /url: "#/analyze?text="
    - generic [ref=e64]:
      - generic [ref=e65]:
        - paragraph [ref=e66]: ПРИОРИТЕТ ПРОВЕРКИ
        - heading "Объекты, требующие внимания" [level=2] [ref=e67]
      - link "Все объекты ↗" [ref=e68] [cursor=pointer]:
        - /url: "#/overview"
    - generic [ref=e69]:
      - link "70 · Красная Сарыарқа Парк пр. Вымышленный, 45 (DEMO) DEMO · вымышленный объект" [ref=e70] [cursor=pointer]:
        - /url: "#/detail/SQ-002"
        - generic [ref=e71]: 70 · Красная
        - heading "Сарыарқа Парк" [level=3] [ref=e72]
        - paragraph [ref=e73]: пр. Вымышленный, 45 (DEMO)
        - paragraph [ref=e74]: DEMO · вымышленный объект
      - link "40 · Жёлтая Наурыз Квартал ул. Праздничная вымышленная, 21 (DEMO) DEMO · вымышленный объект" [ref=e75] [cursor=pointer]:
        - /url: "#/detail/SQ-005"
        - generic [ref=e76]: 40 · Жёлтая
        - heading "Наурыз Квартал" [level=3] [ref=e77]
        - paragraph [ref=e78]: ул. Праздничная вымышленная, 21 (DEMO)
        - paragraph [ref=e79]: DEMO · вымышленный объект
      - link "35 · Жёлтая Ертіс Толқыны ул. Вымышленная, 12 (DEMO) DEMO · вымышленный объект" [ref=e80] [cursor=pointer]:
        - /url: "#/detail/SQ-001"
        - generic [ref=e81]: 35 · Жёлтая
        - heading "Ертіс Толқыны" [level=3] [ref=e82]
        - paragraph [ref=e83]: ул. Вымышленная, 12 (DEMO)
        - paragraph [ref=e84]: DEMO · вымышленный объект
    - generic [ref=e85]:
      - generic [ref=e86]:
        - heading "Объяснимый скоринг" [level=2] [ref=e87]
        - generic [ref=e88]:
          - generic [ref=e89]: R1 Отсутствие применимого законного основания
          - generic [ref=e90]: "+35"
        - generic [ref=e91]:
          - generic [ref=e92]: R2 Прямое предложение внести деньги
          - generic [ref=e93]: "+25"
        - generic [ref=e94]:
          - generic [ref=e95]: R3 Активная реклама строящегося жилья
          - generic [ref=e96]: "+10"
        - generic [ref=e97]:
          - generic [ref=e98]: R4 Коллективное обращение
          - generic [ref=e99]: "+15"
        - generic [ref=e100]:
          - generic [ref=e101]: R5 Разрыв готовности ≥20 п.п.
          - generic [ref=e102]: "+10"
        - generic [ref=e103]:
          - generic [ref=e104]: R6 Простой или просрочка
          - generic [ref=e105]: "+5"
        - paragraph [ref=e106]: "Красная зона: ≥60 и одновременно подтверждены R1 + R2. Гипотезы баллов не дают."
      - generic [ref=e107]:
        - heading "Контрольные сценарии" [level=2] [ref=e108]
        - 'link "A Ертіс Толқыны Исходный балл: 35 35" [ref=e109] [cursor=pointer]':
          - /url: "#/detail/SQ-001"
          - generic [ref=e110]: A
          - generic [ref=e111]:
            - text: Ертіс Толқыны
            - generic [ref=e112]: "Исходный балл: 35"
          - strong [ref=e113]: "35"
        - 'link "B Сарыарқа Парк Исходный балл: 70 70" [ref=e114] [cursor=pointer]':
          - /url: "#/detail/SQ-002"
          - generic [ref=e115]: B
          - generic [ref=e116]:
            - text: Сарыарқа Парк
            - generic [ref=e117]: "Исходный балл: 70"
          - strong [ref=e118]: "70"
        - 'link "C Достық Үйі Исходный балл: 10 10" [ref=e119] [cursor=pointer]':
          - /url: "#/detail/SQ-003"
          - generic [ref=e120]: C
          - generic [ref=e121]:
            - text: Достық Үйі
            - generic [ref=e122]: "Исходный балл: 10"
          - strong [ref=e123]: "10"
        - group [ref=e124]:
          - generic "Как работать с системой?" [ref=e125] [cursor=pointer]
    - generic [ref=e126]:
      - heading "Последние решения" [level=2] [ref=e127]
      - paragraph [ref=e128]: Новых решений в этом пространстве пока нет.
  - contentinfo [ref=e129]:
    - generic [ref=e130]: SAQ QURYLYS
    - paragraph [ref=e131]: Признаки → доказательства → решение человека
    - generic [ref=e132]: Codemasters 8.0 · Supabase
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test';
  2  | import { initialState, applyCommand } from '../../src/lib/domain';
  3  | import type { Command } from '../../src/lib/domain';
  4  | test('Supabase SDK login, server analysis, optimistic RPC save and logout', async ({page}) => {
  5  |   let data = initialState(); let version = 1; let sawAuthHeader = false;
  6  |   const user = {id:'11111111-1111-4111-8111-111111111111',email:'analyst@example.test',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-10-18T00:00:00Z'};
  7  |   await page.route('http://supabase.test/**', async route => {
  8  |     const request = route.request(); const path = new URL(request.url()).pathname;
  9  |     if (request.method()==='OPTIONS') return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,DELETE,OPTIONS'}});
  10 |     const headers = {'access-control-allow-origin':'*','content-type':'application/json'};
  11 |     const respond = (body:unknown,status=200) => route.fulfill({status,headers,body:JSON.stringify(body)});
  12 |     if (path==='/auth/v1/token') return respond({access_token:'test-access-token',refresh_token:'test-refresh-token',expires_in:3600,token_type:'bearer',user});
  13 |     if (path==='/auth/v1/user') return respond(user);
  14 |     if (path==='/auth/v1/logout') return respond({});
  15 |     if (path==='/rest/v1/workspaces') return respond({data,version});
  16 |     if (path==='/functions/v1/analyze') {
  17 |       sawAuthHeader = request.headers().authorization==='Bearer test-access-token';
  18 |       return respond({realAI:true,engine:'Test LLM via Edge',hypotheses:[{code:'R2',quote:'Депозит 456 000 тенге',reason:'Платёжное предложение'}]});
  19 |     }
  20 |     if (path==='/rest/v1/rpc/apply_command') {
  21 |       const body = request.postDataJSON() as {command:Command;expected_version:number};
  22 |       expect(body.expected_version).toBe(version);
  23 |       data = applyCommand(data,body.command,user.email); version++;
  24 |       return respond({data,version});
  25 |     }
  26 |     return respond({error:`Unexpected request ${path}`},500);
  27 |   });
  28 |   await page.goto('/');
> 29 |   await page.getByRole('button',{name:'Войти в систему'}).click();
     |                                                           ^ Error: locator.click: Test timeout of 60000ms exceeded.
  30 |   await page.getByLabel('Email',{exact:true}).fill(user.email);
  31 |   await page.getByLabel('Пароль',{exact:true}).fill('not-a-real-password');
  32 |   await page.getByRole('button',{name:'Войти',exact:true}).last().click();
  33 |   await expect(page.getByRole('heading',{name:'Видеть риски. Действовать вовремя.'})).toBeVisible();
  34 |   await page.goto('/#/analyze/SQ-001');
  35 |   await page.getByLabel('Текст объявления').fill('Депозит 456 000 тенге для квартиры.');
  36 |   await page.getByRole('button',{name:'Проанализировать',exact:true}).click();
  37 |   await expect(page.getByText('Test LLM via Edge')).toBeVisible();
  38 |   await page.getByRole('button',{name:'Подтвердить R2'}).click();
  39 |   await expect(page.getByText('Публикация и решение сохранены.')).toBeVisible();
  40 |   expect(sawAuthHeader).toBe(true); expect(data.ads[0].decision).toBe('confirmed');
  41 |   await page.reload();
  42 |   await page.getByRole('button',{name:user.email,exact:true}).click();
  43 |   await page.getByRole('button',{name:'Выйти',exact:true}).click();
  44 |   await expect(page.getByRole('heading',{name:'Рабочее пространство аналитика'})).toBeVisible();
  45 |   await expect(page.getByText('Депозит 456 000 тенге для квартиры.')).toHaveCount(0);
  46 | });
  47 | 
```