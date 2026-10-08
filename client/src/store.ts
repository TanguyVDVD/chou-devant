import { useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServer,
  Effect,
  Offer,
  PlayerView,
  RoomSnapshot,
  ServerToClient,
  Welcome,
} from '../../shared/protocol';
import { AVATARS, RULES, type AvatarId, type CardId } from '../../shared/rules';
import { isMuted, play, playCard, setMuted } from './game/audio';
import { GameSession, type Mood, type Status } from './game/session';
import { CARDS, playerColor } from './theme';

export interface Announcement {
  id: number;
  text: string;
  /** ce que ça change, en clair */
  detail: string | null;
  /** l'annonce me concerne directement */
  mine: boolean;
  card: CardId | null;
  kind: 'bonus' | 'malus' | 'info';
  color: number | null;
}

export interface AppState {
  connected: boolean;
  busy: boolean;
  error: string | null;
  name: string;
  avatar: AvatarId;
  /** code de salon reçu par un lien d'invitation */
  invite: string | null;
  you: string | null;
  room: RoomSnapshot | null;
  offers: Offer[];
  announcements: Announcement[];
  moods: Record<string, Mood>;
  /** effets en cours chez chaque adversaire */
  statuses: Record<string, Status[]>;
  /** instant (performance.now) où la manche démarre, pendant le décompte */
  countdownUntil: number | null;
  muted: boolean;
}

const NAME_KEY = 'chou.pseudo';
const AVATAR_KEY = 'chou.avatar';
const TOKEN_KEY = 'chou.jeton';
const ROOM_KEY = 'chou.salon';
const ANNOUNCEMENT_MS = 4200;
const MAX_ANNOUNCEMENTS = 3;
const REPLY_TIMEOUT_MS = 8000;

function read(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(storage: Storage, key: string, value: string | null): void {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // Stockage refusé (navigation privée stricte) : on continue sans mémoire.
  }
}

function sessionToken(): string {
  const known = read(sessionStorage, TOKEN_KEY);
  if (known) return known;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  write(sessionStorage, TOKEN_KEY, token);
  return token;
}

function inviteFromUrl(): string | null {
  const code = new URLSearchParams(location.search).get('salon');
  const clean = (code ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  return clean.length === 4 ? clean : null;
}

function setUrlRoom(code: string | null): void {
  history.replaceState(null, '', code ? `?salon=${code}` : location.pathname);
}

const storedAvatar = read(localStorage, AVATAR_KEY);

let state: AppState = {
  connected: false,
  busy: false,
  error: null,
  name: read(localStorage, NAME_KEY) ?? '',
  avatar: AVATARS.find((a) => a === storedAvatar) ?? AVATARS[0],
  invite: inviteFromUrl(),
  you: null,
  room: null,
  offers: [],
  announcements: [],
  moods: {},
  statuses: {},
  countdownUntil: null,
  muted: isMuted(),
};

const listeners = new Set<() => void>();

function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useApp(): AppState {
  return useSyncExternalStore(subscribe, () => state);
}

const socket: Socket<ServerToClient, ClientToServer> = io({ transports: ['websocket', 'polling'] });

export const session = new GameSession({
  sendState: (towerState) => socket.volatile.emit('state', towerState),
  brickLost: () => socket.emit('brick:lost'),
  hud: (moods, statuses) => setState({ moods, statuses }),
});

// --- utilitaires -----------------------------------------------------------

export function findPlayer(room: RoomSnapshot | null, id: string | null): PlayerView | null {
  return room?.players.find((p) => p.id === id) ?? null;
}

/** Les adversaires, dans l'ordre des touches 1-2-3. */
export function opponents(room: RoomSnapshot | null, you: string | null): PlayerView[] {
  return (room?.players ?? []).filter((p) => p.id !== you);
}

let announcementId = 0;

function announce(entry: Pick<Announcement, 'text' | 'kind' | 'color'> & Partial<Announcement>): void {
  announcementId += 1;
  const id = announcementId;
  const full: Announcement = { detail: null, mine: false, card: null, ...entry, id };
  setState({ announcements: [...state.announcements, full].slice(-MAX_ANNOUNCEMENTS) });
  window.setTimeout(() => {
    setState({ announcements: state.announcements.filter((a) => a.id !== id) });
  }, ANNOUNCEMENT_MS);
}

function syncSession(room: RoomSnapshot | null, you: string | null): void {
  const colors = new Map((room?.players ?? []).map((p) => [p.id, playerColor(p.color)] as const));
  session.setPlayers(you, colors);
}

function enter(reply: Extract<Welcome, { ok: true }>): void {
  write(sessionStorage, ROOM_KEY, reply.code);
  setUrlRoom(reply.code);
  syncSession(reply.room, reply.you);
  const me = findPlayer(reply.room, reply.you);
  const midRound = reply.room.phase === 'countdown' || reply.room.phase === 'playing';
  if (midRound && !me?.alive) session.spectate();
  setState({
    busy: false,
    error: null,
    invite: null,
    you: reply.you,
    room: reply.room,
    offers: reply.offers,
    announcements: [],
    countdownUntil: null,
  });
}

function forget(): void {
  write(sessionStorage, ROOM_KEY, null);
  setUrlRoom(null);
  session.endRound();
  setState({ you: null, room: null, offers: [], announcements: [], moods: {}, statuses: {}, countdownUntil: null, busy: false });
}

function handleWelcome(error: Error | null, reply?: Welcome): void {
  if (error || !reply) setState({ busy: false, error: 'Le serveur ne répond pas. Réessaie dans un instant.' });
  else if (reply.ok) enter(reply);
  else setState({ busy: false, error: reply.error });
}

// --- actions ---------------------------------------------------------------

export function setProfile(name: string, avatar: AvatarId): void {
  write(localStorage, NAME_KEY, name);
  write(localStorage, AVATAR_KEY, avatar);
  setState({ name, avatar });
}

export function clearError(): void {
  setState({ error: null });
}

export function createRoom(): void {
  play('click');
  setState({ busy: true, error: null });
  socket.timeout(REPLY_TIMEOUT_MS).emit('room:create', { token: sessionToken(), name: state.name, avatar: state.avatar }, handleWelcome);
}

export function joinRoom(code: string): void {
  play('click');
  setState({ busy: true, error: null });
  socket.timeout(REPLY_TIMEOUT_MS).emit('room:join', { token: sessionToken(), name: state.name, avatar: state.avatar, code }, handleWelcome);
}

export function leaveRoom(): void {
  socket.emit('room:leave');
  forget();
}

export function setReady(ready: boolean): void {
  play('click');
  socket.emit('room:ready', ready);
}

export function startGame(): void {
  play('click');
  socket.emit('game:start', (reply) => {
    if (!reply.ok) setState({ error: reply.error });
  });
}

export function backToLobby(): void {
  play('click');
  socket.emit('game:lobby');
}

function sendCard(choice: 'bonus' | 'malus', target?: string): void {
  if (state.offers.length === 0 || state.room?.phase !== 'playing') return;
  socket.emit('card:use', { choice, target }, (reply) => {
    if (!reply.ok) announce({ text: reply.error, kind: 'info', color: null });
  });
}

export function playBonus(): void {
  sendCard('bonus');
}

/** Lance le malus sur un adversaire (par son rang 1-2-3 ou son identifiant). */
export function playMalus(target: number | string): void {
  const list = opponents(state.room, state.you);
  const victim = typeof target === 'number' ? list[target] : list.find((p) => p.id === target);
  if (victim?.alive) sendCard('malus', victim.id);
}

export function toggleMute(): void {
  const muted = !state.muted;
  setMuted(muted);
  setState({ muted });
  if (!muted) play('click');
}

// --- messages du serveur ---------------------------------------------------

socket.on('connect', () => {
  setState({ connected: true });
  const code = read(sessionStorage, ROOM_KEY);
  if (!code) return;
  // Rechargement de page ou coupure réseau : on retrouve sa place dans le salon.
  socket.emit('room:join', { token: sessionToken(), name: state.name, avatar: state.avatar, code, rejoin: true }, (reply) => {
    if (reply.ok) enter(reply);
    else forget();
  });
});

socket.on('disconnect', () => setState({ connected: false }));

socket.on('room', (room) => {
  syncSession(room, state.you);
  setState({ room });
});

socket.on('round:start', ({ seed, startsIn }) => {
  session.startRound(seed, startsIn);
  setState({ offers: [], announcements: [], countdownUntil: performance.now() + startsIn });
});

socket.on('round:end', (result) => {
  session.endRound();
  setState({ countdownUntil: null, offers: [] });
  if (!result.final) play('bell');
  else play(result.winner === state.you ? 'win' : 'lose');
});

socket.on('state', ({ id, ...towerState }) => session.setRemote(id, towerState));

socket.on('cards', ({ offers, gained }) => {
  setState({ offers });
  if (!gained) return;
  play('gain');
  announce({
    text: 'Nouvelle carte !',
    detail: 'Un bonus pour toi ou un malus pour un rival : à toi de choisir.',
    mine: true,
    kind: 'info',
    color: findPlayer(state.room, state.you)?.color ?? null,
  });
});

socket.on('effect', (effect: Effect) => {
  const from = findPlayer(state.room, effect.from);
  const to = findPlayer(state.room, effect.to);
  const info = CARDS[effect.card];
  playCard(effect.card);
  session.applyEffect(effect.to, effect.card, effect.kind === 'malus');
  const onMe = effect.to === state.you;
  announce({
    text: info.announce(from?.name ?? 'Quelqu’un', to?.name ?? 'quelqu’un'),
    detail: onMe ? (info.onYou ?? info.effect) : info.effect,
    mine: onMe,
    card: effect.card,
    kind: effect.kind,
    color: from?.color ?? null,
  });
});

socket.on('hold', ({ id, on, ms }) => {
  session.setHold(id, on, ms ?? RULES.HOLD_MS);
  if (on) play('holdTick');
});

socket.on('out', ({ id, reason }) => {
  session.eliminate(id);
  const player = findPlayer(state.room, id);
  const name = player?.name ?? 'Un joueur';
  if (id === state.you) play('out');
  announce({
    text: reason === 'hearts' ? `${name} n’a plus de cerises !` : `${name} a quitté la cuisine.`,
    detail: reason === 'hearts' ? 'Éliminé pour cette manche.' : null,
    mine: id === state.you,
    kind: 'info',
    color: player?.color ?? null,
  });
});

socket.on('hearts', () => {
  // Le nombre de cerises arrive avec l'état du salon ; rien d'autre à faire ici.
});
