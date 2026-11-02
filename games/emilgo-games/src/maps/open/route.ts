// Spooky World's route (SPEC-V3 §3.1), corner by corner (each leg is a
// street): on its own so the results' run map can draw it without loading the
// city's builder.

export const SPOOKY_ROUTE: readonly [number, number][] = [
  [-130, -135], [-130, -95], [-70, -95], [-70, -140], [0, -140], [0, -100], [60, -100], [60, -140], [130, -140], [130, -70],
  [80, -70], [80, -20], [130, -20], [130, 40], [60, 40], [0, 40], [0, -30], [-60, -30], [-60, 40], [-130, 40], [-130, 110],
  [-40, 110], [-40, 140], [60, 140], [125, 140],
];
