# E2E-отчёт SAQ QURYLYS

Дата: 19 октября 2026. Проверен локальный checkout `29344252e26b4efe35262f7ef7610b4db3c1a2f5` с текущим незакоммиченным `src/app.css` (SHA-256 `5e2d48c2791a049b448429c8fa2e6186bd926e57f68b837a184d3108465e3463`). Исходники приложения и штатные тесты не менялись. Данные Playwright изолированы в новых browser contexts и DEMO localStorage; платный AI и рабочие backend/DB не использовались.

## Результаты

### Родительский прогон текущих UX E2E-файлов

Команда:

```powershell
npx playwright test tests/e2e/ux-target.spec.ts tests/e2e/ux-review.spec.ts tests/e2e/ux-geometry.spec.ts --grep-invert 'target map: one X-Ray theme' --reporter=line --max-failures=4
```

Результат из родительского процесса: **21 passed, 3 failed**, 2.6 минуты. Ошибки: desktop тест 2.5D нажимал отключённую кнопку в WebGL fallback; desktop и mobile тест fallback карты не могли нажать zoom из-за перекрытия `.map-tools`/поиском. Полный регрессионный набор приложения этим не является.

### Повторный запуск штатных UX-файлов в этом чате

Команда:

```powershell
npx playwright test tests/e2e/ux-target.spec.ts tests/e2e/ux-review.spec.ts tests/e2e/ux-geometry.spec.ts --grep-invert 'target map: one X-Ray theme' --reporter=json --output=output/playwright/e2e-luna-20261019/current-ux-results --max-failures=4
```

Playwright сообщил **4 failed, 1 interrupted, 3 did not run**; JSON-статистика — `expected=0`, `unexpected=4`, `skipped=20`. Это повтор оказался загрязнён тестовым окружением: он писал traces/screenshots в `output/` во время работы Vite, а каталог не исключён из наблюдения. Trace содержит повторные подключения Vite и большое число отменённых запросов; screenshots показывают пустую страницу. Этот запуск не использую как свидетельство дефекта приложения.

### Изолированный сквозной smoke, desktop и mobile

Команда после переноса тестовых артефактов в игнорируемый `test-results/`:

```powershell
npx playwright test --config output/playwright/e2e-luna-20261019/playwright.config.ts --max-failures=4
```

Результат: **6 passed, 2 failed, 0 skipped**, 44.3 секунды. В каждом проекте прошли три сценария:

- ручная публикация → ручное создание R2-кандидата → подтверждение факта аналитиком → пересчёт 0 → 25 → подтверждение сигнала, версия 1 → reload → сохранённые цитата и 25 баллов → печать в A4 PDF;
- возврат пустого сигнала с причиной и сохранение версии/причины после reload;
- WebGL fallback: видна 2D-карта, маркеры, выбор объекта открывает предпросмотр досье, режимы 2.5D/3D корректно отключены.

Два отказа — проверка реального pointer click по zoom в WebGL fallback:

- desktop: `.map-tools.map-float-top` перехватывает pointer events над кнопкой «Приблизить»;
- mobile: pointer events перехватывает поле поиска внутри `.map-tools`.

Это воспроизводимый дефект расположения/перекрытия элементов в fallback, а не ограничение отсутствующего WebGL: DOM-карта и маркеры отрисованы, кнопка видима и enabled, но реальный pointer click до неё не доходит.

PDF, созданные Chrome print pipeline, проверены `pdfinfo`: каждый файл A4, **2 страницы**, без шифрования.

## Ограничения доказательств

- DEMO-путь проверен без внешнего AI; он использует ручной текст/материалы.
- Обычный MapLibre/2.5D путь не подтверждён в этом headless окружении: браузер перешёл в fallback, где приложение правильно выключило 2.5D. Это ограничение проверки WebGL, а не доказательство ошибки 2.5D реализации.
- Штатная UX серия завершилась в родительском чате с 21/3; отдельный успешный smoke подтверждает актуальный ручной end-to-end путь и печать. Полный регрессионный набор не запускался.

## Артефакты

- JSON итог фокусного smoke: `test-results/e2e-luna-20261019/flow-report.json`.
- Desktop PDF: `output/playwright/e2e-luna-20261019/pdf/confirmed-chromium.pdf`.
- Mobile PDF: `output/playwright/e2e-luna-20261019/pdf/confirmed-mobile.pdf`.
- Desktop zoom failure screenshot/trace/context: `test-results/e2e-luna-20261019/artifacts/current-flow-WebGL-fallbac-a273a-ceives-a-real-pointer-click-chromium/`.
- Mobile zoom failure screenshot/trace/context: `test-results/e2e-luna-20261019/artifacts/current-flow-WebGL-fallbac-a273a-ceives-a-real-pointer-click-mobile/`.
- Фокусные E2E спецификация и отдельная конфигурация: `current-flow.spec.ts`, `playwright.config.ts` в этой папке.
