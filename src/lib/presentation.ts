export const legalBasisLabel=(type:string)=>({'unknown':'Не установлено','absent':'Отсутствие проверено','guarantee':'Гарантия Единого оператора','mio-permit':'Разрешение МИО'}[type]??'Неизвестно');
export const sourceOriginLabel=(origin?:string)=>({'manual':'Ручной ввод','import':'Импорт','demo':'DEMO','official':'Официальный источник'}[origin??'manual']??'Происхождение неизвестно');
export const sourceAvailabilityLabel=(status?:string)=>({'ok':'Копия сохранена','unavailable':'Источник недоступен','needs_auth':'Нужен вход в источник'}[status??'ok']??'Доступность неизвестна');
