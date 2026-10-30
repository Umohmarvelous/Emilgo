// How a car moves (SPEC-V3 §5; Phase 5): pure, shared by the server's
// vehicles module and the phone that drives (it predicts its own car with
// this same code). Arcade, forward only: the stick points where to go, its
// push is the throttle, pulling back brakes. Steering is limited by speed
// (no turning on the spot) and by grip (no hairpins at top speed). Solid to
// the world as a row of circles; a gutter or the river stops it like a wall.

import { VEHICLES, type VehicleKind } from "../../config";
import type { Mover, Space } from "../core/space";

export interface Car {
  readonly index: number;
  readonly kind: VehicleKind;
  x: number;
  z: number;
  /** The ground under it. */
  h: number;
  heading: number;
  /** m/s, forward (there's no reverse). */
  speed: number;
  /** This step's turn, rad/s (the wheels, the lean). */
  turn: number;
  /** Seconds of driving left. */
  fuel: number;
  /** 0 … 100. */
  damage: number;
  /** 0 clean, 1 scratched, 2 smoking, 3 on fire, 4 blown up. */
  state: number;
  /** On fire: it blows at this (seconds of play); −1. */
  blow: number;
  /** Who sits where: [driver, passenger] body indexes, −1 empty. */
  readonly seats: [number, number];
  /** A hijack at the driver's door: who, since when. */
  hijack: { by: number; since: number } | null;
  /** Low-fuel beeps given (0–2). */
  beeps: number;
  hornAt: number;
  alarmAt: number;
}

/** What one step of driving did: the speed lost to a wall, and whether it touched one. */
export interface Driven {
  impact: number;
  contact: boolean;
}

const _m: Mover = { x: 0, z: 0, vx: 0, vz: 0, h: 0, y: 0, vy: 0, stance: 0 };

export const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export function newCar(index: number, kind: VehicleKind, x: number, z: number, h: number, heading: number): Car {
  return {
    index, kind, x, z, h, heading, speed: 0, turn: 0, fuel: VEHICLES.fuel.full, damage: 0, state: 0, blow: -1,
    seats: [-1, -1], hijack: null, beeps: 0, hornAt: -99, alarmAt: -99,
  };
}

/**
 * One step of driving: the stick (world space, length 0…1) steers toward
 * where it points and opens the throttle; `power` false (no driver, no fuel)
 * and it coasts. Then the world: walls slide it and cost it speed.
 */
export function driveCar(car: Car, ix: number, iz: number, power: boolean, dt: number, space: Space): Driven {
  const k = VEHICLES.kinds[car.kind];
  const mag = Math.min(1, Math.hypot(ix, iz));
  let want = 0;
  let rate: number = VEHICLES.coast;
  let steer = 0;
  if (power && mag > VEHICLES.deadStick) {
    const diff = wrap(Math.atan2(ix, iz) - car.heading);
    if (Math.abs(diff) > VEHICLES.brakeAt) rate = k.brake;
    else {
      // Turning hard, it slows.
      want = k.top * mag * Math.max(0.35, Math.cos(diff * 0.6));
      rate = want > car.speed ? k.accel : VEHICLES.coast;
      steer = diff;
    }
  }
  const dv = want - car.speed;
  car.speed += Math.max(-rate * dt, Math.min(rate * dt, dv));
  if (car.speed < 0.02 && want === 0) car.speed = 0;
  // No turning standing still, and no more sideways g than the tyres hold.
  const most = Math.min(k.turn, car.speed / k.minR, car.speed > 0.1 ? k.grip / car.speed : k.turn);
  const d = Math.max(-most * dt, Math.min(most * dt, steer));
  car.heading = wrap(car.heading + d);
  car.turn = dt > 0 ? d / dt : 0;
  const px = car.x;
  const pz = car.z;
  const ph = car.heading;
  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;
  return collideWorld(car, space, px, pz, ph);
}

/** Keep a car out of the world's walls (its circles; the biggest push wins), off gutters and out of the river. */
export function collideWorld(car: Car, space: Space, px: number, pz: number, ph: number): Driven {
  const k = VEHICLES.kinds[car.kind];
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  let best = 0;
  let bx = 0;
  let bz = 0;
  let floor = -Infinity;
  let sunk = false;
  for (const off of k.circles) {
    const cx = car.x + fx * off;
    const cz = car.z + fz * off;
    _m.x = cx;
    _m.z = cz;
    _m.vx = fx * car.speed;
    _m.vz = fz * car.speed;
    _m.h = car.h;
    _m.y = 0;
    _m.vy = 0;
    _m.stance = 0;
    space.resolve(_m, k.r);
    const dx = _m.x - cx;
    const dz = _m.z - cz;
    if (dx * dx + dz * dz > best) {
      best = dx * dx + dz * dz;
      bx = dx;
      bz = dz;
    }
    // A body steps down into a gutter; a car's wheel would only stick there.
    const f = space.floorAt(_m.x, _m.z, car.h + 0.3);
    if (f.h < car.h - 0.35 || f.water > 0.2) sunk = true;
    floor = Math.max(floor, f.h);
  }
  if (sunk) {
    const lost = car.speed;
    car.x = px;
    car.z = pz;
    car.heading = ph;
    car.speed = 0;
    car.turn = 0;
    return { impact: lost, contact: true };
  }
  if (isFinite(floor)) car.h = floor;
  if (best < 1e-8) return { impact: 0, contact: false };
  car.x += bx;
  car.z += bz;
  const d = Math.sqrt(best);
  const nx = bx / d;
  const nz = bz / d;
  const vx = fx * car.speed;
  const vz = fz * car.speed;
  const vn = vx * nx + vz * nz;
  if (vn >= 0) return { impact: 0, contact: true };
  // What's left after the wall takes the part into it; a glancing blow turns it along the wall.
  const ux = vx - vn * nx;
  const uz = vz - vn * nz;
  const left = Math.max(0, ux * fx + uz * fz);
  const lost = car.speed - left;
  car.speed = left;
  if (left > 0.5) {
    const along = wrap(Math.atan2(ux, uz) - car.heading);
    if (Math.abs(along) < 1.2) car.heading = wrap(car.heading + along * 0.25);
  }
  return { impact: lost, contact: true };
}

/** A point in the car's frame (x to its right, z to its nose) in the world. */
export function carPoint(car: Car, lx: number, lz: number): [number, number] {
  const s = Math.sin(car.heading);
  const c = Math.cos(car.heading);
  return [car.x + c * lx + s * lz, car.z - s * lx + c * lz];
}

/** The side a seat's door is on: −1 left (the driver: Nigerian roads drive on the right), +1 right. */
export function doorSide(kind: VehicleKind, seat: number): number {
  const sx = VEHICLES.kinds[kind].seats[seat][0];
  return sx < 0 ? -1 : sx > 0 ? 1 : seat === 0 ? -1 : 1;
}

/** Standing outside a seat's door. */
export function doorPoint(car: Car, seat: number, out = 0.45): [number, number] {
  const k = VEHICLES.kinds[car.kind];
  return carPoint(car, doorSide(car.kind, seat) * (k.wid / 2 + out), k.seats[seat][1]);
}

/** How far (x, z) is from the car's body (its nearest circle's edge). */
export function carGap(car: Car, x: number, z: number): number {
  const k = VEHICLES.kinds[car.kind];
  let best = Infinity;
  for (const off of k.circles) best = Math.min(best, Math.hypot(car.x + Math.sin(car.heading) * off - x, car.z + Math.cos(car.heading) * off - z) - k.r);
  return Math.max(0, best);
}
