// SAQ QURYLYS — tests for the real local parser.
// Run: node tests/test-parser.cjs
const assert = require("node:assert");
const { parseAdText } = require("../js/parser.js");

let n = 0;
const ok = (cond, name) => { n++; assert.ok(cond, "FAIL: " + name); console.log("  ok " + n + " · " + name); };
const types = (r) => Object.fromEntries(r.entities.map((e) => [e.type + ":" + e.value, e]));

let r = parseAdText("Бронь квартиры — 500 000 тенге! Звоните +7 701 123 45 67. Сдача в 2027 году.");
ok(r.payment.flagged, "payment flagged");
ok(r.entities.some((e) => e.type === "money" && /500 000/.test(e.value)), "money extracted");
ok(r.entities.some((e) => e.type === "money" && e.confidence === "high"), "money+payment = high");
ok(r.entities.some((e) => e.type === "phone" && e.value.includes("701")), "phone extracted");
ok(r.entities.some((e) => e.type === "date" && /2027/.test(e.value)), "year extracted");

r = parseAdText("Готовность уже 41%! Запись на экскурсию.");
ok(r.entities.some((e) => e.type === "readiness" && e.value === "41%" && e.confidence === "high"), "readiness high with готов");

r = parseAdText("Оплата через эскроу. Никаких взносов до договора!");
ok(!r.payment.flagged, "negated payment clean");
ok(r.entities.some((e) => e.type === "legal" && /эскроу/i.test(e.value)), "escrow mention kept as entity");

r = parseAdText("Оплата напрямую застройщику, не через эскроу.");
ok(r.payment.flagged, "denied escrow flagged");

r = parseAdText("Пәтер брондау — 500 000 теңге. Төлем тек шарт бойынша.");
ok(r.payment.flagged, "KZ payment flagged");

r = parseAdText("Төлем тек шарт бойынша, алдын ала төлем жоқ. Брондау тегін!");
ok(!r.payment.flagged, "KZ negated clean");

r = parseAdText("Пишите в Telegram @demo_sales_1, подробности https://example.invalid/x.");
ok(r.entities.some((e) => e.type === "contact" && e.value.includes("@demo_sales_1")), "handle extracted");
ok(r.entities.some((e) => e.type === "contact" && e.value.startsWith("https://")), "url extracted");

for (const e of r.entities) ok(typeof e.quote === "string" && e.quote.length > 0, "quote present: " + e.type);

r = parseAdText("Оплата до заключения договора, остаток потом.");
ok(r.payment.flagged, "payment before contract flagged");

r = parseAdText("Бронь бесплатная, все платежи только по договору.");
ok(!r.payment.flagged, "free booking + contract-only clean");

r = parseAdText("Договор бронирования: задаток 800 000 тенге. Пишите в личку.");
ok(r.payment.flagged, "reservation agreement flagged");
ok(r.payment.cues.length > 0, "payment cues listed");

console.log("parser v2:");
const spanInput = "Бронь квартиры — 500 000 тенге! Звоните +7 701 123 45 67.";
r = parseAdText(spanInput);
for (const e of r.entities) {
  ok(Array.isArray(e.span) && e.span[1] > e.span[0], "span present: " + e.type);
  ok(spanInput.slice(e.span[0], e.span[1]).length > 0, "span points into text: " + e.type);
}
ok(r.engine === "local-parser-v2", "engine version tag");

r = parseAdText("Бронь — 500 000 тенге, квартиры от 15 млн тенге.");
const m1 = r.entities.find((e) => e.type === "money" && /500 000/.test(e.value));
ok(m1 && m1.valueKzt === 500000, "money normalized 500000 KZT");
const m2 = r.entities.find((e) => e.type === "money" && /15 млн/.test(e.value));
ok(m2 && m2.valueKzt === 15000000, "money normalized 15 mln KZT");

r = parseAdText("Квартира 42,5 кв. м, готовность 41%.");
ok(r.entities.some((e) => e.type === "area"), "area extracted");

r = parseAdText("Инвестируйте на котловане — доходность до 30%!");
ok(!r.payment.flagged, "lure is not payment flag");
ok(r.entities.some((e) => e.type === "lure"), "lure entity kept");

r = parseAdText("Номер разрешения ДПГ-25-16-078/194, срок сдачи 2026 год.");
ok(r.entities.some((e) => e.type === "legal" && /ДПГ/.test(e.value)), "permit number extracted");

r = parseAdText("Первый взнос — 2 млн, оплата наличными в офисе.");
ok(r.payment.flagged, "first payment + cash flagged");

r = parseAdText("Төлем қолма-қол, бағаны бекітеміз.");
ok(r.payment.flagged, "KZ cash flagged");

r = parseAdText("Пишите на info@example.kz, сдача через 18 месяцев, ключи весной.");
ok(r.entities.some((e) => e.type === "contact" && /info@example/.test(e.value)), "email extracted");
ok(r.entities.some((e) => e.type === "date" && /через 18 месяцев/.test(e.value)), "relative term extracted");
ok(r.entities.some((e) => e.type === "date" && /весной/.test(e.value)), "season extracted");

r = parseAdText("Успейте! Осталось 3 квартиры, цены ниже рынка.");
ok(!r.payment.flagged, "urgency without money is not payment");
ok(r.entities.filter((e) => e.type === "lure").length >= 2, "urgency lures kept");

r = parseAdText("Бронь 500 000 тенге. Оплата переводом на карту. Сдача в 2027 году, однушка 42 кв. м, info@x.kz, +7 701 123 45 67.");
for (const e of r.entities) {
  ok(spanInput2Ok(r, e), "span valid in mixed ad: " + e.type);
}
function spanInput2Ok(rr, e) { return Array.isArray(e.span) && e.span[1] > e.span[0]; }
ok(["money", "phone", "date", "area", "contact"].every((t) => r.entities.some((e) => e.type === t)), "mixed ad: all types found");

let threw = false;
try { parseAdText("   "); } catch { threw = true; }
ok(threw, "empty text throws");

console.log("\nPASS · " + n + " checks");
