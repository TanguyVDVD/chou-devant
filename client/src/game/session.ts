import type { TowerState } from '../../../shared/protocol';
import type { CardId } from '../../../shared/rules';
import { COLORS } from '../theme';
import { play } from './audio';
import { BASE_CELLS, CELL, FX_WORRIED, type TimedEffect } from './pieces';
import { cameraTarget, drawTower, type Particle, type Popup, type Scene } from './render';
import { STEP_MS, Tower, type RenderBody, type TowerEvent } from './tower';

export type Mood = 'idle' | 'worried' | 'ouch' | 'happy' | 'out';
export type Direction = -1 | 1;

interface Callbacks {
  sendState: (state: TowerState) => void;
  brickLost: () => void;
  moods: (moods: Record<string, Mood>) => void;
}

interface Remote {
  state: TowerState;
  shown: Map<number, RenderBody>;
}

interface Hold {
  start: number;
  ms: number;
}

const SEND_EVERY_MS = 66;
const MOODS_EVERY_MS = 200;
const MAX_CATCH_UP_STEPS = 90;
const REPEAT_DELAY_MS = 170;
const REPEAT_EVERY_MS = 60;
const HIT_MOOD_MS = 1600;
const SMOOTHING = 0.35;
const CAMERA_EASE = 0.08;
const NO_EFFECTS: Record<TimedEffect, number> = { slow: 0, turbo: 0, invert: 0, fog: 0, wide: 0, wind: 0 };

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Fait tourner ma tour, dessine toutes les tours, et parle au réseau.
 * Vit en dehors de React : rien ici ne provoque de rendu d'interface.
 */
export class GameSession {
  private tower: Tower | null = null;
  private you: string | null = null;
  private colors = new Map<string, string>();
  private remotes = new Map<string, Remote>();
  private canvases = new Map<string, HTMLCanvasElement>();
  private cameras = new Map<string, number>();
  private holds = new Map<string, Hold>();
  private out = new Set<string>();
  private hitUntil = new Map<string, number>();
  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private shake = 0;
  private startAt: number | null = null;
  private roundOver = true;

  private held: Direction | null = null;
  private heldHalf = false;
  private repeatIn = 0;

  private timer: number | null = null;
  private frame: number | null = null;
  private lastTick = 0;
  private lastFrame = 0;
  private backlog = 0;
  private sendIn = 0;
  private moodsIn = 0;
  private lastMoods = '';

  constructor(private readonly callbacks: Callbacks) {}

  // --- branchement sur l'écran de jeu -------------------------------------

  attach(): void {
    if (this.timer !== null) return;
    this.lastTick = performance.now();
    this.lastFrame = this.lastTick;
    // La simulation tourne sur un minuteur : elle continue (au ralenti) même
    // si l'onglet passe en arrière-plan, contrairement à requestAnimationFrame.
    this.timer = window.setInterval(() => this.tick(), 8);
    const loop = (): void => {
      this.render();
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  detach(): void {
    if (this.timer !== null) clearInterval(this.timer);
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.timer = null;
    this.frame = null;
  }

  setCanvas(id: string, canvas: HTMLCanvasElement | null): void {
    if (canvas) this.canvases.set(id, canvas);
    else this.canvases.delete(id);
  }

  setPlayers(you: string | null, colors: Map<string, string>): void {
    this.you = you;
    this.colors = colors;
  }

  // --- déroulé d'une manche ------------------------------------------------

  startRound(seed: number, startsIn: number): void {
    this.resetRound();
    this.tower = new Tower(seed, (event) => this.onTowerEvent(event));
    this.startAt = performance.now() + startsIn;
    this.roundOver = false;
  }

  /** Arrivée en cours de manche : on regarde, sans tour à soi. */
  spectate(): void {
    this.resetRound();
    this.tower = null;
    if (this.you) this.out.add(this.you);
  }

  endRound(): void {
    this.roundOver = true;
    this.startAt = null;
    this.tower?.stop();
    this.held = null;
  }

  eliminate(id: string): void {
    this.out.add(id);
    this.holds.delete(id);
    if (id === this.you) {
      this.tower?.stop();
      this.held = null;
    }
  }

  private resetRound(): void {
    this.remotes.clear();
    this.holds.clear();
    this.out.clear();
    this.hitUntil.clear();
    this.cameras.clear();
    this.particles = [];
    this.popups = [];
    this.shake = 0;
    this.startAt = null;
    this.held = null;
  }

  // --- réseau --------------------------------------------------------------

  setRemote(id: string, state: TowerState): void {
    const remote = this.remotes.get(id);
    if (remote) remote.state = state;
    else this.remotes.set(id, { state, shown: new Map() });
  }

  setHold(id: string, on: boolean, ms: number): void {
    if (on) this.holds.set(id, { start: performance.now(), ms });
    else this.holds.delete(id);
  }

  /** Un effet de carte touche un joueur : mimique, secousse, et effet réel si c'est moi. */
  applyEffect(target: string, card: CardId, hostile: boolean): void {
    if (hostile) this.hitUntil.set(target, performance.now() + HIT_MOOD_MS);
    if (target !== this.you) return;
    this.tower?.applyCard(card);
    if (hostile) this.shake = Math.max(this.shake, 9);
  }

  // --- commandes -----------------------------------------------------------

  private get canPlay(): boolean {
    return Boolean(this.tower?.hasActive) && !this.roundOver;
  }

  press(direction: Direction, half: boolean): void {
    if (!this.tower || this.roundOver) return;
    this.held = direction;
    this.heldHalf = half;
    this.repeatIn = REPEAT_DELAY_MS;
    this.tower?.move(direction, half);
  }

  release(direction: Direction): void {
    if (this.held === direction) this.held = null;
  }

  rotate(): void {
    if (this.canPlay) this.tower?.rotate();
  }

  softDrop(on: boolean): void {
    this.tower?.setSoftDrop(on && !this.roundOver);
  }

  // --- simulation ----------------------------------------------------------

  private tick(): void {
    const now = performance.now();
    this.backlog += now - this.lastTick;
    this.lastTick = now;

    if (this.startAt !== null && now >= this.startAt) {
      this.startAt = null;
      this.tower?.start();
    }

    let steps = Math.min(MAX_CATCH_UP_STEPS, Math.floor(this.backlog / STEP_MS));
    this.backlog -= steps * STEP_MS;
    if (this.backlog > STEP_MS * MAX_CATCH_UP_STEPS) this.backlog = 0;
    const tower = this.tower;
    if (!tower) return;

    for (; steps > 0; steps -= 1) {
      this.repeatInput(tower);
      tower.step();
      this.sendIn -= STEP_MS;
    }
    if (this.sendIn <= 0 && !this.roundOver && this.you && !this.out.has(this.you)) {
      this.sendIn = SEND_EVERY_MS;
      this.callbacks.sendState(tower.wire());
    }
  }

  private repeatInput(tower: Tower): void {
    if (this.held === null) return;
    this.repeatIn -= STEP_MS;
    if (this.repeatIn > 0) return;
    this.repeatIn = REPEAT_EVERY_MS;
    tower.move(this.held, this.heldHalf);
  }

  private onTowerEvent(event: TowerEvent): void {
    switch (event.type) {
      case 'move':
        play('move');
        break;
      case 'rotate':
        play('rotate');
        break;
      case 'blocked':
        play('blocked');
        break;
      case 'land':
        play('land');
        this.shake = Math.max(this.shake, 2.5);
        this.burst(event.x, event.y + CELL / 2, 7, [COLORS.creme, this.myColor()], 1.6);
        break;
      case 'lost':
        play('lost');
        this.shake = Math.max(this.shake, 8);
        this.popup(Math.max(-150, Math.min(150, event.x)), 40, 'Splotch !', COLORS.framboise);
        this.burst(Math.max(-180, Math.min(180, event.x)), 70, 16, [this.myColor(), COLORS.creme, COLORS.choco], 3.4);
        this.callbacks.brickLost();
        break;
      case 'eaten':
        this.popup(event.x, event.y, 'Miam !', COLORS.pistache);
        this.burst(event.x, event.y, 14, [this.myColor(), COLORS.creme], 2.4);
        break;
      case 'glue':
        this.popup(event.x, event.y - CELL, 'Collé !', COLORS.choco);
        break;
      case 'spawn':
        break;
    }
  }

  private myColor(): string {
    return (this.you && this.colors.get(this.you)) || COLORS.framboise;
  }

  private burst(x: number, y: number, count: number, colors: string[], power: number): void {
    if (reducedMotion()) return;
    for (let i = 0; i < count; i += 1) {
      const angle = -Math.PI * Math.random();
      const speed = power * (0.4 + Math.random());
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        ttl: 500 + Math.random() * 400,
        size: 3 + Math.random() * 5,
        color: colors[i % colors.length],
        spin: Math.random() * 2 - 1,
      });
    }
  }

  private popup(x: number, y: number, text: string, color: string): void {
    this.popups.push({ x, y, text, color, life: 0, ttl: 1100 });
  }

  // --- affichage -----------------------------------------------------------

  private render(): void {
    const now = performance.now();
    const dt = Math.min(64, now - this.lastFrame);
    this.lastFrame = now;
    this.animate(dt);

    for (const [id, canvas] of this.canvases) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      const ratio = Math.min(2.5, window.devicePixelRatio || 1);
      const width = Math.round(rect.width * ratio);
      const height = Math.round(rect.height * ratio);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      drawTower(ctx, width, height, this.sceneFor(id, width, height, now));
    }

    this.moodsIn -= dt;
    if (this.moodsIn <= 0) {
      this.moodsIn = MOODS_EVERY_MS;
      this.publishMoods(now);
    }
  }

  private animate(dt: number): void {
    const frames = dt / STEP_MS;
    for (const p of this.particles) {
      p.life += dt;
      p.vy += 0.18 * frames;
      p.x += p.vx * frames;
      p.y += p.vy * frames;
    }
    this.particles = this.particles.filter((p) => p.life < p.ttl);
    for (const popup of this.popups) popup.life += dt;
    this.popups = this.popups.filter((popup) => popup.life < popup.ttl);
    this.shake = this.shake < 0.2 ? 0 : this.shake * Math.pow(0.86, frames);
  }

  private holdProgress(id: string, now: number): number | null {
    const hold = this.holds.get(id);
    return hold ? Math.min(1, (now - hold.start) / hold.ms) : null;
  }

  private camera(id: string, heightInFloors: number, width: number, height: number): number {
    const target = cameraTarget(heightInFloors, width, height, id !== this.you);
    const current = this.cameras.get(id) ?? target;
    const next = current + (target - current) * CAMERA_EASE;
    this.cameras.set(id, next);
    return next;
  }

  private sceneFor(id: string, width: number, height: number, now: number): Scene {
    const mine = id === this.you;
    const shaking = mine && !reducedMotion() ? this.shake : 0;
    const common = {
      color: this.colors.get(id) ?? COLORS.framboise,
      hold: this.holdProgress(id, now),
      mini: !mine,
      time: now,
      frozen: this.out.has(id),
      shakeX: (Math.random() - 0.5) * shaking,
      shakeY: (Math.random() - 0.5) * shaking,
    };

    const tower = mine ? this.tower : null;
    if (tower) {
      const state = tower.wire();
      return {
        ...common,
        bodies: tower.bodies(),
        baseCells: tower.baseCells,
        height: tower.height,
        fx: state.fx,
        camera: this.camera(id, tower.height, width, height),
        windDir: tower.windDirection,
        next: tower.nextType,
        effects: tower.effects,
        pending: tower.pending,
        particles: this.particles,
        popups: this.popups,
      };
    }

    const remote = mine ? undefined : this.remotes.get(id);
    return {
      ...common,
      bodies: remote ? this.smooth(remote) : [],
      baseCells: remote?.state.bw ?? BASE_CELLS,
      height: remote?.state.h ?? 0,
      fx: remote?.state.fx ?? 0,
      camera: this.camera(id, remote?.state.h ?? 0, width, height),
      windDir: remote ? (Math.floor(now / 1200) % 2 === 0 ? 1 : -1) : 0,
      next: null,
      effects: mine ? NO_EFFECTS : null,
      pending: null,
      particles: [],
      popups: [],
    };
  }

  /** Lisse les positions reçues ~15 fois par seconde pour un affichage fluide. */
  private smooth(remote: Remote): RenderBody[] {
    const next = new Map<number, RenderBody>();
    for (const [id, type, x, y, angle100, flags] of remote.state.b) {
      const target = { id, type, x, y, angle: angle100 / 100, flags };
      const shown = remote.shown.get(id);
      next.set(
        id,
        shown
          ? {
              ...target,
              x: shown.x + (target.x - shown.x) * SMOOTHING,
              y: shown.y + (target.y - shown.y) * SMOOTHING,
              angle: shown.angle + (target.angle - shown.angle) * SMOOTHING,
            }
          : target,
      );
    }
    remote.shown = next;
    return [...next.values()];
  }

  private publishMoods(now: number): void {
    const moods: Record<string, Mood> = {};
    for (const id of this.colors.keys()) {
      const worried =
        id === this.you ? Boolean(this.tower?.worried) : ((this.remotes.get(id)?.state.fx ?? 0) & FX_WORRIED) !== 0;
      if (this.out.has(id)) moods[id] = 'out';
      else if (this.holds.has(id)) moods[id] = 'happy';
      else if ((this.hitUntil.get(id) ?? 0) > now) moods[id] = 'ouch';
      else if (worried) moods[id] = 'worried';
      else moods[id] = 'idle';
    }
    const serialized = JSON.stringify(moods);
    if (serialized === this.lastMoods) return;
    this.lastMoods = serialized;
    this.callbacks.moods(moods);
  }

}
