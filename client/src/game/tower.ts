import Matter from 'matter-js';
import type { TowerState, WireBody } from '../../../shared/protocol';
import type { CardId } from '../../../shared/rules';
import {
  BASE_CELLS,
  CELL,
  FLAG,
  FX_BITS,
  FX_WORRIED,
  GIANT_SCALE,
  PIECES,
  WIDE_BASE_CELLS,
  centroid,
  makeBag,
  mulberry32,
  type TimedEffect,
} from './pieces';

const { Bodies, Body, Composite, Constraint, Engine, Query } = Matter;

export const STEP_MS = 1000 / 60;

const GAP = 1; // les cases physiques sont un poil plus petites que la grille
const FALL_SPEED = 1.7; // pixels par pas de simulation
const SOFT_DROP = 5;
const SLOW_FACTOR = 0.45;
const TURBO_FACTOR = 2.2;
const MAX_IMPACT_SPEED = 5;
const SPAWN_DELAY_MS = 380;
const SPAWN_ABOVE = 11 * CELL;
const MIN_SPAWN_HEIGHT = 13 * CELL;
const LOST_Y = 7 * CELL;
const LOST_X = 16 * CELL;
const MOVE_LIMIT = 6 * CELL;
const BASE_THICKNESS = 20;
const SETTLE_MS = 250;
const SETTLE_SPEED = 0.9;
const SETTLE_SPIN = 0.04;
const WIND_DRIFT = 1.3;
const WIND_PUSH = 0.0009;
const WELD_GIVE_UP_MS = 2000;

const DURATIONS: Record<TimedEffect, number> = {
  slow: 8000,
  turbo: 8000,
  invert: 5000,
  fog: 6000,
  wide: 10000,
  wind: 1200,
};

interface Brick {
  id: number;
  type: number;
  scale: number;
  body: Matter.Body;
  soapy: boolean;
  glued: boolean;
  wantsGlue: boolean;
  placedAt: number;
  welds: Matter.Constraint[];
}

interface Active {
  brick: Brick;
  /** rotation en quarts de tour */
  r: number;
  px: number;
  py: number;
}

export interface RenderBody {
  id: number;
  type: number;
  x: number;
  y: number;
  angle: number;
  flags: number;
}

export type TowerEvent =
  | { type: 'spawn' | 'move' | 'rotate' | 'blocked' }
  | { type: 'land'; x: number; y: number }
  | { type: 'lost'; x: number }
  | { type: 'eaten' | 'glue'; x: number; y: number };

export class Tower {
  readonly effects: Record<TimedEffect, number> = { slow: 0, turbo: 0, invert: 0, fog: 0, wide: 0, wind: 0 };
  readonly pending = { glue: false, soap: false, giant: false };
  height = 0;
  lean = 0;
  worried = false;
  nextType: number;
  baseCells = BASE_CELLS;

  private readonly engine: Matter.Engine;
  private readonly onEvent: (event: TowerEvent) => void;
  private readonly bag: () => number;
  private readonly rand: () => number;
  private base: Matter.Body;
  private bricks: Brick[] = [];
  private active: Active | null = null;
  private lastPlaced: Brick | null = null;
  private time = 0;
  private spawnIn = 0;
  private nextId = 1;
  private running = false;
  private soft = false;
  private windDir = 1;

  constructor(seed: number, onEvent: (event: TowerEvent) => void = () => {}) {
    this.onEvent = onEvent;
    this.bag = makeBag(seed);
    this.rand = mulberry32(seed ^ 0x51ed);
    this.nextType = this.bag();
    this.engine = Engine.create({ positionIterations: 10, velocityIterations: 8 });
    this.base = this.makeBase(BASE_CELLS);
    Composite.add(this.engine.world, this.base);
  }

  // --- cycle de vie --------------------------------------------------------

  start(): void {
    this.running = true;
    this.spawnIn = 0;
  }

  /** Fige la tour : plus de nouvelles parts, celle en cours disparaît. */
  stop(): void {
    this.running = false;
    this.active = null;
  }

  step(): void {
    this.time += STEP_MS;
    this.tickEffects();
    if (this.running && !this.active) {
      this.spawnIn -= STEP_MS;
      if (this.spawnIn <= 0) this.spawn();
    }
    if (this.active) this.advanceActive(this.active);
    if (this.effects.wind > 0) this.blowTop();
    Engine.update(this.engine, STEP_MS);
    this.tryWelds();
    this.collectLost();
    this.measure();
  }

  // --- commandes -----------------------------------------------------------

  move(direction: -1 | 1, half: boolean): void {
    const active = this.active;
    if (!active) return;
    const dir = this.effects.invert > 0 ? -direction : direction;
    const step = (half ? CELL / 2 : CELL) * dir;
    const target = active.px + step;
    if (Math.abs(target) > MOVE_LIMIT || !this.tryPose(active, target, active.py, active.r)) {
      this.onEvent({ type: 'blocked' });
      return;
    }
    this.onEvent({ type: 'move' });
  }

  rotate(): void {
    const active = this.active;
    if (!active) return;
    const r = (active.r + 1) % 4;
    const kicks = [0, CELL / 2, -CELL / 2, CELL, -CELL];
    const done = kicks.some((kick) => this.tryPose(active, active.px + kick, active.py, r));
    this.onEvent({ type: done ? 'rotate' : 'blocked' });
  }

  setSoftDrop(on: boolean): void {
    this.soft = on;
  }

  applyCard(card: CardId): void {
    switch (card) {
      case 'caramel':
        if (this.active) this.active.brick.wantsGlue = true;
        else this.pending.glue = true;
        break;
      case 'beurre':
        if (this.active) this.makeSoapy(this.active.brick);
        else this.pending.soap = true;
        break;
      case 'chef':
        this.pending.giant = true;
        break;
      case 'plat':
        this.effects.wide = DURATIONS.wide;
        this.setBaseCells(WIDE_BASE_CELLS);
        break;
      case 'fourchette':
        this.eatLast();
        break;
      case 'neige':
        this.effects.slow = DURATIONS.slow;
        break;
      case 'feu':
        this.effects.turbo = DURATIONS.turbo;
        break;
      case 'farine':
        this.effects.fog = DURATIONS.fog;
        break;
      case 'rhum':
        this.effects.invert = DURATIONS.invert;
        break;
      case 'air':
        this.effects.wind = DURATIONS.wind;
        this.windDir = this.rand() < 0.5 ? -1 : 1;
        break;
    }
  }

  // --- lecture -------------------------------------------------------------

  get windDirection(): number {
    return this.effects.wind > 0 ? this.windDir : 0;
  }

  get hasActive(): boolean {
    return this.active !== null;
  }

  /** Durée totale d'un effet, pour dessiner sa jauge. */
  static duration(effect: TimedEffect): number {
    return DURATIONS[effect];
  }

  bodies(): RenderBody[] {
    const list = this.bricks.map((brick) => this.describe(brick, false));
    if (this.active) list.push(this.describe(this.active.brick, true));
    return list;
  }

  wire(): TowerState {
    const b = this.bodies().map(
      (body): WireBody => [
        body.id,
        body.type,
        Math.round(body.x),
        Math.round(body.y),
        Math.round(body.angle * 100),
        body.flags,
      ],
    );
    let fx = 0;
    for (const name of Object.keys(FX_BITS) as TimedEffect[]) {
      if (this.effects[name] > 0) fx |= FX_BITS[name];
    }
    if (this.worried) fx |= FX_WORRIED;
    return { h: Math.round(this.height * 10) / 10, b, bw: this.baseCells, fx };
  }

  // --- part en cours de chute ---------------------------------------------

  private spawn(): void {
    const type = this.nextType;
    this.nextType = this.bag();
    const scale = this.pending.giant ? GIANT_SCALE : 1;
    const brick = this.makeBrick(type, scale);
    if (this.pending.soap) this.makeSoapy(brick);
    brick.wantsGlue = this.pending.glue;
    this.pending.giant = false;
    this.pending.soap = false;
    this.pending.glue = false;

    const top = Math.max(this.height * CELL + SPAWN_ABOVE, MIN_SPAWN_HEIGHT);
    const px = PIECES[type].half ? CELL / 2 : 0;
    this.active = { brick, r: 0, px, py: -top };
    this.pose(this.active);
    this.onEvent({ type: 'spawn' });
  }

  private advanceActive(active: Active): void {
    let speed = FALL_SPEED;
    if (this.effects.slow > 0) speed *= SLOW_FACTOR;
    if (this.effects.turbo > 0) speed *= TURBO_FACTOR;
    if (this.soft) speed *= SOFT_DROP;

    if (this.effects.wind > 0) {
      const drifted = active.px + this.windDir * WIND_DRIFT;
      if (Math.abs(drifted) <= MOVE_LIMIT) this.tryPose(active, drifted, active.py, active.r);
    }

    if (this.tryPose(active, active.px, active.py + speed, active.r)) {
      if (active.py > LOST_Y) {
        this.active = null;
        this.spawnIn = SPAWN_DELAY_MS;
        this.onEvent({ type: 'lost', x: active.px });
      }
      return;
    }
    this.release(active, speed);
  }

  private release(active: Active, speed: number): void {
    const { brick } = active;
    Body.setVelocity(brick.body, { x: 0, y: Math.min(speed, MAX_IMPACT_SPEED) });
    Body.setAngularVelocity(brick.body, 0);
    Composite.add(this.engine.world, brick.body);
    brick.placedAt = this.time;
    this.bricks = [...this.bricks, brick];
    this.lastPlaced = brick;
    this.active = null;
    this.spawnIn = SPAWN_DELAY_MS;
    const { x, y } = brick.body.position;
    this.onEvent({ type: 'land', x, y });
  }

  /** Place la part si la pose est libre ; sinon la laisse où elle était. */
  private tryPose(active: Active, px: number, py: number, r: number): boolean {
    const previous = { px: active.px, py: active.py, r: active.r };
    Object.assign(active, { px, py, r });
    this.pose(active);
    if (!this.overlaps(active.brick.body)) return true;
    Object.assign(active, previous);
    this.pose(active);
    return false;
  }

  private pose(active: Active): void {
    const { brick, r, px, py } = active;
    const angle = (r * Math.PI) / 2;
    const c = centroid(brick.type);
    const size = CELL * brick.scale;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    Body.setAngle(brick.body, angle);
    Body.setPosition(brick.body, {
      x: px + (c.x * cos - c.y * sin) * size,
      y: py + (c.x * sin + c.y * cos) * size,
    });
  }

  private overlaps(body: Matter.Body): boolean {
    return this.touching(body).length > 0;
  }

  private touching(body: Matter.Body): Matter.Body[] {
    const others = [this.base, ...this.bricks.map((b) => b.body)].filter((other) => other !== body);
    const found = new Set<Matter.Body>();
    for (const part of body.parts.slice(1)) {
      for (const hit of Query.collides(part, others)) {
        const other = hit.bodyA.parent === body ? hit.bodyB.parent : hit.bodyA.parent;
        found.add(other);
      }
    }
    return [...found];
  }

  // --- fabrication ---------------------------------------------------------

  private makeBase(cells: number): Matter.Body {
    return Bodies.rectangle(0, BASE_THICKNESS / 2, cells * CELL, BASE_THICKNESS, {
      isStatic: true,
      friction: 1,
      frictionStatic: 1.2,
    });
  }

  private makeBrick(type: number, scale: number): Brick {
    const size = CELL * scale;
    const material = { friction: 0.8, frictionStatic: 1, frictionAir: 0.012, restitution: 0, density: 0.0015 };
    const parts = PIECES[type].cells.map(([cx, cy]) =>
      Bodies.rectangle(cx * size, cy * size, size - GAP, size - GAP, material),
    );
    const body = Body.create({ parts, ...material });
    const id = this.nextId;
    this.nextId += 1;
    return { id, type, scale, body, soapy: false, glued: false, wantsGlue: false, placedAt: 0, welds: [] };
  }

  private makeSoapy(brick: Brick): void {
    brick.soapy = true;
    for (const part of brick.body.parts) {
      part.friction = 0.02;
      part.frictionStatic = 0;
    }
  }

  private setBaseCells(cells: number): void {
    if (this.baseCells === cells) return;
    Composite.remove(this.engine.world, this.base);
    this.base = this.makeBase(cells);
    this.baseCells = cells;
    Composite.add(this.engine.world, this.base);
  }

  // --- cartes --------------------------------------------------------------

  private tickEffects(): void {
    for (const name of Object.keys(this.effects) as TimedEffect[]) {
      if (this.effects[name] <= 0) continue;
      this.effects[name] = Math.max(0, this.effects[name] - STEP_MS);
      if (name === 'wide' && this.effects.wide === 0) this.setBaseCells(BASE_CELLS);
    }
  }

  /** Le courant d'air bouscule un peu la part du sommet, sans la faire tomber seule. */
  private blowTop(): void {
    const top = this.bricks.reduce<Brick | null>(
      (best, brick) => (!best || brick.body.position.y < best.body.position.y ? brick : best),
      null,
    );
    if (!top || top.glued) return;
    Body.applyForce(top.body, top.body.position, { x: this.windDir * WIND_PUSH * top.body.mass, y: 0 });
  }

  private eatLast(): void {
    const target =
      this.lastPlaced && this.bricks.includes(this.lastPlaced)
        ? this.lastPlaced
        : this.bricks.reduce<Brick | null>((best, b) => (!best || b.placedAt > best.placedAt ? b : best), null);
    if (!target) return;
    const { x, y } = target.body.position;
    this.removeBrick(target);
    this.onEvent({ type: 'eaten', x, y });
  }

  /** Soude une part caramélisée à ce qu'elle touche, une fois posée. */
  private tryWelds(): void {
    for (const brick of this.bricks) {
      if (!brick.wantsGlue) continue;
      const age = this.time - brick.placedAt;
      if (age < SETTLE_MS) continue;
      if (brick.body.speed > SETTLE_SPEED && age < WELD_GIVE_UP_MS) continue;
      brick.wantsGlue = false;

      const neighbours = new Set<Matter.Body>();
      for (const [dx, dy] of [[0, 4], [3, 0], [-3, 0]]) {
        Body.translate(brick.body, { x: dx, y: dy });
        for (const other of this.touching(brick.body)) neighbours.add(other);
        Body.translate(brick.body, { x: -dx, y: -dy });
      }
      if (neighbours.size === 0) continue;

      brick.glued = true;
      for (const other of [...neighbours].slice(0, 3)) {
        const offset = {
          x: other.position.x - brick.body.position.x || CELL,
          y: other.position.y - brick.body.position.y,
        };
        const pins = [
          { pointA: { x: 0, y: 0 }, pointB: { x: -offset.x, y: -offset.y } },
          { pointA: offset, pointB: { x: 0, y: 0 } },
        ];
        for (const pin of pins) {
          const weld = Constraint.create({ bodyA: brick.body, bodyB: other, ...pin, length: 0, stiffness: 0.7, damping: 0.1 });
          brick.welds.push(weld);
          Composite.add(this.engine.world, weld);
        }
      }
      this.onEvent({ type: 'glue', x: brick.body.position.x, y: brick.body.position.y });
    }
  }

  // --- suivi de la tour ----------------------------------------------------

  private removeBrick(brick: Brick): void {
    const attached = this.bricks.flatMap((b) => b.welds).filter((w) => w.bodyA === brick.body || w.bodyB === brick.body);
    for (const weld of attached) Composite.remove(this.engine.world, weld);
    for (const other of this.bricks) other.welds = other.welds.filter((w) => !attached.includes(w));
    Composite.remove(this.engine.world, brick.body);
    this.bricks = this.bricks.filter((b) => b !== brick);
    if (this.lastPlaced === brick) this.lastPlaced = null;
  }

  private collectLost(): void {
    const lost = this.bricks.filter(
      (b) => b.body.position.y > LOST_Y || Math.abs(b.body.position.x) > LOST_X,
    );
    for (const brick of lost) {
      const x = brick.body.position.x;
      this.removeBrick(brick);
      this.onEvent({ type: 'lost', x });
    }
  }

  private isSettled(brick: Brick): boolean {
    return (
      this.time - brick.placedAt > SETTLE_MS &&
      brick.body.speed < SETTLE_SPEED &&
      Math.abs(brick.body.angularVelocity) < SETTLE_SPIN
    );
  }

  private measure(): void {
    let top = 0;
    let mass = 0;
    let moment = 0;
    let shaky = false;
    for (const brick of this.bricks) {
      const { body } = brick;
      mass += body.mass;
      moment += body.mass * body.position.x;
      if (this.isSettled(brick)) top = Math.min(top, body.bounds.min.y);
      else if (this.time - brick.placedAt > 700) shaky = true;
    }
    this.height = Math.max(0, -top) / CELL;
    this.lean = mass > 0 ? Math.abs(moment / mass) / ((this.baseCells * CELL) / 2) : 0;
    this.worried = shaky || this.lean > 0.5;
  }

  private describe(brick: Brick, active: boolean): RenderBody {
    let flags = 0;
    if (active) flags |= FLAG.ACTIVE;
    if (brick.soapy) flags |= FLAG.SOAPY;
    if (brick.glued || brick.wantsGlue) flags |= FLAG.GLUED;
    if (brick.scale > 1) flags |= FLAG.GIANT;
    if (!active && brick.body.speed > 3) flags |= FLAG.FALLING;
    const { x, y } = brick.body.position;
    return { id: brick.id, type: brick.type, x, y, angle: brick.body.angle, flags };
  }
}
