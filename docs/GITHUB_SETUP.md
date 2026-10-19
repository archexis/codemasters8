# Оформление репозитория на GitHub

README, CONTRIBUTING, SECURITY и `.github/ISSUE_TEMPLATE/` формируют страницу проекта и сценарии участия после попадания в default branch. Шаблон PR находится в `.github/pull_request_template.md`.

## Поля About

Владелец или участник с нужными правами может заполнить [страницу репозитория](https://github.com/archexis/codemasters8):

| Поле | Готовое значение |
| --- | --- |
| Description | SAQ QURYLYS — мониторинг рисков долевого строительства: карта объектов, проверка публикаций, объяснимый скоринг и версии решений. |
| Website | `https://saq-qurylys-pi.vercel.app` |
| Topics | `svelte`, `typescript`, `supabase`, `fastapi`, `maplibre`, `kazakhstan`, `construction`, `risk-analysis`, `human-in-the-loop` |

Через CLI из аккаунта с нужными правами:

```sh
gh repo edit archexis/codemasters8 --description "SAQ QURYLYS — мониторинг рисков долевого строительства: карта объектов, проверка публикаций, объяснимый скоринг и версии решений." --homepage "https://saq-qurylys-pi.vercel.app" --add-topic svelte,typescript,supabase,fastapi,maplibre,kazakhstan,construction,risk-analysis,human-in-the-loop
```

## Параметры владельца

- Включить private vulnerability reporting, если проект готов принимать обращения; порядок описан в `SECURITY.md`.
- Добавить правила default branch и обязательные CI jobs `frontend`, `backend`, `edge`, когда определён порядок выпуска.
- Согласовать лицензию с правообладателем. Лицензионный badge добавляется после LICENSE.
- Для social preview использовать проверенный снимок DEMO без секретов и рабочих данных.

Эти настройки не применяются commit. Доступный при подготовке документации аккаунт имеет `push`, но не `admin`/`maintain`; описание, Website и topics оставлены для владельца. Изменение default branch, переименование проекта и выпуск релиза для принятия документации не требуются.
