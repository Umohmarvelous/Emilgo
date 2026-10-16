// Chat filter cases: what must be hidden, and banter that must NOT be.
// Run from the repo root:  npx tsx games/emilgo-games/scripts/filter-test.ts
import { filterChat } from "../src/social/filter";
const cases: [string, boolean][] = [
  ["you be mumu o 😂", false], ["olodo, waka faster", false], ["I like grapes and drapes", false],
  ["the truth is ododo", false], ["I live for Omole estate", false], ["tell your mother I said hi", false],
  ["is hit by the doll", false], ["Scunthorpe", false], ["oboe player", false], ["photo time", false],
  ["fuuuck this doll", true], ["sh1t", true], ["f u c k", true], ["omo ale", true], ["you are an ashawo", true],
  ["call me 0803 123 4567", true], ["send to 0123456789 GTB", true], ["www.scam.ng pay here", true],
  ["email me ada@mail.com", true], ["follow @lagosboy", true], ["visit bit.ly/xyz", true], ["+2348031234567", true],
];
let bad = 0;
for (const [msg, shouldChange] of cases) {
  const r = filterChat(msg);
  const ok = r.changed === shouldChange;
  if (!ok) bad++;
  console.log(`${ok ? "✓" : "✗"} ${JSON.stringify(msg).padEnd(32)} → ${JSON.stringify(r.text)}`);
}
console.log(bad ? `${bad} WRONG` : "all as expected");
process.exit(bad ? 1 : 0);
