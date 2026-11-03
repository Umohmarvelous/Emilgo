// Placed spots in a grid, so "is anything too close?" looks at the few
// nearby cells, not every spot so far (v4 Phase 10: the big world's scatter
// was quadratic, seconds per match start). The test itself is the caller's,
// on exactly the spots within reach, so the answers (and every copy's
// scatter) are the same as a scan over the whole list.

export class SpotGrid {
  private readonly cells = new Map<number, number[]>();
  constructor(private readonly size: number) {}

  private key(ix: number, iz: number): number {
    return (ix + 32768) * 65536 + (iz + 32768);
  }

  add(x: number, z: number): void {
    const k = this.key(Math.floor(x / this.size), Math.floor(z / this.size));
    let c = this.cells.get(k);
    if (!c) this.cells.set(k, (c = []));
    c.push(x, z);
  }

  /** Any spot within r (by the caller's own test) of x, z? */
  any(x: number, z: number, r: number, test: (sx: number, sz: number) => boolean): boolean {
    const n = Math.ceil(r / this.size);
    const ix = Math.floor(x / this.size);
    const iz = Math.floor(z / this.size);
    for (let dx = -n; dx <= n; dx++)
      for (let dz = -n; dz <= n; dz++) {
        const c = this.cells.get(this.key(ix + dx, iz + dz));
        if (!c) continue;
        for (let i = 0; i < c.length; i += 2) if (test(c[i], c[i + 1])) return true;
      }
    return false;
  }
}
