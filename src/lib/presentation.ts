import seed from './seed.json' with {type:'json'};
import type {Ad} from './types';
export const legalBasisLabel=(type:string)=>({'unknown':'Не установлено','absent':'Отсутствие проверено','guarantee':'Гарантия Единого оператора','mio-permit':'Разрешение МИО'}[type]??'Неизвестно');
export const sourceOriginLabel=(origin?:string)=>({'manual':'Ручной ввод','import':'Импорт','demo':'DEMO','official':'Официальный источник'}[origin??'manual']??'Происхождение неизвестно');
export const sourceAvailabilityLabel=(status?:string)=>({'ok':'Копия сохранена','unavailable':'Источник недоступен','needs_auth':'Нужен вход в источник'}[status??'ok']??'Доступность неизвестна');

export const verificationLabel = (status: string) => ({
  unknown: 'Не установлено', verified: 'Проверено', 'absent-verified': 'Отсутствие проверено',
  candidate: 'Требует проверки', rejected: 'Отклонено', confirmed: 'Подтверждено',
  draft: 'В работе', returned: 'Возвращён на проверку',
}[status] ?? 'Требует проверки');
export const artifactKindLabel = (kind: string) => ({
  publication: 'Публикация', document: 'Документ', relationship: 'Материал о связи',
  event: 'Событие', observation: 'Наблюдение', 'legal-review': 'Правовая сверка',
}[kind] ?? 'Материал');
export const relationLabel = (type: string) => ({
  developer_of: 'Застройщик', authorized_company_of: 'Уполномоченная компания',
  contractor_of: 'Подрядчик', advertises: 'Рекламирует', covered_by: 'Основание',
  mentions: 'Упоминание', same_ad_account: 'Общий рекламный аккаунт', located_on: 'Расположение',
}[type] ?? 'Связь');
/** Date-only evidence stays date-only. Decision timestamps have an explicit UTC zone. */
export function decisionTime(value?: string): string {
  if (!value) return 'Дата неизвестна';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

/** Compact previews of unchanged bundled examples; preserve the stored original. */
export function publicationExcerpt(ad:Ad):string {
  const demo=seed.ADS.some(source=>source.id===ad.id && source.text===ad.text);
  const text=demo?ad.text.replace(/^ВЫМЫШЛЕННЫЙ МАТЕРИАЛ\.\s*/,'').split(' Реальны только координаты стройплощадки.')[0]:ad.text;
  return text.length>500?text.slice(0,500)+'…':text;
}
