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

let threw = false;
try { parseAdText("   "); } catch { threw = true; }
ok(threw, "empty text throws");

console.log("\nPASS · " + n + " checks");
