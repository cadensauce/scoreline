// Parity check: models/wp.js must reproduce the Python backtest predictions on held-out states.
// Usage: node model/check_js.mjs nfl
import fs from "node:fs";
import vm from "node:vm";

const sport = process.argv[2];
const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
vm.runInThisContext(fs.readFileSync(root + "models/wp.js", "utf8"));
const WP = globalThis.ScorelineWP;
WP._set(sport, JSON.parse(fs.readFileSync(root + `models/wp-${sport}.json`, "utf8")));
const { cases } = JSON.parse(fs.readFileSync(root + `model-out/cases-${sport}.json`, "utf8"));
let worst = 0, bad = 0, nulls = 0;
for (const c of cases) {
  const got = sport === "f1" ? WP.f1(c.state)?.[c.driver] : WP[sport](c.state);
  if (got === null || got === undefined) { nulls++; continue; }
  const d = Math.abs(got - c.expected);
  worst = Math.max(worst, d);
  if (d > 1e-6) bad++;
}
console.log(`${sport}: ${cases.length} cases, max |js - python| = ${worst.toExponential(2)}, >1e-6: ${bad}, null: ${nulls}`);
if (nulls || bad > cases.length * 0.002 || worst > 1e-3) process.exit(1);
