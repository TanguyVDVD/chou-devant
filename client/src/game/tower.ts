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
  centroid,
  makeBag,
  mulberry32,
  type Point,
  type TimedEffect,
} from './pieces';
import { DURATIONS, ENGINE, FALL, LOST, MATERIAL, REST, WELD, WIND } from './tuning';

const { Bodies, Body, Collision, Composite, Engine, Query } = Matter;

export const STEP_MS = 1000 / 60;

const BASE_THICKNESS = 20;
const HALF_CELL = CELL / 2;
/** Matter multiplie l'inertie de chaque morceau par 4 ; on garde la même convention. */
const MATTER_INERTIA_SCALE = 4;
const SUBSTEP_MS = STEP_MS / ENGINE.substeps;
/** Déplacement dû à la pesanteur en un sous-pas (0,001 est l'échelle de gravité de Matter). */
const GRAVITY_DROP = ENGINE.gravity * 0.001 * SUBSTEP_MS * SUBSTEP_MS;
const HOLD_DISTANCE = REST.hold * GRAVITY_DROP;
/** Même tolérance en rotation, pour un point situé à 2,5 cases du centre. */
const HOLD_ANGLE = HOLD_DISTANCE / (2.5 * CELL);

interface Brick {
  id: number;
  type: number;
  scale: number;
  /** les rectangles de la part : ils restent les siens même quand elle est soudée */
  parts: Matter.Body[];
  /** le corps simulé : le sien, ou celui du bloc auquel elle est soudée */
  body: Matter.Body;
  /** centre de masse dans le repère de `body`, et angle par rapport à lui */
  dx: number;
  dy: number;
  da: number;
  /** centre de masse par rapport au pivot, en pixels, part non tournée */
  com: Point;
  mass: number;
  soapy: boolean;
  /** caramélisée, pas encore soudée */
  wantsGlue: boolean;
  /** coup de froid : figée sur place dès qu'elle se pose */
  frozen: boolean;
  placedAt: number;
}

/** Soudure au caramel entre deux parts, ou entre une part et le présentoir (`b` nul). */
interface Weld {
  a: Brick;
  b: Brick | null;
}

interface Pose {
  x: number;
  y: number;
  angle: number;
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

function poseOfBody(body: Matter.Body): Pose {
  return { x: body.position.x, y: body.position.y, angle: body.angle };
}

export type TowerEvent =
  | { type: 'spawn' | 'move' | 'rotate' | 'blocked' }
  | { type: 'land'; x: number; y: number }
  | { type: 'lost'; x: number }
  | { type: 'eaten' | 'glue' | 'freeze'; x: number; y: number };

export class Tower {
  readonly effects: Record<TimedEffect, number> = { slow: 0, turbo: 0, invert: 0, fog: 0, wind: 0 };
  readonly pending = { glue: false, soap: false, giant: false, freeze: false };
  height = 0;
  lean = 0;
  worried = false;
  nextType: number;
  readonly baseCells = BASE_CELLS;

  private readonly engine: Matter.Engine;
  private readonly onEvent: (event: TowerEvent) => void;
  private readonly bag: () => number;
  private readonly rand: () => number;
  private readonly owner = new Map<Matter.Body, Brick>();
  private base: Matter.Body;
  private bricks: Brick[] = [];
  private welds: Weld[] = [];
  private active: Active | null = null;
  private lastPlaced: Brick | null = null;
  private time = 0;
  private spawnIn = 0;
  private nextId = 1;
  private running = false;
  private soft = false;
  private windDir = 1;
  /** La part bousculée par la rafale en cours, et d'où elle est partie. */
  private shoved: { brick: Brick; from: number } | null = null;
  private glueQueue = 0;
  /** Tour figée : le moteur ne tourne plus tant que rien ne la dérange. */
  private asleep = true;
  private calmFor = 0;

  constructor(seed: number, onEvent: (event: TowerEvent) => void = () => {}) {
    this.onEvent = onEvent;
    this.bag = makeBag(seed);
    this.rand = mulberry32(seed ^ 0x51ed);
    this.nextType = this.bag();
    this.engine = Engine.create({
      positionIterations: ENGINE.positionIterations,
      velocityIterations: ENGINE.velocityIterations,
      gravity: { x: 0, y: ENGINE.gravity },
    });
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
    if (!this.asleep) this.simulate();
    this.collectLost();
    this.measure();
  }

  // --- commandes -----------------------------------------------------------

  move(direction: -1 | 1, half: boolean): void {
    const active = this.active;
    if (!active) return;
    const dir = this.effects.invert > 0 ? -direction : direction;
    const step = (half ? HALF_CELL : CELL) * dir;
    const target = active.px + step;
    if (Math.abs(target) > FALL.moveLimit * CELL || !this.tryPose(active, target, active.py, active.r)) {
      this.onEvent({ type: 'blocked' });
      return;
    }
    this.onEvent({ type: 'move' });
  }

  rotate(): void {
    const active = this.active;
    if (!active) return;
    const r = (active.r + 1) % 4;
    const kicks = [0, HALF_CELL, -HALF_CELL, CELL, -CELL];
    const done = kicks.some((kick) => this.tryPose(active, active.px + kick, active.py, r));
    this.onEvent({ type: done ? 'rotate' : 'blocked' });
  }

  setSoftDrop(on: boolean): void {
    this.soft = on;
  }

  applyCard(card: CardId): void {
    switch (card) {
      case 'caramel':
        // Une part ne porte qu'un caramel : le suivant attend la part d'après.
        if (this.active && !this.active.brick.wantsGlue) this.active.brick.wantsGlue = true;
        else this.glueQueue += 1;
        this.pending.glue = this.glueQueue > 0;
        break;
      case 'beurre':
        if (this.active) this.makeSoapy(this.active.brick);
        else this.pending.soap = true;
        break;
      case 'chef':
        this.pending.giant = true;
        break;
      case 'froid':
        if (this.active && !this.active.brick.frozen) this.active.brick.frozen = true;
        else this.pending.freeze = true;
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
        this.shoved = null;
        this.wake();
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

  /** Vrai quand la tour est figée au repos (aucun calcul physique en cours). */
  get resting(): boolean {
    return this.asleep;
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
    if (this.glueQueue > 0) {
      brick.wantsGlue = true;
      this.glueQueue -= 1;
    }
    if (this.pending.freeze) brick.frozen = true;
    this.pending.giant = false;
    this.pending.soap = false;
    this.pending.freeze = false;
    this.pending.glue = this.glueQueue > 0;

    const top = Math.max(this.height + FALL.spawnAbove, FALL.minSpawnHeight) * CELL;
    const px = PIECES[type].half ? HALF_CELL : 0;
    this.active = { brick, r: 0, px, py: -top };
    this.pose(this.active);
    this.onEvent({ type: 'spawn' });
  }

  private advanceActive(active: Active): void {
    let speed = FALL.speed;
    if (this.effects.slow > 0) speed *= FALL.slow;
    if (this.effects.turbo > 0) speed *= FALL.turbo;
    if (this.soft) speed *= FALL.softDrop;

    if (this.effects.wind > 0) {
      const drifted = active.px + this.windDir * WIND.drift;
      if (Math.abs(drifted) <= FALL.moveLimit * CELL) this.tryPose(active, drifted, active.py, active.r);
    }

    if (this.tryPose(active, active.px, active.py + speed, active.r)) {
      if (active.py > LOST.below * CELL) {
        // Partie dans le vide sans rien toucher : son caramel ou son coup de froid passe à la suivante.
        if (active.brick.wantsGlue) this.glueQueue += 1;
        if (active.brick.frozen) this.pending.freeze = true;
        this.pending.glue = this.glueQueue > 0;
        this.active = null;
        this.spawnIn = FALL.spawnDelayMs;
        this.onEvent({ type: 'lost', x: active.px });
      }
      return;
    }
    // Quelque chose bloque : on descend au plus près de l'appui (par dichotomie)
    // pour que la part soit lâchée au contact, quelle que soit sa vitesse de chute.
    const from = active.py;
    let free = 0;
    let blocked = speed;
    while (blocked - free > FALL.contactPrecision) {
      const middle = (free + blocked) / 2;
      if (this.tryPose(active, active.px, from + middle, active.r)) free = middle;
      else blocked = middle;
    }
    this.release(active);
  }

  private release(active: Active): void {
    const { brick } = active;
    Body.setVelocity(brick.body, { x: 0, y: FALL.landSpeed });
    Body.setAngularVelocity(brick.body, 0);
    Composite.add(this.engine.world, brick.body);
    for (const part of brick.parts) this.owner.set(part, brick);
    brick.placedAt = this.time;
    this.bricks = [...this.bricks, brick];
    this.lastPlaced = brick;
    this.active = null;
    this.spawnIn = FALL.spawnDelayMs;
    this.wake();
    const { x, y } = this.poseOf(brick);
    if (brick.frozen) {
      // Coup de froid : la part est ancrée là où elle se pose, comme par une soudure
      // au présentoir. Elle ne bouge plus, quoi qu'il arrive à ce qui la portait.
      this.welds = [...this.welds, { a: brick, b: null }];
      this.rebuild();
      this.onEvent({ type: 'freeze', x, y });
    }
    this.tryWelds();
    this.onEvent({ type: 'land', x, y });
  }

  /** Place la part si la pose est libre ; sinon la laisse où elle était. */
  private tryPose(active: Active, px: number, py: number, r: number): boolean {
    const previous = { px: active.px, py: active.py, r: active.r };
    Object.assign(active, { px, py, r });
    this.pose(active);
    if (!this.overlaps(active.brick)) return true;
    Object.assign(active, previous);
    this.pose(active);
    return false;
  }

  private pose(active: Active): void {
    const { brick, r, px, py } = active;
    const angle = (r * Math.PI) / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    Body.setAngle(brick.body, angle);
    Body.setPosition(brick.body, {
      x: px + brick.com.x * cos - brick.com.y * sin,
      y: py + brick.com.x * sin + brick.com.y * cos,
    });
  }

  private overlaps(brick: Brick): boolean {
    const others = [this.base, ...new Set(this.bricks.map((b) => b.body))];
    return brick.parts.some((part) => Query.collides(part, others).length > 0);
  }

  // --- fabrication ---------------------------------------------------------

  private makeBase(cells: number): Matter.Body {
    return Bodies.rectangle(0, BASE_THICKNESS / 2, cells * CELL, BASE_THICKNESS, {
      isStatic: true,
      friction: MATERIAL.baseFriction,
      frictionStatic: MATERIAL.baseFrictionStatic,
    });
  }

  private makeBrick(type: number, scale: number): Brick {
    const size = CELL * scale;
    const { skin, density } = MATERIAL;
    const parts = PIECES[type].blocks.map(([x, y, w, h]) =>
      Bodies.rectangle((x + w / 2) * size, (y + h / 2) * size, w * size - skin, h * size - skin, { density }),
    );
    const body = this.compose(parts, false);
    const com = { x: body.position.x, y: body.position.y };
    const id = this.nextId;
    this.nextId += 1;
    return { id, type, scale, parts, body, dx: 0, dy: 0, da: 0, com, mass: body.mass, soapy: false, wantsGlue: false, frozen: false, placedAt: 0 };
  }

  /** Réunit des rectangles en un seul corps rigide. */
  private compose(parts: Matter.Body[], soapy: boolean): Matter.Body {
    const { frictionAir, restitution, density, slop } = MATERIAL;
    const friction = soapy ? MATERIAL.soapyFriction : MATERIAL.friction;
    const frictionStatic = soapy ? MATERIAL.soapyFrictionStatic : MATERIAL.frictionStatic;
    // Matter s'approprie le tableau qu'on lui passe (il y insère le corps parent) : on lui en donne une copie.
    const body = Body.create({ parts: [...parts], friction, frictionStatic, frictionAir, restitution, density, slop });
    // Matter additionne les inerties des morceaux sans leur bras de levier :
    // un corps composé tournerait trop facilement. On rétablit le terme manquant.
    let inertia = 0;
    for (const part of parts) {
      const arm = Math.hypot(part.position.x - body.position.x, part.position.y - body.position.y);
      inertia += part.inertia + MATTER_INERTIA_SCALE * part.mass * arm * arm;
    }
    Body.setInertia(body, inertia);
    return body;
  }

  private makeSoapy(brick: Brick): void {
    brick.soapy = true;
    brick.body.friction = MATERIAL.soapyFriction;
    brick.body.frictionStatic = MATERIAL.soapyFrictionStatic;
  }

  // --- moteur --------------------------------------------------------------

  private wake(): void {
    this.asleep = false;
    this.calmFor = 0;
  }

  /**
   * Avance la physique d'un pas, puis fige la tour dès qu'elle ne bouge plus :
   * une tour au repos reste strictement immobile jusqu'au prochain événement
   * (part posée, part retirée, courant d'air).
   */
  private simulate(): void {
    const windy = this.effects.wind > 0;
    let still = !windy;
    for (let i = 0; i < ENGINE.substeps; i += 1) {
      if (windy) this.blowTop();
      if (!this.substep()) still = false;
    }
    this.tryWelds();

    this.calmFor = still ? this.calmFor + STEP_MS : 0;
    // L'état du moteur est gardé tel quel : au réveil, la tour reprend exactement où elle en était.
    if (this.calmFor >= REST.calmMs) this.asleep = true;
  }

  /**
   * Un sous-pas du moteur ; renvoie vrai si rien n'a bougé.
   * Matter déplace d'abord chaque corps sous son poids, puis le repousse hors
   * de ses appuis : une part posée de travers glisse ainsi d'un cheveu à chaque
   * pas, même tenue par le frottement. Un corps dont le déplacement reste sous
   * ce « cheveu » est donc remis exactement où il était. Sa vitesse est gardée :
   * si une force réelle s'exerce, elle s'accumule et le corps part normalement.
   */
  private substep(): boolean {
    const bodies = [...new Set(this.bricks.map((b) => b.body))].filter((b) => !b.isStatic);
    const before = bodies.map(poseOfBody);
    Engine.update(this.engine, SUBSTEP_MS);
    let still = true;
    bodies.forEach((body, i) => {
      const from = before[i];
      const moved = Math.hypot(body.position.x - from.x, body.position.y - from.y);
      if (moved > HOLD_DISTANCE || Math.abs(body.angle - from.angle) > HOLD_ANGLE) {
        still = false;
        return;
      }
      Body.setPosition(body, from);
      Body.setAngle(body, from.angle);
    });
    return still;
  }

  // --- cartes --------------------------------------------------------------

  private tickEffects(): void {
    for (const name of Object.keys(this.effects) as TimedEffect[]) {
      if (this.effects[name] <= 0) continue;
      this.effects[name] = Math.max(0, this.effects[name] - STEP_MS);
      if (name === 'wind' && this.effects.wind === 0 && this.active) {
        // La rafale a décalé la part : elle retrouve la grille des demi-cases.
        const { active } = this;
        this.tryPose(active, Math.round(active.px / HALF_CELL) * HALF_CELL, active.py, active.r);
      }
    }
  }

  /** Le courant d'air pousse la part du sommet d'une demi-case au plus : il dérange, il ne renverse pas. */
  private blowTop(): void {
    if (!this.shoved) {
      const top = this.bricks.reduce<Brick | null>(
        (best, brick) => (!best || this.poseOf(brick).y < this.poseOf(best).y ? brick : best),
        null,
      );
      if (!top || this.isWelded(top)) return;
      this.shoved = { brick: top, from: this.poseOf(top).x };
    }
    const { brick, from } = this.shoved;
    if (!this.bricks.includes(brick) || this.isWelded(brick)) return;
    if (Math.abs(this.poseOf(brick).x - from) >= WIND.maxShove * CELL) return;
    Body.applyForce(brick.body, brick.body.position, { x: this.windDir * WIND.push * brick.body.mass, y: 0 });
  }

  private eatLast(): void {
    const target =
      this.lastPlaced && this.bricks.includes(this.lastPlaced)
        ? this.lastPlaced
        : this.bricks.reduce<Brick | null>((best, b) => (!best || b.placedAt > best.placedAt ? b : best), null);
    if (!target) return;
    const { x, y } = this.poseOf(target);
    this.removeBrick(target);
    this.onEvent({ type: 'eaten', x, y });
  }

  // --- caramel -------------------------------------------------------------

  private isWelded(brick: Brick): boolean {
    return this.welds.some((weld) => weld.a === brick || weld.b === brick);
  }

  /** Soude chaque part caramélisée à tout ce qu'elle touche, dès le premier contact. */
  private tryWelds(): void {
    let changed = false;
    for (const brick of this.bricks) {
      if (!brick.wantsGlue) continue;
      const found = this.neighbours(brick);
      if (found.length === 0) continue;
      brick.wantsGlue = false;
      this.welds = [...this.welds, ...found.map((b) => ({ a: brick, b }))];
      changed = true;
      const { x, y } = this.poseOf(brick);
      this.onEvent({ type: 'glue', x, y });
    }
    if (changed) this.rebuild();
  }

  /** Ce qui se trouve à moins de `WELD.reach` pixels de la part (nul = le présentoir). */
  private neighbours(brick: Brick): Array<Brick | null> {
    const found = new Set<Brick | null>();
    const r = WELD.reach;
    for (const [dx, dy] of [[0, r], [r, 0], [-r, 0], [0, -r]]) {
      Body.translate(brick.body, { x: dx, y: dy });
      for (const mine of brick.parts) {
        if (Collision.collides(mine, this.base)) found.add(null);
        for (const [part, other] of this.owner) {
          if (other !== brick && Collision.collides(mine, part)) found.add(other);
        }
      }
      Body.translate(brick.body, { x: -dx, y: -dy });
    }
    return [...found];
  }

  /**
   * Recompose les corps d'après les soudures : les parts reliées entre elles
   * fusionnent en un seul corps rigide, immobile s'il est soudé au présentoir.
   * Une part dont la soudure a disparu redevient un corps à elle seule.
   */
  private rebuild(): void {
    const seen = new Set<Brick>();
    for (const start of this.bricks) {
      if (seen.has(start)) continue;
      seen.add(start);
      const members = [start];
      let anchored = false;
      for (let i = 0; i < members.length; i += 1) {
        for (const { a, b } of this.welds) {
          if (a !== members[i] && b !== members[i]) continue;
          const other = a === members[i] ? b : a;
          if (other === null) anchored = true;
          else if (!seen.has(other)) {
            seen.add(other);
            members.push(other);
          }
        }
      }
      this.assemble(members, anchored);
    }
    // Matter garde en mémoire les contacts de chaque rectangle avec son ancien corps :
    // on les rattache au nouveau, sans perdre l'équilibre déjà trouvé.
    for (const pair of this.engine.pairs.list as Matter.Pair[]) {
      pair.collision.parentA = pair.bodyA.parent;
      pair.collision.parentB = pair.bodyB.parent;
    }
    this.wake();
  }

  private assemble(members: Brick[], anchored: boolean): void {
    const current = members[0].body;
    const partCount = members.reduce((n, m) => n + m.parts.length, 0);
    if (members.every((m) => m.body === current) && current.parts.length - 1 === partCount) {
      if (current.isStatic !== anchored) Body.setStatic(current, anchored);
      return;
    }

    const poses = members.map((m) => this.poseOf(m));
    const olds = [...new Set(members.map((m) => m.body))];
    const total = { mass: 0, vx: 0, vy: 0, spin: 0 };
    for (const m of members) {
      total.mass += m.mass;
      total.vx += m.mass * m.body.velocity.x;
      total.vy += m.mass * m.body.velocity.y;
      total.spin += m.mass * m.body.angularVelocity;
    }
    for (const old of olds) {
      Composite.remove(this.engine.world, old);
      if (old.isStatic) Body.setStatic(old, false);
    }

    const body = this.compose(members.flatMap((m) => m.parts), members.length === 1 && members[0].soapy);
    members.forEach((m, i) => {
      m.body = body;
      m.dx = poses[i].x - body.position.x;
      m.dy = poses[i].y - body.position.y;
      m.da = poses[i].angle;
    });
    Body.setVelocity(body, { x: total.vx / total.mass, y: total.vy / total.mass });
    Body.setAngularVelocity(body, total.spin / total.mass);
    if (anchored) Body.setStatic(body, true);
    Composite.add(this.engine.world, body);
  }

  // --- suivi de la tour ----------------------------------------------------

  /** Centre de masse et angle d'une part, qu'elle soit seule ou dans un bloc soudé. */
  private poseOf(brick: Brick): Pose {
    const { position, angle } = brick.body;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      x: position.x + brick.dx * cos - brick.dy * sin,
      y: position.y + brick.dx * sin + brick.dy * cos,
      angle: angle + brick.da,
    };
  }

  private removeBrick(brick: Brick): void {
    this.welds = this.welds.filter((weld) => weld.a !== brick && weld.b !== brick);
    this.bricks = this.bricks.filter((b) => b !== brick);
    for (const part of brick.parts) this.owner.delete(part);
    // Si la part était dans un bloc soudé, `rebuild` redonne un corps au reste du bloc.
    Composite.remove(this.engine.world, brick.body);
    if (this.lastPlaced === brick) this.lastPlaced = null;
    this.rebuild();
  }

  private collectLost(): void {
    const lost = this.bricks.filter((b) => {
      const { x, y } = this.poseOf(b);
      return y > LOST.below * CELL || Math.abs(x) > LOST.aside * CELL;
    });
    for (const brick of lost) {
      const { x } = this.poseOf(brick);
      this.removeBrick(brick);
      this.onEvent({ type: 'lost', x });
    }
  }

  private isSettled(brick: Brick): boolean {
    return (
      this.time - brick.placedAt > REST.settleMs &&
      brick.body.speed < REST.settleSpeed &&
      Math.abs(brick.body.angularVelocity) < REST.settleSpin
    );
  }

  private measure(): void {
    let top = 0;
    let mass = 0;
    let moment = 0;
    let shaky = false;
    for (const brick of this.bricks) {
      mass += brick.mass;
      moment += brick.mass * this.poseOf(brick).x;
      if (this.isSettled(brick)) top = Math.min(top, ...brick.parts.map((p) => p.bounds.min.y));
      else if (this.time - brick.placedAt > REST.shakyMs) shaky = true;
    }
    this.height = Math.max(0, -top) / CELL;
    this.lean = mass > 0 ? Math.abs(moment / mass) / ((this.baseCells * CELL) / 2) : 0;
    this.worried = shaky || this.lean > 0.5;
  }

  private describe(brick: Brick, active: boolean): RenderBody {
    let flags = 0;
    if (active) flags |= FLAG.ACTIVE;
    if (brick.soapy) flags |= FLAG.SOAPY;
    if (brick.frozen) flags |= FLAG.FROZEN;
    else if (brick.wantsGlue || this.isWelded(brick)) flags |= FLAG.GLUED;
    if (brick.scale > 1) flags |= FLAG.GIANT;
    if (!active && brick.body.speed > 3) flags |= FLAG.FALLING;
    // L'affichage attend le centre des cases, à un cheveu du centre de masse physique.
    const pose = this.poseOf(brick);
    const c = centroid(brick.type);
    const dx = c.x * CELL * brick.scale - brick.com.x;
    const dy = c.y * CELL * brick.scale - brick.com.y;
    const cos = Math.cos(pose.angle);
    const sin = Math.sin(pose.angle);
    return {
      id: brick.id,
      type: brick.type,
      x: pose.x + dx * cos - dy * sin,
      y: pose.y + dx * sin + dy * cos,
      angle: pose.angle,
      flags,
    };
  }
}
