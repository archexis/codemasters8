# Конкретные пробелы текущего кода

Статические наблюдения на 18.10.2026. Это основания для воспроизведений, не результаты уже выполненных exploit/E2E-тестов.

| ID | Место | Наблюдение | Задача |
|---|---|---|---|
| B01 | domain/SQL validate_factor, Detail | Ручной R2 требует непустой quote, но не проверяет исходную публикацию и её ЖК | S1.2 |
| B02 | ComplexForm, complex command | Меняется legalBasis.status, а type может остаться unknown/guarantee; нет строгой пары и полной даты | S1.1 |
| B03 | domain complex | Замена источника отсутствия при сохранении absent-verified не отзывает R1 | S1.3 |
| B04 | validateFactor | R3/R4/R6 принимаются со строкой source; R5 не проверяет источники обоих чисел | S1.2–3 |
| B05 | domain/SQL commands | Нет полной runtime-схемы команд; TS и SQL отличаются в ID, URL, допустимых значениях | S1.1, S3.2 |
| B06 | repository saveCommand | Нет commandId и durable receipt для повтора после потерянного ответа | S2.2 |
| B07 | repository loadState | Проверяются только верхние массивы; нет schemaVersion и миграции вложенных данных | S2.1 |
| B08 | Analyze save | Ad/решение и saved=true сохраняются до загрузки файла отдельной командой | S2.3 |
| B09 | domain signal, Signal | Единственный signal перезаписывается; audit содержит команду, не полный снимок прошлого решения | S2.4, S5.1 |
| B10 | Detail signal | Снимок Complex, но ads, верхний заголовок/score берутся из текущего состояния | S5.1–2 |
| B11 | parser dedupeKey, SQL ad | TS нормализует телефоны, SQL — только регистр/пробелы; дедуп сейчас глобальный между ЖК | S3.2 |
| B12 | Analyze selectRow | Неизвестный zkHint сохраняет предыдущий ЖК; пустая дата может сохранить дату предыдущей строки | S3.3 |
| B13 | Analyze run/save | Snapshot только text/zk; метаданные редактируются отдельно; нет abort при unmount | S4.3 |
| B14 | Analyze, Analysis | Один saved/decision на ad при нескольких гипотезах; первое решение блокирует остальные | S4.2 |
| B15 | Edge handler | Нет runId/inputHash/promptVersion; любая ошибка quota выдаётся за 429 | S4.1 |
| B16 | database.test.ts | Только две hardcoded миграции; второй тест зависит от состояния первого | S0.2 |
| B17 | seed.json, SQL seed | Seed не валидирован новыми правилами; R3 SQ-001 требует сверки цитаты с AD-001 | S1.4 |
| B18 | FastAPI summary | Отдельная формула Python, нет общего golden corpus с TS | S1.5 |

В этой подготовке check и 28 unit-тестов PASS. STACK_MIGRATION содержит прошлые результаты local/E2E/DeepSeek, но они не закрывают новый gate. Не запускать платный AI на каждой правке. Не сбрасывать/очищать чужую незакоммиченную работу.

Первичный источник: `C:/Users/BIGra/Downloads/Telegram Desktop/Кейс Codemasters 8.0. SAQ (1).pdf`, §5–7. §5 перечитан: R5 — разница от 20 п.п. с двумя источниками/датами; R6 не задаёт числовой порог. Это требования продукта, не актуальное юридическое заключение.

Для grants/RLS и Storage проверены [RLS docs](https://supabase.com/docs/guides/database/postgres/row-level-security) и [Storage access control](https://supabase.com/docs/guides/storage/security/access-control): проверять и доступность операции, и ограничения на свои данные. Перед реализацией SQL следовать установленному Supabase skill; применённые миграции не переписывать.
