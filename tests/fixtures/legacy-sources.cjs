// SAQ QURYLYS — sources v3: platforms, messenger cues, CSV, related, dedupe.
const { parseAdText, detectPlatform, parseCsvAds, relatedAds, normPhone, dedupeKey } = require("../js/parser.js");

let n = 0, fail = 0;
function ok(cond, label) {
  n++;
  if (cond) console.log("  ok " + n + " · " + label);
  else { fail++; console.log("  FAIL " + n + " · " + label); }
}

// --- platform detection ---
ok(detectPlatform({ url: "https://krisha.kz/a/show/123" }).key === "krisha", "krisha by url");
ok(detectPlatform({ url: "https://www.instagram.com/p/x" }).key === "instagram", "instagram by url");
ok(detectPlatform({ url: "https://t.me/demo_channel" }).key === "telegram", "telegram by t.me url");
ok(detectPlatform({ url: "https://wa.me/77001234567" }).key === "whatsapp", "whatsapp by wa.me url");
ok(detectPlatform({ url: "https://olx.kz/obyavlenie/1" }).key === "olx", "olx by url");
ok(detectPlatform({ platform: "Telegram-канал", text: "продажа" }).key === "telegram", "telegram by hint");
ok(detectPlatform({ platform: "Krisha", text: "" }).key === "krisha", "krisha by manual hint");
ok(detectPlatform({}).key === "unknown", "unknown when empty");
ok(detectPlatform({ platform: "Мой блокнот" }).key === "other", "other keeps manual label");

// --- messenger payment cues (kaspi) ---
let r = parseAdText("Квартира в строящемся доме. Перевод на каспи 500 000 тенге, остаток потом.");
ok(r.payment.flagged, "kaspi transfer flagged");
ok(r.payment.quotes[0].indexOf("каспи") >= 0, "kaspi quote is verbatim substring");
r = parseAdText("Скиньте предоплату на карту, номер карты в личке.");
ok(r.payment.flagged, "card number flagged");
r = parseAdText("Квартиры в строящемся доме. Все вопросы — в директ, пишите в личку.");
ok(!r.payment.flagged, "direct alone is not payment");
ok(r.channel.flagged, "direct flagged as channel");
ok(r.entities.some((e) => e.type === "channel"), "channel entity present");
r = parseAdText("Напишите в WhatsApp, покажем документы.");
ok(!r.payment.flagged, "whatsapp alone is not payment");
ok(r.channel.flagged, "whatsapp flagged as channel");

// --- normPhone / dedupe ---
ok(normPhone("+7 701 123-45-67") === "+77011234567", "normPhone +7 format");
ok(normPhone("87011234567") === "+77011234567", "normPhone 8-prefix");
ok(normPhone("abc") === null, "normPhone junk null");
const adA = { id: "X1", text: "Бронь 500 000 тенге. Звоните +7 701 111-22-33!" };
const adB = { id: "X2", text: "Бронь 500 000 тенге. Звоните 8 701 111 22 33!" };
ok(dedupeKey(adA) === dedupeKey(adB), "dedupe same phone+head");
ok(dedupeKey(adA) !== dedupeKey({ id: "X3", text: "Совсем другой текст без телефона" }), "dedupe differs");

// --- relatedAds ---
const ads = [
  { id: "AD-1", text: "Продажа. Звоните +7 701 111-22-33", account: "@seller1", url: "https://krisha.kz/a/1" },
  { id: "AD-2", text: "Та же квартира, цена ниже. Тел. 87011112233", account: "@other", url: "https://olx.kz/x" },
  { id: "AD-3", text: "Другой объект, другой телефон +7 702 000-00-00", account: "@seller1", url: "https://x.kz" },
  { id: "AD-4", text: "Ничего общего", account: "@nobody", url: "https://y.kz" },
];
let rel = relatedAds(ads[0], ads);
ok(rel.some((x) => x.id === "AD-2" && /телефон/.test(x.via)), "related by phone across formats");
ok(rel.some((x) => x.id === "AD-3" && /аккаунт/.test(x.via)), "related by account");
ok(!rel.some((x) => x.id === "AD-4"), "unrelated excluded");
ok(!rel.some((x) => x.id === "AD-1"), "self excluded");

// --- CSV ---
let csv = parseCsvAds("текст;площадка;аккаунт;дата;ссылка\nПродажа, бронь 500 000 тенге;Krisha;@s1;2026-10-01;https://krisha.kz/a/1\nВторой текст;Telegram;@s2;2026-10-02;https://t.me/x");
ok(csv.rows.length === 2, "csv semicolon 2 rows");
ok(csv.rows[0].platform === "Krisha" && csv.rows[0].url === "https://krisha.kz/a/1", "csv columns mapped");
ok(csv.errors.length === 0, "csv no errors");
csv = parseCsvAds("text,platform\n\"Продажа, с запятой внутри\",Krisha");
ok(csv.rows.length === 1 && csv.rows[0].text === "Продажа, с запятой внутри", "csv quoted comma");
let threw = "";
try { parseCsvAds("platform\nKrisha"); } catch (e) { threw = e.message; }
ok(/текста/.test(threw), "csv missing text column throws");

console.log(fail ? ("FAIL · " + fail + " of " + n) : ("PASS · " + n + " checks"));
process.exit(fail ? 1 : 0);
