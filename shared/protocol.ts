import type { AvatarId, BonusId, CardId, MalusId } from './rules';

export type Phase = 'lobby' | 'countdown' | 'playing' | 'scores' | 'final';
export type OutReason = 'hearts' | 'left';

export interface Offer {
  bonus: BonusId;
  malus: MalusId;
}

export interface PlayerView {
  id: string;
  name: string;
  avatar: AvatarId;
  color: number;
  ready: boolean;
  connected: boolean;
  wins: number;
  hearts: number;
  alive: boolean;
  inRound: boolean;
  height: number;
}

export interface RoundResult {
  winner: string | null;
  reason: 'finish' | 'survivor';
  final: boolean;
  round: number;
  abandoned?: boolean;
}

export interface RoomSnapshot {
  code: string;
  phase: Phase;
  round: number;
  hostId: string | null;
  finish: number;
  winsToWin: number;
  maxHearts: number;
  startsIn: number;
  nextIn: number;
  canStart: string | null;
  lastResult: RoundResult | null;
  players: PlayerView[];
}

/** Une part dans l'état réseau : [id, forme, x, y, angle×100, drapeaux]. */
export type WireBody = [number, number, number, number, number, number];

export interface TowerState {
  /** hauteur stabilisée de la tour, en étages */
  h: number;
  b: WireBody[];
  /** largeur du présentoir, en cases */
  bw: number;
  /** effets en cours (masque de bits) */
  fx: number;
}

export interface Effect {
  from: string;
  to: string;
  card: CardId;
  kind: 'bonus' | 'malus';
}

export interface JoinRequest {
  token: string;
  name: string;
  avatar: string;
  code?: string;
  rejoin?: boolean;
}

export type Welcome =
  | { ok: true; code: string; you: string; room: RoomSnapshot; offers: Offer[] }
  | { ok?: false; error: string };

export type Result = { ok: true } | { ok?: false; error: string };

export interface CardUse {
  choice: 'bonus' | 'malus';
  target?: string;
}

export interface ServerToClient {
  room: (snapshot: RoomSnapshot) => void;
  'round:start': (data: { round: number; startsIn: number; seed: number }) => void;
  'round:end': (data: RoundResult & { nextIn: number }) => void;
  state: (data: TowerState & { id: string }) => void;
  cards: (data: { offers: Offer[]; gained: boolean }) => void;
  effect: (data: Effect) => void;
  hearts: (data: { id: string; hearts: number }) => void;
  out: (data: { id: string; reason: OutReason }) => void;
  hold: (data: { id: string; on: boolean; ms?: number }) => void;
}

export interface ClientToServer {
  'room:create': (data: JoinRequest, ack: (reply: Welcome) => void) => void;
  'room:join': (data: JoinRequest, ack: (reply: Welcome) => void) => void;
  'room:leave': () => void;
  'room:ready': (ready: boolean) => void;
  'game:start': (ack: (reply: Result) => void) => void;
  'game:lobby': () => void;
  state: (state: TowerState) => void;
  'brick:lost': () => void;
  'card:use': (data: CardUse, ack: (reply: Result) => void) => void;
}

export type OutMessage = {
  [E in keyof ServerToClient]: { to: 'all' | string; ev: E; data: Parameters<ServerToClient[E]>[0] };
}[keyof ServerToClient];
