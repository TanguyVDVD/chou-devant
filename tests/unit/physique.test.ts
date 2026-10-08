// Garde-fous de la sensation de jeu : à relancer après tout changement dans
// client/src/game/tuning.ts. Les parts sont posées comme le ferait un joueur
// (rotation, demi-cases, chute rapide ou non), jamais en trichant sur la physique.
import { expect, test } from 'vitest';
import type { CardId } from '../../shared/rules';
import { FLAG, PIECES } from '../../client/src/game/pieces';
import { Tower, type RenderBody, type TowerEvent } from '../../client/src/game/tower';

const [I, O, T] = [0, 1, 2];
const SECOND = 60;

interface Drop {
  /** quarts de tour */
  rot?: number;
  /** décalage en demi-cases, positif vers la droite */
  dx?: number;
  soft?: boolean;
  /** carte jouée pendant que la part est en main */
  card?: CardId;
}

function setup(seed = 7) {
  const events: TowerEvent[] = [];
  const tower = new Tower(seed, (event) => events.push(event));
  tower.start();
  const count = (type: TowerEvent['type']): number => events.filter((e) => e.type === type).length;

  /** Fait apparaître la part voulue, la place, et la laisse tomber jusqu'à ce qu'elle se pose ou se perde. */
  const place = (type: number, drop: Drop = {}): void => {
    tower.nextType = type;
    for (let guard = 0; guard < 10 * SECOND && !tower.hasActive; guard += 1) tower.step();
    if (drop.card) tower.applyCard(drop.card);
    for (let i = 0; i < (drop.rot ?? 0); i += 1) tower.rotate();
    const dx = drop.dx ?? 0;
    for (let i = 0; i < Math.abs(dx); i += 1) tower.move(dx > 0 ? 1 : -1, true);
    const before = count('land') + count('lost');
    tower.setSoftDrop(drop.soft ?? true);
    for (let guard = 0; guard < 60 * SECOND && count('land') + count('lost') === before; guard += 1) tower.step();
    tower.setSoftDrop(false);
  };

  /** Laisse la tour se reposer, sans nouvelle part ; renvoie le nombre de pas qu'il a fallu. */
  const settle = (max = 15 * SECOND): number => {
    tower.stop();
    let steps = 0;
    while (!tower.resting && steps < max) {
      tower.step();
      steps += 1;
    }
    tower.start();
    return steps;
  };

  const wait = (steps: number): void => {
    tower.stop();
    for (let i = 0; i < steps; i += 1) tower.step();
    tower.start();
  };

  const placed = (): RenderBody[] => tower.bodies().filter((b) => !(b.flags & FLAG.ACTIVE));
  return { tower, events, count, place, settle, wait, placed };
}

test('les rectangles de collision recouvrent exactement les cases de chaque part', () => {
  for (const piece of PIECES) {
    const covered = new Set<string>();
    for (const [x, y, w, h] of piece.blocks) {
      for (let i = 0; i < w; i += 1) for (let j = 0; j < h; j += 1) covered.add(`${x + i + 0.5},${y + j + 0.5}`);
    }
    expect([...covered].sort(), piece.name).toEqual(piece.cells.map(([x, y]) => `${x},${y}`).sort());
  }
});

test.each([
  ['barres', I, 18],
  ['carrés', O, 9],
])('une colonne de %s monte à la ligne de service sans rien perdre et reste strictement immobile', (_, type, n) => {
  const { tower, count, place, settle, wait, placed } = setup();
  for (let i = 0; i < n; i += 1) {
    place(type, { soft: i % 2 === 0 });
    expect(settle(), `la tour se calme vite après la part ${i + 1}`).toBeLessThan(2 * SECOND);
  }
  expect(count('lost')).toBe(0);
  expect(tower.height).toBeGreaterThan(17);
  for (const body of placed()) expect(Math.abs(Math.sin(body.angle * 2))).toBeLessThan(0.01);

  const before = placed();
  wait(10 * SECOND);
  expect(placed()).toEqual(before);
});

test('un mur de 18 étages (carrés côte à côte et barres croisées) tient sans bouger', () => {
  const { tower, count, place, settle, wait, placed } = setup();
  for (let row = 0; row < 3; row += 1) {
    place(O, { dx: -4 });
    settle();
    place(O);
    settle();
    place(I, { dx: -2 });
    settle();
    place(I, { dx: -2 });
    settle();
    place(I, { dx: -2 });
    settle();
    place(I, { dx: -2 });
    settle();
  }
  expect(count('lost')).toBe(0);
  expect(tower.height).toBeGreaterThan(17);
  const before = placed();
  wait(10 * SECOND);
  expect(placed()).toEqual(before);
});

test('la pose ne dépend pas de la vitesse de chute', () => {
  const land = (soft: boolean, card?: CardId): RenderBody[] => {
    const { place, settle, placed, tower } = setup();
    place(O);
    settle();
    place(O);
    settle();
    if (card) tower.applyCard(card);
    place(I, { dx: 1, soft });
    settle();
    return placed();
  };
  const normal = land(false);
  expect(normal).toHaveLength(3);
  expect(normal[2].x).toBeCloseTo(32, 0);
  // Au centième de pixel près : bien en dessous de ce qui s'affiche ou s'envoie sur le réseau.
  const rounded = (bodies: RenderBody[]): number[][] =>
    bodies.map((b) => [Math.round(b.x * 100), Math.round(b.y * 100), Math.round(b.angle * 1000)]);
  expect(rounded(land(true))).toEqual(rounded(normal));
  expect(rounded(land(false, 'neige'))).toEqual(rounded(normal));
  expect(rounded(land(true, 'feu'))).toEqual(rounded(normal));
});

test("une part en porte-à-faux tient tant que son centre est au-dessus de l'appui, et tombe au-delà", () => {
  const overhang = (dx: number) => {
    const game = setup();
    for (let i = 0; i < 3; i += 1) {
      game.place(O);
      game.settle();
    }
    game.place(I, { dx });
    game.settle();
    return game;
  };
  const held = overhang(1);
  expect(held.count('lost')).toBe(0);
  expect(held.placed()[3].x).toBeCloseTo(32, 0);
  expect(Math.abs(held.placed()[3].angle)).toBeLessThan(0.01);

  const fallen = overhang(3);
  expect(fallen.count('lost')).toBe(1);
  expect(fallen.placed()).toHaveLength(3);
});

test('une part posée de travers ne glisse plus une fois calée', () => {
  const { tower, place, settle, wait, placed, count } = setup();
  place(T);
  settle();
  place(I, { dx: 2 }); // retombe en appui sur le présentoir et sur le T
  settle();
  const leaning = placed()[1];
  expect(Math.abs(Math.sin(leaning.angle))).toBeGreaterThan(0.3);
  // On réveille la tour comme le fait chaque part posée : rien ne doit avoir glissé au repos suivant.
  for (let i = 0; i < 3; i += 1) {
    (tower as unknown as { wake(): void }).wake();
    wait(2 * SECOND);
    settle();
  }
  expect(count('lost')).toBe(0);
  expect(placed()[1]).toEqual(leaning);
});

test('deux parties jouées avec les mêmes gestes donnent exactement la même tour', () => {
  const play = (): string => {
    const { tower, place } = setup(99);
    for (let i = 0; i < 14; i += 1) place(i % 7, { dx: (i % 5) - 2, rot: i % 3, soft: i % 2 === 0 });
    return JSON.stringify(tower.wire());
  };
  expect(play()).toBe(play());
});

// --- caramel ---------------------------------------------------------------

test('le caramel soude la part là où elle est posée, même en porte-à-faux', () => {
  const { place, settle, placed, count } = setup();
  for (let i = 0; i < 3; i += 1) {
    place(O);
    settle();
  }
  place(I, { dx: 3, card: 'caramel' }); // sans caramel, cette part tombe (test du porte-à-faux)
  expect(count('glue')).toBe(1);
  const glued = placed()[3];
  expect(glued.flags & FLAG.GLUED).toBeTruthy();
  settle();
  expect(count('lost')).toBe(0);
  expect(placed()[3].x).toBeCloseTo(glued.x, 0);
  expect(placed()[3].y).toBeCloseTo(glued.y, 0);
  expect(Math.abs(placed()[3].angle)).toBeLessThan(0.02);
});

test('chaque caramel joué soude une part : le deuxième attend la part suivante', () => {
  const { tower, place, settle, count } = setup();
  tower.nextType = O;
  tower.step();
  tower.applyCard('caramel');
  tower.applyCard('caramel');
  expect(tower.pending.glue).toBe(true);
  place(O);
  settle();
  expect(count('glue')).toBe(1);
  place(O);
  settle();
  expect(count('glue')).toBe(2);
  expect(tower.pending.glue).toBe(false);
  place(O);
  settle();
  expect(count('glue')).toBe(2);
});

test("une part caramélisée jetée dans le vide garde son caramel pour la suivante", () => {
  const { tower, place, settle, count, placed } = setup();
  place(O, { dx: 12, card: 'caramel' });
  expect(count('lost')).toBe(1);
  expect(count('glue')).toBe(0);
  expect(tower.pending.glue).toBe(true);
  place(O);
  settle();
  expect(count('glue')).toBe(1);
  expect(placed()[0].flags & FLAG.GLUED).toBeTruthy();
});

test('une part soudée au présentoir ne bouge plus, même sous une tour mal posée', () => {
  const { place, settle, placed, count } = setup();
  place(I, { card: 'caramel' });
  settle();
  const anchored = placed()[0];
  place(O, { dx: 5 }); // en porte-à-faux sur le bout de la barre : bascule et tombe
  settle();
  expect(count('lost')).toBe(1);
  expect(placed()[0]).toEqual(anchored);
});

test('la soudure se termine proprement quand la part ou son appui disparaît', () => {
  const { tower, place, settle, placed, count } = setup();
  place(O);
  settle();
  place(O);
  settle();
  place(I, { dx: 3, card: 'caramel' });
  settle();
  expect(placed().filter((b) => b.flags & FLAG.GLUED)).toHaveLength(2); // la barre et le carré qui la porte

  tower.applyCard('fourchette'); // mange la barre soudée
  settle();
  expect(count('eaten')).toBe(1);
  expect(placed()).toHaveLength(2);
  expect(placed().some((b) => b.flags & FLAG.GLUED)).toBe(false);

  // Le carré libéré se comporte de nouveau comme une part ordinaire.
  place(I, { dx: 3 });
  settle();
  expect(count('lost')).toBe(1);
  expect(placed()).toHaveLength(2);
});

test('une part soudée sur le bord du grand plat tombe quand il rétrécit', () => {
  const { tower, place, wait, placed, count } = setup();
  tower.applyCard('plat');
  place(O, { dx: 6, card: 'caramel' });
  expect(count('glue')).toBe(1);
  expect(placed()).toHaveLength(1);
  wait(12 * SECOND);
  expect(tower.baseCells).toBe(5);
  expect(placed()).toHaveLength(0);
  expect(count('lost')).toBe(1);
});

// --- autres cartes ---------------------------------------------------------

test("le courant d'air décale le sommet d'une demi-case au plus et ne fait rien tomber", () => {
  const { tower, place, settle, placed, count } = setup();
  for (let i = 0; i < 4; i += 1) {
    place(O);
    settle();
  }
  const before = placed();
  tower.applyCard('air');
  settle();
  const after = placed();
  expect(count('lost')).toBe(0);
  expect(after).toHaveLength(4);
  const shove = Math.abs(after[3].x - before[3].x);
  expect(shove).toBeGreaterThan(2);
  expect(shove).toBeLessThanOrEqual(16.5);
});

test("le courant d'air fait dériver la part en main, qui retrouve ensuite la grille", () => {
  const { tower } = setup();
  tower.nextType = O;
  tower.step();
  const start = tower.bodies()[0].x;
  tower.applyCard('air');
  for (let i = 0; i < 1.5 * SECOND; i += 1) tower.step();
  const drift = tower.bodies()[0].x - start;
  expect(Math.abs(drift)).toBeGreaterThan(48);
  expect(Math.abs(drift) % 16).toBeCloseTo(0, 6);
});

test('la motte de beurre fait glisser une part qui, sèche, serait restée calée', () => {
  const lean = (card?: CardId) => {
    const game = setup();
    game.place(T);
    game.settle();
    game.place(I, { dx: 2, card });
    game.settle();
    return game;
  };
  expect(lean().count('lost')).toBe(0);
  expect(lean('beurre').count('lost')).toBe(1);
});

test('une part beurrée posée bien à plat reste en place et porte la suivante', () => {
  const { place, settle, placed, count } = setup();
  place(I);
  settle();
  place(O, { card: 'beurre' });
  settle();
  place(O, { dx: 1 });
  settle();
  expect(count('lost')).toBe(0);
  expect(placed()[1].flags & FLAG.SOAPY).toBeTruthy();
  expect(placed()[1].x).toBeCloseTo(16, 0);
});

test('la part du chef, géante, se pose et porte la suite sans faire trembler la tour', () => {
  const { tower, place, settle, wait, placed, count } = setup();
  place(O);
  settle();
  tower.applyCard('chef');
  place(T);
  settle();
  place(O);
  settle();
  expect(count('lost')).toBe(0);
  expect(placed()[1].flags & FLAG.GIANT).toBeTruthy();
  expect(tower.height).toBeGreaterThan(6.5);
  const before = placed();
  wait(5 * SECOND);
  expect(placed()).toEqual(before);
});

test('le coup de fourchette réveille la tour : ce qui reposait sur la part mangée retombe', () => {
  const { tower, place, settle, placed, count } = setup();
  place(O);
  settle();
  place(O);
  settle();
  const below = placed()[0];
  tower.applyCard('fourchette');
  settle();
  expect(count('eaten')).toBe(1);
  expect(placed()).toEqual([below]);
  expect(tower.height).toBeCloseTo(63 / 32, 1);
});

test('quand le grand plat rétrécit, les parts posées hors du présentoir tombent', () => {
  const { tower, place, wait, placed, count } = setup();
  tower.applyCard('plat');
  place(O, { dx: 6 });
  place(O);
  expect(placed()).toHaveLength(2);
  wait(12 * SECOND);
  expect(tower.baseCells).toBe(5);
  expect(count('lost')).toBe(1);
  expect(placed()).toHaveLength(1);
});
