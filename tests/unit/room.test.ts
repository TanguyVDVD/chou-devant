import { expect, test } from 'vitest';
import type { OutMessage } from '../../shared/protocol';
import { RULES } from '../../shared/rules';
import { Room, cleanName, sanitizeState, type Player } from '../../server/room';

interface Ctx {
  room: Room;
  clock: { t: number };
  players: Player[];
}

function setup(count = 2): Ctx {
  const clock = { t: 1000 };
  const room = new Room('TEST', { now: () => clock.t, rng: () => 0 });
  const players: Player[] = [];
  for (let i = 0; i < count; i += 1) {
    const joined = room.addPlayer({ token: `token-number-${i}`, name: `J${i}`, avatar: 'chou' });
    if (!joined.player) throw new Error(joined.error);
    players.push(joined.player);
  }
  room.flush();
  return { room, clock, players };
}

function startRound({ room, clock, players }: Ctx): void {
  for (const p of players.slice(1)) room.setReady(p.id, true);
  expect(room.start(players[0].id)).toEqual({ ok: true });
  clock.t += RULES.COUNTDOWN_MS;
  room.tick();
  room.flush();
}

function events<E extends OutMessage['ev']>(room: Room, name: E): Extract<OutMessage, { ev: E }>[] {
  return room.flush().filter((m): m is Extract<OutMessage, { ev: E }> => m.ev === name);
}

const AT_FINISH = { h: RULES.FINISH_HEIGHT, b: [] };

test('nettoie les pseudos et refuse le HTML', () => {
  expect(cleanName('  <b>Léa</b>  ')).toBe('bLéa/b');
  expect(cleanName('')).toBe('Commis');
  expect(cleanName({ toString: 1 })).toBe('Commis');
  expect(cleanName(42)).toBe('Commis');
  expect(cleanName('x'.repeat(40))).toHaveLength(RULES.NAME_MAX);
});

test('refuse un cinquième joueur et attribue des couleurs distinctes', () => {
  const { room, players } = setup(4);
  expect(players.map((p) => p.color)).toEqual([0, 1, 2, 3]);
  const extra = room.addPlayer({ token: 'token-number-9', name: 'Trop', avatar: 'chou' });
  expect(extra.error).toMatch(/complet/);
});

test("ne démarre qu'avec 2 joueurs prêts, et seulement par l'hôte", () => {
  const solo = setup(1);
  expect(solo.room.start(solo.players[0].id)).toMatchObject({ error: /au moins 2/ });

  const { room, players } = setup(2);
  expect(room.start(players[0].id)).toMatchObject({ error: /prêt/ });
  room.setReady(players[1].id, true);
  expect(room.start(players[1].id)).toMatchObject({ error: /hôte/ });
  expect(room.start(players[0].id)).toEqual({ ok: true });
  expect(room.phase).toBe('countdown');
});

test('passe en jeu après le compte à rebours', () => {
  const ctx = setup(2);
  startRound(ctx);
  expect(ctx.room.phase).toBe('playing');
  expect(ctx.room.players.every((p) => p.alive && p.hearts === RULES.HEARTS)).toBe(true);
});

test('une part tombée coûte une cerise, la troisième élimine et donne la manche au survivant', () => {
  const ctx = setup(2);
  startRound(ctx);
  const [a, b] = ctx.players;
  ctx.room.onBrickLost(a.id);
  ctx.room.onBrickLost(a.id);
  expect(a.hearts).toBe(1);
  expect(ctx.room.phase).toBe('playing');
  ctx.room.onBrickLost(a.id);
  expect(a.alive).toBe(false);
  expect(ctx.room.phase).toBe('scores');
  expect(b.wins).toBe(1);
  const end = events(ctx.room, 'round:end')[0].data;
  expect(end.winner).toBe(b.id);
  expect(end.reason).toBe('survivor');
});

test('la victoire demande de tenir 3 secondes au-dessus de la ligne', () => {
  const ctx = setup(2);
  startRound(ctx);
  const [a] = ctx.players;
  ctx.room.onState(a.id, AT_FINISH);
  ctx.clock.t += 2000;
  ctx.room.onState(a.id, AT_FINISH);
  ctx.room.tick();
  expect(ctx.room.phase).toBe('playing');

  // La tour redescend : le chrono repart de zéro.
  ctx.room.onState(a.id, { h: RULES.FINISH_HEIGHT - 2, b: [] });
  ctx.room.onState(a.id, AT_FINISH);
  ctx.clock.t += 2000;
  ctx.room.onState(a.id, AT_FINISH);
  ctx.room.tick();
  expect(ctx.room.phase).toBe('playing');

  ctx.clock.t += 1000;
  ctx.room.onState(a.id, AT_FINISH);
  ctx.room.tick();
  expect(ctx.room.phase).toBe('scores');
  expect(a.wins).toBe(1);
});

test('le chrono de victoire tombe si le joueur ne donne plus de nouvelles', () => {
  const ctx = setup(2);
  startRound(ctx);
  const [a] = ctx.players;
  ctx.room.onState(a.id, AT_FINISH);
  ctx.clock.t += RULES.HOLD_MS + 500;
  ctx.room.tick();
  expect(ctx.room.phase).toBe('playing');
  expect(a.holdSince).toBeNull();
});

test('franchir un palier donne une carte, deux au maximum en main', () => {
  const ctx = setup(2);
  startRound(ctx);
  const [a] = ctx.players;
  ctx.room.onState(a.id, { h: RULES.TIER_HEIGHT, b: [] });
  expect(a.offers).toHaveLength(1);
  ctx.room.onState(a.id, { h: 1, b: [] });
  ctx.room.onState(a.id, { h: RULES.TIER_HEIGHT, b: [] });
  expect(a.offers, 'un palier déjà franchi ne redonne pas de carte').toHaveLength(1);
  ctx.room.onState(a.id, { h: RULES.TIER_HEIGHT * 4, b: [] });
  expect(a.offers).toHaveLength(RULES.MAX_OFFERS);
});

test('un bonus vise son auteur, un malus vise un adversaire en jeu', () => {
  const ctx = setup(3);
  startRound(ctx);
  const [a, b, c] = ctx.players;
  ctx.room.onState(a.id, { h: RULES.TIER_HEIGHT * 2, b: [] });
  ctx.room.flush();

  expect(ctx.room.useCard(a.id, { choice: 'malus', target: a.id })).toMatchObject({ error: /cible/ });
  expect(ctx.room.useCard(a.id, { choice: 'malus', target: b.id })).toEqual({ ok: true });
  expect(events(ctx.room, 'effect')[0].data).toEqual({ from: a.id, to: b.id, card: 'chef', kind: 'malus' });

  expect(ctx.room.useCard(a.id, { choice: 'bonus' })).toEqual({ ok: true });
  expect(events(ctx.room, 'effect')[0].data).toEqual({ from: a.id, to: a.id, card: 'caramel', kind: 'bonus' });

  expect(ctx.room.useCard(a.id, { choice: 'bonus' })).toMatchObject({ error: /pas de carte/ });
  expect(ctx.room.useCard(c.id, { choice: 'bonus' })).toMatchObject({ error: /pas de carte/ });
});

test('une déconnexion élimine de la manche, la partie continue, puis on peut revenir', () => {
  const ctx = setup(3);
  startRound(ctx);
  const [a, b] = ctx.players;
  ctx.room.disconnect(b.id);
  expect(b.alive).toBe(false);
  expect(ctx.room.phase).toBe('playing');
  expect(ctx.room.players).toHaveLength(3);

  const back = ctx.room.reconnect(b.token);
  expect(back.player?.id).toBe(b.id);
  expect(b.connected).toBe(true);
  expect(b.alive, 'il regarde la fin de la manche').toBe(false);

  ctx.room.onState(a.id, AT_FINISH);
  ctx.clock.t += RULES.HOLD_MS;
  ctx.room.onState(a.id, AT_FINISH);
  ctx.room.tick();
  ctx.clock.t += RULES.SCORES_MS;
  ctx.room.tick();
  expect(ctx.room.phase).toBe('countdown');
  expect(b.alive, 'il rejoue à la manche suivante').toBe(true);
});

test("l'hôte change si l'hôte part", () => {
  const { room, players } = setup(2);
  room.disconnect(players[0].id);
  expect(room.hostId).toBe(players[1].id);
});

test('la partie se gagne en 3 manches puis revient au salon', () => {
  const ctx = setup(2);
  const [a, b] = ctx.players;
  startRound(ctx);
  for (let round = 1; round <= RULES.WINS_TO_WIN; round += 1) {
    for (let i = 0; i < RULES.HEARTS; i += 1) ctx.room.onBrickLost(b.id);
    if (round < RULES.WINS_TO_WIN) {
      expect(ctx.room.phase).toBe('scores');
      ctx.clock.t += RULES.SCORES_MS;
      ctx.room.tick();
      ctx.clock.t += RULES.COUNTDOWN_MS;
      ctx.room.tick();
    }
  }
  expect(a.wins).toBe(RULES.WINS_TO_WIN);
  expect(ctx.room.phase).toBe('final');
  ctx.room.backToLobby(a.id);
  expect(ctx.room.phase).toBe('lobby');
  expect(a.wins).toBe(0);
});

test("la partie s'arrête s'il ne reste qu'un joueur connecté entre deux manches", () => {
  const ctx = setup(2);
  const [, b] = ctx.players;
  startRound(ctx);
  ctx.room.disconnect(b.id);
  expect(ctx.room.phase).toBe('scores');
  ctx.clock.t += RULES.SCORES_MS;
  ctx.room.tick();
  expect(ctx.room.phase).toBe('final');
  expect(ctx.room.snapshot().lastResult?.abandoned).toBe(true);
});

test("un joueur absent du salon d'attente est retiré après le délai de grâce", () => {
  const { room, clock, players } = setup(2);
  room.disconnect(players[1].id);
  clock.t += RULES.LOBBY_GRACE_MS - 1;
  room.tick();
  expect(room.players).toHaveLength(2);
  clock.t += 2;
  room.tick();
  expect(room.players).toHaveLength(1);
});

test("filtre l'état envoyé par un client", () => {
  expect(sanitizeState({ h: 'haut' })).toBeNull();
  expect(sanitizeState({ h: 2, b: [[1, 2, 'x', 4, 5, 6]] })).toBeNull();
  const state = sanitizeState({ h: 999, b: [[1, 2, 3.6, 4, 5, 6]], bw: 5, fx: 3 });
  expect(state?.h).toBe(RULES.MAX_HEIGHT);
  expect(state?.b).toEqual([[1, 2, 4, 4, 5, 6]]);
});
