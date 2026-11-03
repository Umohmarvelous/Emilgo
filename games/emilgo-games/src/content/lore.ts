// Dead Streets' lore (SPEC-V3 §3.4 #7): 24 things found on the way that tell
// how the outbreak began — radio broadcasts, diary pages, newspaper cuttings.
// Original writing; no invented brand, station or masthead names (the owner's
// rule), so the papers are "a cutting" and the radio is "the radio".

export interface Lore {
  kind: "radio" | "diary" | "cutting";
  text: { en: string; pcm: string };
}

export const LORE: readonly Lore[] = [
  { kind: "radio", text: { en: "…reports of a strange fever at the motor park. Travellers are asked to stay calm and keep to their buses.", pcm: "…dem dey talk say strange fever dey motor park. Make passengers calm down, stay for their bus." } },
  { kind: "diary", text: { en: "Day 1. The conductor coughed all the way from the junction. His eyes were grey. Nobody wanted to sit near him.", pcm: "Day 1. Conductor cough from junction reach here. Him eye don grey. Nobody wan siddon near am." } },
  { kind: "cutting", text: { en: "HOSPITAL WING CLOSED. Visitors turned away as staff report patients 'not themselves'.", pcm: "DEM DON LOCK HOSPITAL WING. Visitors no fit enter; staff talk say patients 'no be themselves again'." } },
  { kind: "radio", text: { en: "…the generator room at the hospital failed at midnight. We are told the doors were opened from the inside.", pcm: "…hospital gen room spoil for midnight. Dem talk say na from inside dem open the door." } },
  { kind: "diary", text: { en: "Day 2. Mama says pray and stay indoors. I can hear dragging feet on the zinc all night.", pcm: "Day 2. Mama talk make we pray, stay inside. I dey hear leg dey drag for zinc whole night." } },
  { kind: "cutting", text: { en: "Night market traders flee as crowd 'that does not speak' moves through the stalls.", pcm: "Night market traders run as crowd wey 'no dey talk' waka pass for inside stalls." } },
  { kind: "radio", text: { en: "If you can hear this: churches and mosques are safe. They will not come inside. Nobody knows why.", pcm: "If you dey hear this: church and mosque safe. Dem no dey enter inside. Nobody sabi why." } },
  { kind: "diary", text: { en: "Day 3. The bell at the cathedral stopped. The quiet is worse than the bell.", pcm: "Day 3. Cathedral bell don stop. The quiet worse pass the bell." } },
  { kind: "cutting", text: { en: "Tank farm fire burns for a second day. Fire service cannot reach the gate.", pcm: "Fire for tank farm still dey burn second day. Fire service no fit reach gate." } },
  { kind: "radio", text: { en: "…rescue will come to the broadcast mast. Make your way there. Light a flare. Hold on.", pcm: "…rescue go come broadcast mast. Find your way reach there. Light flare. Hold body." } },
  { kind: "diary", text: { en: "Day 4. Bros Tunde went to the pools for water. He came back walking wrong.", pcm: "Day 4. Bros Tunde go pool go fetch water. E come back dey waka anyhow." } },
  { kind: "cutting", text: { en: "Farm edge: residents warn of 'hands in the water'. Ponds fenced off.", pcm: "Farm side: people warn say 'hand dey inside water'. Dem don fence the pond." } },
  { kind: "radio", text: { en: "…do not run near them. Noise brings more. Walk. Crouch. Breathe.", pcm: "…no run near dem. Noise dey bring more. Waka. Bend down. Breathe." } },
  { kind: "diary", text: { en: "Day 5. A man in a carved mask walked past the window. Torchlight did nothing to him.", pcm: "Day 5. One man wear carved mask waka pass window. Torch no do am anything." } },
  { kind: "cutting", text: { en: "Railway cutting blocked by abandoned carriages. Passengers 'never got off'.", pcm: "Abandoned train block railway cutting. Passengers 'no ever comot'." } },
  { kind: "radio", text: { en: "…the big ones charge in a straight line. Step aside and let the wall stop them.", pcm: "…the big ones dey rush straight. Shift for side, make wall stop dem." } },
  { kind: "diary", text: { en: "Day 6. Grandma hid her tin box under the floorboards and chalked a mark on the wall. She said I would know it.", pcm: "Day 6. Grandma hide her tin box under floor, chalk mark for wall. She talk say I go know am." } },
  { kind: "cutting", text: { en: "Uncompleted estate: squatters report screaming that 'calls the others'.", pcm: "Uncompleted estate: people wey dey squat talk say one dey shout wey 'dey call others'." } },
  { kind: "radio", text: { en: "…the swollen ones burst when they fall. Keep your distance. The gas burns the eyes.", pcm: "…the ones wey swell dey burst when dem fall. Stay far. The gas dey pepper eye." } },
  { kind: "diary", text: { en: "Day 7. The bike couriers were the first to change. They still run like they have somewhere to be.", pcm: "Day 7. Bike delivery boys na dem first change. Dem still dey run like say dem get where dem dey go." } },
  { kind: "cutting", text: { en: "Old mosque courtyard shelters dozens. 'They stop at the gate,' says the imam.", pcm: "Old mosque courtyard dey cover plenty people. 'Dem dey stop for gate,' imam talk." } },
  { kind: "radio", text: { en: "…the mast's generator is on. The gate is slow. When you get there, hold the line until it opens.", pcm: "…mast gen don on. The gate dey slow. When you reach there, hold ground till e open." } },
  { kind: "diary", text: { en: "Day 8. I can see the red light on the mast from the roof. Tomorrow I go.", pcm: "Day 8. I dey see red light for mast from roof. Tomorrow I go go." } },
  { kind: "cutting", text: { en: "Last edition: 'Stay together. Help each other. The city is not lost.'", pcm: "Last paper: 'Stay together. Help each other. The city never lost.'" } },
];
