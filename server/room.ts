import crypto from 'node:crypto';
import type {
  CardUse,
  Effect,
  Offer,
  OutMessage,
  OutReason,
  Phase,
  Result,
  RoomSnapshot,
  RoundResult,
  ServerToClient,
  TowerState,
  WireBody,
} from '../shared/protocol';
import { AVATARS, BONUS, MALUS, RULES, type AvatarId } from '../shared/rules';

export interface Player {
  id: string;
  token: string;
  name: string;
  avatar: AvatarId;
  color: number;
  ready: boolean;
  connected: boolean;
  disconnectedAt: number;
  wins: number;
  hearts: number;
  alive: boolean;
  inRound: boolean;
  height: number;
  tier: number;
  offers: Offer[];
  holdSince: number | null;
  lastStateAt: number;
}

export type JoinResult = { player: Player; error?: undefined } | { error: string; player?: undefined };

interface RoomOptions {
  now?: () => number;
  rng?: () => number;
}

function inRound(phase: Phase): boolean {
  return phase === 'countdown' || phase === 'playing';
}

export function cleanName(raw: unknown): string {
  const name = (typeof raw === 'string' ? raw : '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, RULES.NAME_MAX);
  return name || 'Commis';
}

function cleanAvatar(raw: unknown): AvatarId {
  return AVATARS.find((a) => a === raw) ?? AVATARS[0];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Ne laisse passer vers les autres joueurs que des nombres bornés. */
export function sanitizeState(raw: unknown): TowerState | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;
  if (!isFiniteNumber(input.h)) return null;
  const bodies: unknown[] = Array.isArray(input.b) ? input.b.slice(0, RULES.MAX_BODIES) : [];
  const b: WireBody[] = [];
  for (const entry of bodies) {
    if (!Array.isArray(entry) || entry.length !== 6 || !entry.every(isFiniteNumber)) return null;
    b.push(entry.map(Math.round) as WireBody);
  }
  return {
    h: Math.min(RULES.MAX_HEIGHT, Math.max(0, Math.round(input.h * 10) / 10)),
    b,
    bw: isFiniteNumber(input.bw) ? Math.min(12, Math.max(1, input.bw)) : 5,
    fx: isFiniteNumber(input.fx) ? input.fx & 0xff : 0,
  };
}

export class Room {
  readonly code: string;
  phase: Phase = 'lobby';
  round = 0;
  players: Player[] = [];
  hostId: string | null = null;
  private readonly now: () => number;
  private readonly rng: () => number;
  private startsAt = 0;
  private nextAt = 0;
  private emptySince: number | null = null;
  private lastResult: RoundResult | null = null;
  private out: OutMessage[] = [];
  private dirty = false;

  constructor(code: string, { now = Date.now, rng = Math.random }: RoomOptions = {}) {
    this.code = code;
    this.now = now;
    this.rng = rng;
  }

  // --- file d'attente des messages à émettre -------------------------------

  private send<E extends keyof ServerToClient>(
    to: 'all' | string,
    ev: E,
    data: Parameters<ServerToClient[E]>[0],
  ): void {
    this.out.push({ to, ev, data } as OutMessage);
  }

  flush(): OutMessage[] {
    const out = this.out;
    this.out = [];
    if (this.dirty) {
      this.dirty = false;
      out.push({ to: 'all', ev: 'room', data: this.snapshot() });
    }
    return out;
  }

  private touch(): void {
    this.dirty = true;
  }

  // --- joueurs -------------------------------------------------------------

  player(id: string | null | undefined): Player | null {
    return this.players.find((p) => p.id === id) ?? null;
  }

  private connected(): Player[] {
    return this.players.filter((p) => p.connected);
  }

  private alive(): Player[] {
    return this.players.filter((p) => p.alive);
  }

  addPlayer(request: { token?: unknown; name?: unknown; avatar?: unknown }): JoinResult {
    const { token } = request;
    if (typeof token !== 'string' || token.length < 8 || token.length > 64) {
      return { error: 'Session invalide, recharge la page.' };
    }
    if (this.players.some((p) => p.token === token)) return this.reconnect(token);
    if (this.players.length >= RULES.MAX_PLAYERS) {
      return { error: 'Ce salon est complet (4 joueurs).' };
    }
    const usedColors = new Set(this.players.map((p) => p.color));
    const color = [0, 1, 2, 3].find((c) => !usedColors.has(c)) ?? 0;
    const player: Player = {
      id: crypto.randomBytes(4).toString('hex'),
      token,
      name: cleanName(request.name),
      avatar: cleanAvatar(request.avatar),
      color,
      ready: false,
      connected: true,
      disconnectedAt: 0,
      wins: 0,
      hearts: RULES.HEARTS,
      alive: false,
      inRound: false,
      height: 0,
      tier: 0,
      offers: [],
      holdSince: null,
      lastStateAt: 0,
    };
    this.players.push(player);
    if (!this.hostId) this.hostId = player.id;
    this.emptySince = null;
    this.touch();
    return { player };
  }

  reconnect(token: unknown): JoinResult {
    const player = this.players.find((p) => p.token === token);
    if (!player) return { error: 'Ce salon ne te connaît pas.' };
    player.connected = true;
    player.disconnectedAt = 0;
    this.emptySince = null;
    if (!this.player(this.hostId)?.connected) this.hostId = player.id;
    this.touch();
    return { player };
  }

  disconnect(id: string): void {
    const player = this.player(id);
    if (!player) return;
    player.connected = false;
    player.ready = false;
    player.disconnectedAt = this.now();
    if (inRound(this.phase) && player.alive) this.eliminate(player, 'left');
    this.migrateHost();
    if (this.connected().length === 0) this.emptySince = this.now();
    this.touch();
  }

  leave(id: string): void {
    if (!this.player(id)) return;
    this.disconnect(id);
    this.players = this.players.filter((p) => p.id !== id);
    this.migrateHost();
    this.touch();
  }

  private migrateHost(): void {
    if (this.player(this.hostId)?.connected) return;
    const next = this.connected()[0] ?? this.players[0] ?? null;
    this.hostId = next ? next.id : null;
  }

  setReady(id: string, ready: unknown): void {
    const player = this.player(id);
    if (!player || this.phase !== 'lobby') return;
    player.ready = Boolean(ready);
    this.touch();
  }

  // --- déroulé de la partie ------------------------------------------------

  canStart(): string | null {
    const present = this.connected();
    if (present.length < RULES.MIN_PLAYERS) return 'Il faut au moins 2 joueurs.';
    if (present.some((p) => p.id !== this.hostId && !p.ready)) return 'Tout le monde doit être prêt.';
    return null;
  }

  start(id: string): Result {
    if (id !== this.hostId) return { error: "Seul l'hôte peut lancer la partie." };
    if (this.phase !== 'lobby') return { error: 'La partie est déjà en cours.' };
    const problem = this.canStart();
    if (problem) return { error: problem };
    this.round = 0;
    for (const p of this.players) p.wins = 0;
    this.beginRound();
    return { ok: true };
  }

  private beginRound(): void {
    this.round += 1;
    this.phase = 'countdown';
    this.startsAt = this.now() + RULES.COUNTDOWN_MS;
    this.lastResult = null;
    for (const p of this.players) {
      p.inRound = p.connected;
      p.alive = p.connected;
      p.hearts = RULES.HEARTS;
      p.height = 0;
      p.tier = 0;
      p.offers = [];
      p.holdSince = null;
      p.lastStateAt = this.now();
    }
    this.send('all', 'round:start', {
      round: this.round,
      startsIn: RULES.COUNTDOWN_MS,
      seed: Math.floor(this.rng() * 0x7fffffff),
    });
    this.touch();
  }

  backToLobby(id: string): void {
    if (id !== this.hostId || this.phase !== 'final') return;
    this.phase = 'lobby';
    this.round = 0;
    this.lastResult = null;
    for (const p of this.players) {
      p.wins = 0;
      p.ready = false;
      p.alive = false;
      p.inRound = false;
    }
    this.touch();
  }

  /** Enregistre l'état d'une tour et renvoie la version à relayer aux autres. */
  onState(id: string, raw: unknown): TowerState | null {
    const player = this.player(id);
    if (!player || !player.alive || !inRound(this.phase)) return null;
    const state = sanitizeState(raw);
    if (!state) return null;
    const now = this.now();
    player.lastStateAt = now;
    if (this.phase !== 'playing') return state;

    if (Math.abs(state.h - player.height) >= 0.5) this.touch();
    player.height = state.h;

    const tier = Math.floor(state.h / RULES.TIER_HEIGHT);
    while (player.tier < tier) {
      player.tier += 1;
      this.grantOffer(player);
    }

    const above = state.h >= RULES.FINISH_HEIGHT;
    if (above && player.holdSince === null) {
      player.holdSince = now;
      this.send('all', 'hold', { id: player.id, on: true, ms: RULES.HOLD_MS });
    } else if (!above) {
      this.stopHold(player);
    }
    return state;
  }

  private stopHold(player: Player): void {
    if (player.holdSince === null) return;
    player.holdSince = null;
    this.send('all', 'hold', { id: player.id, on: false });
  }

  private grantOffer(player: Player): void {
    if (player.offers.length >= RULES.MAX_OFFERS) return;
    const pick = <T>(list: readonly T[]): T => list[Math.floor(this.rng() * list.length) % list.length];
    player.offers = [...player.offers, { bonus: pick(BONUS), malus: pick(MALUS) }];
    this.send(player.id, 'cards', { offers: player.offers, gained: true });
  }

  useCard(id: string, use: Partial<CardUse>): Result {
    const player = this.player(id);
    if (!player || !player.alive || this.phase !== 'playing') return { error: 'Pas maintenant.' };
    const offer = player.offers[0];
    if (!offer) return { error: "Tu n'as pas de carte." };

    let effect: Effect;
    if (use.choice === 'bonus') {
      effect = { from: player.id, to: player.id, card: offer.bonus, kind: 'bonus' };
    } else if (use.choice === 'malus') {
      const victim = this.player(use.target);
      if (!victim || victim.id === player.id || !victim.alive) {
        return { error: 'Cette cible ne joue plus.' };
      }
      effect = { from: player.id, to: victim.id, card: offer.malus, kind: 'malus' };
    } else {
      return { error: 'Choix inconnu.' };
    }
    player.offers = player.offers.slice(1);
    this.send(player.id, 'cards', { offers: player.offers, gained: false });
    this.send('all', 'effect', effect);
    return { ok: true };
  }

  onBrickLost(id: string): void {
    const player = this.player(id);
    if (!player || !player.alive || this.phase !== 'playing') return;
    player.hearts = Math.max(0, player.hearts - 1);
    this.send('all', 'hearts', { id: player.id, hearts: player.hearts });
    this.touch();
    if (player.hearts === 0) this.eliminate(player, 'hearts');
  }

  private eliminate(player: Player, reason: OutReason): void {
    if (!player.alive) return;
    player.alive = false;
    player.holdSince = null;
    player.offers = [];
    this.send('all', 'out', { id: player.id, reason });
    this.touch();
    if (!inRound(this.phase)) return;
    const survivors = this.alive();
    if (survivors.length <= 1) this.endRound(survivors[0] ?? null, 'survivor');
  }

  private endRound(winner: Player | null, reason: RoundResult['reason']): void {
    if (!inRound(this.phase)) return;
    if (winner) winner.wins += 1;
    const final = Boolean(winner && winner.wins >= RULES.WINS_TO_WIN);
    this.phase = final ? 'final' : 'scores';
    this.nextAt = this.now() + RULES.SCORES_MS;
    for (const p of this.players) {
      p.holdSince = null;
      p.ready = false;
    }
    this.lastResult = { winner: winner ? winner.id : null, reason, final, round: this.round };
    this.send('all', 'round:end', { ...this.lastResult, nextIn: final ? 0 : RULES.SCORES_MS });
    this.touch();
  }

  tick(): void {
    const now = this.now();

    if (this.phase === 'countdown' && now >= this.startsAt) {
      this.phase = 'playing';
      for (const p of this.players) p.lastStateAt = now;
      this.touch();
    }

    if (this.phase === 'playing') {
      for (const p of this.alive()) {
        if (p.holdSince === null) continue;
        if (now - p.lastStateAt > RULES.STATE_TIMEOUT_MS) {
          this.stopHold(p);
        } else if (now - p.holdSince >= RULES.HOLD_MS) {
          this.endRound(p, 'finish');
          break;
        }
      }
    }

    if (this.phase === 'scores' && now >= this.nextAt) {
      if (this.connected().length < RULES.MIN_PLAYERS) {
        // Plus assez de monde pour continuer : on arrête la partie proprement.
        this.phase = 'final';
        const previous = this.lastResult ?? { winner: null, reason: 'survivor' as const, round: this.round };
        this.lastResult = { ...previous, final: true, abandoned: true };
        this.send('all', 'round:end', { ...this.lastResult, nextIn: 0 });
        this.touch();
      } else {
        this.beginRound();
      }
    }

    if (this.phase === 'lobby' || this.phase === 'final') {
      const before = this.players.length;
      this.players = this.players.filter(
        (p) => p.connected || now - p.disconnectedAt < RULES.LOBBY_GRACE_MS,
      );
      if (this.players.length !== before) {
        this.migrateHost();
        this.touch();
      }
    }
  }

  isDead(): boolean {
    if (this.players.length === 0) return true;
    return this.emptySince !== null && this.now() - this.emptySince > RULES.EMPTY_ROOM_MS;
  }

  snapshot(): RoomSnapshot {
    const now = this.now();
    return {
      code: this.code,
      phase: this.phase,
      round: this.round,
      hostId: this.hostId,
      finish: RULES.FINISH_HEIGHT,
      winsToWin: RULES.WINS_TO_WIN,
      maxHearts: RULES.HEARTS,
      startsIn: this.phase === 'countdown' ? Math.max(0, this.startsAt - now) : 0,
      nextIn: this.phase === 'scores' ? Math.max(0, this.nextAt - now) : 0,
      canStart: this.canStart(),
      lastResult: this.lastResult,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        color: p.color,
        ready: p.ready,
        connected: p.connected,
        wins: p.wins,
        hearts: p.hearts,
        alive: p.alive,
        inRound: p.inRound,
        height: p.height,
      })),
    };
  }
}
