// SAQ QURYLYS — boundary tests for the scoring engine + seed consistency.
// Run: node tests/test-scoring.cjs   (exit 0 = all pass)
const assert = require("node:assert");
const { computeScore } = require("../js/scoring.js");

// stub browser globals, then load seed
global.window = {};
require("../js/data.js");
const { COMPLEXES, ADS, REGISTRIES } = global.window.SQ_SEED;

let n = 0;
const ok = (cond, name) => { n++; assert.ok(cond, "FAIL: " + name); console.log("  ok " + n + " · " + name); };
const C = (code) => ({ code, status: "confirmed" });
const H = (code) => ({ code, status: "hypothesis" });
const N = (code) => ({ code, status: "needs-verification" });

console.log("rule engine:");
ok(computeScore([]).score === 0 && computeScore([]).zone === "green", "empty -> 0 green");
ok(computeScore([C("R3")]).score === 10, "R3 alone = 10");
ok(JSON.stringify(computeScore([C("R2"), C("R3")])) !== "", "R2+R3 computes");

// unknown / hypothesis never scores
ok(computeScore([N("R1"), H("R2"), C("R3")]).score === 10, "hypothesis + needs-verification give 0");
ok(computeScore([N("R1"), C("R2"), C("R3")]).score === 35, "unknown legal basis is NOT R1");
ok(computeScore([{ code: "R2", status: "rejected" }, C("R3")]).score === 10, "rejected gives 0");

// zones
ok(computeScore([C("R2"), C("R3")]).zone === "yellow", "35 -> yellow");
ok(computeScore([C("R1"), C("R2"), C("R3")]).zone === "red", "70 with R1+R2 -> red");
ok(computeScore([C("R1"), C("R3"), C("R4"), C("R5"), C("R6")]).zone === "yellow", "75 without R2 -> yellow (not red)");
ok(computeScore([C("R2"), C("R3"), C("R4"), C("R5"), C("R6")]).zone === "yellow", "65 without R1 -> yellow (not red)");
ok(computeScore([C("R1"), C("R2"), C("R3"), C("R4"), C("R5"), C("R6")]).score === 100, "cap at 100");
ok(computeScore([C("R3"), C("R4")]).score === 25 && computeScore([C("R3"), C("R4")]).zone === "yellow", "25 -> yellow boundary");
ok(computeScore([C("R3"), C("R4"), C("R6")]).score === 30, "30 yellow");
ok(computeScore([C("R1")]).score === 35 && computeScore([C("R1")]).zone === "yellow", "R1 alone = 35 yellow, never red without R2");
ok(computeScore([C("R2")]).score === 25 && computeScore([C("R2")]).zone === "yellow", "R2 alone = 25 yellow");
ok(computeScore([C("R1"), C("R2")]).score === 60 && computeScore([C("R1"), C("R2")]).zone === "red", "R1+R2 = 60 red (minimum red)");
ok(computeScore([C("R1"), C("R3"), C("R4")]).score === 60 && computeScore([C("R1"), C("R3"), C("R4")]).zone === "yellow", "60 without R2 -> yellow (not red)");
ok(computeScore([H("R1"), C("R2"), C("R3")]).score === 35 && computeScore([H("R1"), C("R2"), C("R3")]).zone === "yellow", "unconfirmed R1 hypothesis + R2 + R3 = 35 yellow (AI must not score)");
ok(computeScore([C("R4"), C("R6")]).score === 20 && computeScore([C("R4"), C("R6")]).zone === "green", "20 -> green (below 25)");
ok(computeScore([C("R5"), C("R3"), C("R6")]).score === 25 && computeScore([C("R5"), C("R3"), C("R6")]).zone === "yellow", "25 -> yellow boundary");

console.log("scenarios A/B/C from seed:");
const score = (id) => computeScore(COMPLEXES.find((z) => z.id === id).factors);
let s = score("SQ-001");
ok(s.score === 35 && s.zone === "yellow", "A: SQ-001 = 35 yellow");
s = score("SQ-002");
ok(s.score === 70 && s.zone === "red", "B: SQ-002 = 70 red");
ok(COMPLEXES.find((z) => z.id === "SQ-002").factors.find((f) => f.code === "R5").status !== "confirmed", "B: R5 stays hypothesis");
s = score("SQ-003");
ok(s.score === 10 && s.zone === "green", "C: SQ-003 = 10 green");
ok(!COMPLEXES.find((z) => z.id === "SQ-003").factors.some((f) => f.code === "R1"), "C: no R1 from missing MIO permit");

console.log("seed integrity:");
ok(COMPLEXES.length >= 8, ">= 8 complexes, got " + COMPLEXES.length);
ok(ADS.length >= 12, ">= 12 ads, got " + ADS.length);
ok(COMPLEXES.every((z) => z.origin === "scenario" || z.origin === "public-snapshot"), "every complex has provenance origin");
const real = COMPLEXES.filter((z) => z.origin === "public-snapshot");
ok(real.length >= 5, ">= 5 public-snapshot rows, got " + real.length);
ok(real.every((z) => z.legalBasis && z.legalBasis.status === "verified" && /Ashyq Data/.test(z.legalBasis.source || "")), "snapshots carry registry permit source");
ok(real.every((z) => z.retrieved !== undefined || (z.sources || []).some((s) => /Ashyq Data/.test(s.title || ""))), "snapshots traceable to Ashyq dataset");
ok(real.every((z) => computeScore(z.factors).score === 0), "snapshots score 0 (no ads attached, nothing to judge)");
ok(["SQ-001", "SQ-002", "SQ-003"].every((id) => COMPLEXES.find((z) => z.id === id).origin === "scenario"), "A/B/C stay labeled scenarios");
ok(ADS.every((a) => COMPLEXES.some((z) => z.id === a.zkId)), "every ad links to a known ZK");
ok(COMPLEXES.every((z) => ADS.some((a) => a.zkId === z.id) || z.id === "SQ-004" || z.origin === "public-snapshot"), "every scenario ZK (except control SQ-004) has >= 1 ad; snapshots need none");
ok(COMPLEXES.filter((z) => typeof z.lat === "number").length >= 13, "coords present (scenarios + geocoded snapshots)");
ok(COMPLEXES.some((z) => typeof z.lat !== "number"), "one ZK without coords (map honesty case)");
ok(new Set(COMPLEXES.map((z) => z.bin).filter(Boolean)).size === COMPLEXES.filter((z) => z.bin).length, "BINs unique where present (snapshots carry hashed BINs -> null)");
ok(!/(?<!вымышлен)(?<!демо)(?<!DEMO)(Астана|Алматы)/i.test(JSON.stringify(COMPLEXES)), "no real-city claims beyond demo framing");

console.log("registries (organizer list):");
const REG_HOSTS = ["homeportal.kz", "elicense.kz", "qazreestr.kz", "reestr.equrylys.kz", "egov.kz", "kgd.gov.kz", "rsp.gov.kz", "map.gov4c.kz", "data.egov.kz", "procurement.gov.kz", "ashyq.data.gov.kz"];
ok(Array.isArray(REGISTRIES) && REGISTRIES.length >= 11, ">= 11 registry links, got " + (REGISTRIES || []).length);
for (const h of REG_HOSTS) ok(REGISTRIES.some((r) => (r.url || "").includes(h)), "registry present: " + h);
ok(REGISTRIES.every((r) => r.name && r.url && r.note), "every registry has name + url + note");

console.log("AI demo-heuristic (labeled, negation-aware):");
global.localStorage = { getItem: () => null, setItem: () => {} };
require("../js/ai.js");
const H_AN = global.window.SQ_AI.heuristicAnalyze;
const aiCases = [
  ["paid booking flagged", "Бронь квартиры — всего 500 000 тенге, сумма в зачёт!", true],
  ["deposit flagged", "Депозит 1 000 000 тенге для фиксации цены.", true],
  ["reservation agreement flagged", "Задаток 800 000 тенге, договор бронирования.", true],
  ["negated взносы clean", "Оплата через эскроу. Никаких взносов до договора!", false],
  ["free booking clean", "Бронь бесплатная, все платежи только по договору.", false],
  ["mixed: free + paid", "Бронь бесплатная. Первоначальный взнос 2 000 000 тенге напрямую застройщику.", true],
  ["escrow payment clean", "Взнос через эскроу по договору.", false],
  ["denied escrow flagged", "Оплата напрямую застройщику, не через эскроу.", true],
  ["KZ booking flagged", "Пәтер брондау — 500 000 теңге, бағаны бекіту үшін!", true],
  ["KZ advance payment flagged", "Алдын ала төлем 1 000 000 теңге застройщикке.", true],
  ["KZ negated clean", "Төлем тек шарт бойынша, алдын ала төлем жоқ. Брондау тегін!", false],
  ["KZ no-escrow flagged", "Эскроу жоқ, төлем қолма-қол кассирге.", true],
  ["cyrillic suffix оплата (\\w-trap regression)", "Оплата напрямую застройщику.", true],
  ["cyrillic suffix первоначальный", "Первоначальный взнос застройщику до договора.", true],
];
for (const [name, text, exp] of aiCases) {
  const r = H_AN(text);
  ok((r.hypotheses.length > 0) === exp, name);
  ok(r.realAI === false && /demo/i.test(r.engine), name + " labeled demo");
  if (r.hypotheses.length) ok(text.includes(r.hypotheses[0].exact_quote.replace(/…$/, "")), name + " quote is verbatim substring");
}

console.log("\nPASS · " + n + " checks");
