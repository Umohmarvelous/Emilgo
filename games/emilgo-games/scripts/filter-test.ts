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
  // v6 max (3.11): addresses go; game talk about roads and numbers stays.
  ["I live at No 5 Adeola Street", true], ["come to 12 Allen Avenue now", true], ["my address is lekki phase one", true],
  ["plot 7 lekki phase 1 estate", true], ["we dey stay for 14 Bode Thomas", true], ["block 4 flat 2 Ikota Way", true],
  ["3 kills on the road", false], ["meet at the 2nd road by the river", false], ["I got 5 treasures near the estate", false],
  ["Harbour Yard has 2 boards", false], ["No 1 player in the hunt", false],
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
