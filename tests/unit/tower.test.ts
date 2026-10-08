import { expect, test } from 'vitest';
import { FLAG, makeBag, PIECES } from '../../client/src/game/pieces';
import { Tower, type TowerEvent } from '../../client/src/game/tower';

const SECOND = 60;

function run(tower: Tower, steps: number): void {
  for (let i = 0; i < steps; i += 1) tower.step();
}

function setup(seed = 7): { tower: Tower; events: TowerEvent[] } {
  const events: TowerEvent[] = [];
  const tower = new Tower(seed, (event) => events.push(event));
  tower.start();
  return { tower, events };
}

function count(events: TowerEvent[], type: TowerEvent['type']): number {
  return events.filter((e) => e.type === type).length;
}

/** Laisse tomber des parts tout droit jusqu'à en avoir posé `n`. */
function dropBricks(tower: Tower, events: TowerEvent[], n: number): void {
  tower.setSoftDrop(true);
  for (let guard = 0; guard < 60 * SECOND && count(events, 'land') < n; guard += 1) tower.step();
  tower.setSoftDrop(false);
}

test('le sac distribue les 7 formes avant de recommencer, de façon reproductible', () => {
  const first = makeBag(42);
  const second = makeBag(42);
  const drawn = Array.from({ length: 7 }, () => first());
  expect([...drawn].sort()).toEqual(PIECES.map((_, i) => i));
  expect(Array.from({ length: 7 }, () => second())).toEqual(drawn);
});

test('une part lâchée au centre se pose sur le présentoir et fait monter la tour', () => {
  const { tower, events } = setup();
  dropBricks(tower, events, 1);
  tower.stop();
  run(tower, 2 * SECOND);
  expect(count(events, 'lost')).toBe(0);
  expect(tower.height).toBeGreaterThanOrEqual(0.9);
  expect(tower.height).toBeLessThanOrEqual(4);
});

test('plusieurs parts empilées restent stables', () => {
  const { tower, events } = setup();
  dropBricks(tower, events, 4);
  tower.stop();
  run(tower, 3 * SECOND);
  const before = tower.height;
  run(tower, 5 * SECOND);
  expect(count(events, 'lost')).toBe(0);
  expect(before).toBeGreaterThanOrEqual(3);
  expect(Math.abs(tower.height - before)).toBeLessThan(0.3);
});

test('une part poussée hors du présentoir tombe dans le vide', () => {
  const { tower, events } = setup();
  tower.step();
  for (let i = 0; i < 6; i += 1) tower.move(1, false);
  tower.setSoftDrop(true);
  for (let guard = 0; guard < 10 * SECOND && count(events, 'lost') === 0; guard += 1) tower.step();
  tower.stop();
  run(tower, SECOND);
  expect(count(events, 'lost')).toBe(1);
  expect(tower.height).toBe(0);
});

test('les commandes inversées déplacent la part dans le mauvais sens', () => {
  const { tower } = setup();
  tower.step();
  const before = tower.bodies()[0].x;
  tower.applyCard('rhum');
  tower.move(1, false);
  expect(tower.bodies()[0].x).toBeLessThan(before);
});

test('la part ne traverse pas la tour quand on la déplace ou la tourne', () => {
  const { tower, events } = setup();
  dropBricks(tower, events, 1);
  run(tower, SECOND);
  const landed = count(events, 'land');
  // On amène la part suivante au ras de la tour, puis on la bouscule.
  tower.setSoftDrop(true);
  while (count(events, 'land') === landed && tower.bodies().some((b) => b.flags & FLAG.ACTIVE && b.y < -96)) {
    tower.step();
  }
  tower.setSoftDrop(false);
  for (let i = 0; i < 8; i += 1) {
    tower.rotate();
    tower.move(-1, true);
    tower.move(1, true);
  }
  run(tower, 4 * SECOND);
  expect(count(events, 'lost')).toBe(0);
});

test('le coup de fourchette retire la dernière part posée', () => {
  const { tower, events } = setup();
  dropBricks(tower, events, 2);
  run(tower, 2 * SECOND);
  const placed = tower.bodies().filter((b) => !(b.flags & FLAG.ACTIVE)).length;
  tower.applyCard('fourchette');
  expect(count(events, 'eaten')).toBe(1);
  expect(tower.bodies().filter((b) => !(b.flags & FLAG.ACTIVE)).length).toBe(placed - 1);
});

test('le grand plat élargit le présentoir 10 secondes puis revient', () => {
  const { tower } = setup();
  tower.applyCard('plat');
  expect(tower.baseCells).toBe(8);
  run(tower, 11 * SECOND);
  expect(tower.baseCells).toBe(5);
});

test('la part du chef est géante et le caramel la soude', () => {
  const { tower, events } = setup();
  tower.applyCard('chef');
  tower.applyCard('caramel');
  dropBricks(tower, events, 1);
  run(tower, 2 * SECOND);
  const [brick] = tower.bodies();
  expect(brick.flags & FLAG.GIANT).toBeTruthy();
  expect(brick.flags & FLAG.GLUED).toBeTruthy();
  expect(count(events, 'glue')).toBe(1);
});

test('blancs en neige et coup de feu changent la vitesse de chute', () => {
  const fall = (card?: 'neige' | 'feu'): number => {
    const { tower } = setup();
    if (card) tower.applyCard(card);
    tower.step();
    const y0 = tower.bodies()[0].y;
    run(tower, SECOND);
    return tower.bodies()[0].y - y0;
  };
  const normal = fall();
  expect(fall('neige')).toBeLessThan(normal * 0.6);
  expect(fall('feu')).toBeGreaterThan(normal * 1.8);
});

test("l'état réseau ne contient que des entiers et le masque d'effets", () => {
  const { tower, events } = setup();
  tower.applyCard('farine');
  dropBricks(tower, events, 1);
  const state = tower.wire();
  expect(state.fx & 8).toBe(8);
  expect(state.b.length).toBeGreaterThan(0);
  expect(state.b.flat().every(Number.isInteger)).toBe(true);
});
