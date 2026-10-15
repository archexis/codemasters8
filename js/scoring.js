// SAQ QURYLYS — deterministic risk scoring engine.
// Pure functions, no DOM, no network. Shared by browser UI and node tests.
// Spec: R1..R6 weights, only "confirmed" factors count, unknown = 0 + "needs verification".

const WEIGHTS = Object.freeze({ R1: 35, R2: 25, R3: 10, R4: 15, R5: 10, R6: 5 });

const FACTOR_META = Object.freeze({
  R1: { code: "R1", points: 35, title: "Отсутствие применимого законного основания", hint: "Только при проверенном отсутствии. «Нет данных» ≠ R1." },
  R2: { code: "R2", points: 25, title: "Прямое предложение внести деньги", hint: "Платная бронь, депозит, первоначальный взнос и аналогичные." },
  R3: { code: "R3", points: 10, title: "Активная реклама строящегося жилья", hint: "Продвижение квартир до ввода объекта в эксплуатацию." },
  R4: { code: "R4", points: 15, title: "Подтверждённое коллективное обращение", hint: "Проверенное обращение о привлечении средств по объекту." },
  R5: { code: "R5", points: 10, title: "Разрыв заявленной и подтверждённой готовности ≥20 п.п.", hint: "Оба значения с источниками и датами." },
  R6: { code: "R6", points: 5, title: "Подтверждённый простой / значимая просрочка", hint: "Документированное отклонение от сроков или простой." },
});

// statuses: "confirmed" | "hypothesis" | "rejected" | "needs-verification"
function confirmedPoints(factors) {
  let sum = 0;
  const confirmed = [];
  for (const f of factors || []) {
    if (f && f.status === "confirmed" && WEIGHTS[f.code]) {
      sum += WEIGHTS[f.code];
      confirmed.push(f.code);
    }
  }
  return { sum, confirmed };
}

function computeScore(factors) {
  const { sum, confirmed } = confirmedPoints(factors);
  const score = Math.min(100, sum);
  const hasR1 = confirmed.includes("R1");
  const hasR2 = confirmed.includes("R2");
  let zone = "green";
  if (score >= 60 && hasR1 && hasR2) zone = "red";
  else if (score >= 25) zone = "yellow";
  return { score, zone, confirmed, pending: pendingCodes(factors) };
}

function pendingCodes(factors) {
  const out = [];
  for (const f of factors || []) {
    if (f && (f.status === "hypothesis" || f.status === "needs-verification")) out.push(f.code);
  }
  return out;
}

function zoneLabel(zone) {
  return zone === "red" ? "Красная" : zone === "yellow" ? "Жёлтая" : "Зелёная";
}

// Browser + node interop
if (typeof module !== "undefined" && module.exports) {
  module.exports = { WEIGHTS, FACTOR_META, computeScore, confirmedPoints, pendingCodes, zoneLabel };
}
if (typeof window !== "undefined") window.SQ_Scoring = { WEIGHTS, FACTOR_META, computeScore, pendingCodes, zoneLabel };
