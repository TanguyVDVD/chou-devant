// Les parts de gâteau : formes de tétrominos décrites en cases autour d'un pivot.
// Les pivots de I et O sont à une intersection de la grille, les autres au
// centre d'une case, pour que les parts restent alignées en tournant.

export const CELL = 32;
export const GIANT_SCALE = 1.5;
export const BASE_CELLS = 5;
export const WIDE_BASE_CELLS = 8;

export interface Piece {
  name: string;
  cells: ReadonlyArray<readonly [number, number]>;
  /** vrai si le pivot tombe sur une intersection (décalage d'une demi-case) */
  half: boolean;
}

export const PIECES: readonly Piece[] = [
  { name: 'I', cells: [[-1.5, -0.5], [-0.5, -0.5], [0.5, -0.5], [1.5, -0.5]], half: true },
  { name: 'O', cells: [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]], half: true },
  { name: 'T', cells: [[-1, 0], [0, 0], [1, 0], [0, -1]], half: false },
  { name: 'L', cells: [[-1, 0], [0, 0], [1, 0], [1, -1]], half: false },
  { name: 'J', cells: [[-1, 0], [0, 0], [1, 0], [-1, -1]], half: false },
  { name: 'S', cells: [[-1, 0], [0, 0], [0, -1], [1, -1]], half: false },
  { name: 'Z', cells: [[-1, -1], [0, -1], [0, 0], [1, 0]], half: false },
];

/** Drapeaux d'une part dans l'état envoyé sur le réseau. */
export const FLAG = { ACTIVE: 1, SOAPY: 2, GLUED: 4, GIANT: 8, FALLING: 16 } as const;

export type TimedEffect = 'slow' | 'turbo' | 'invert' | 'fog' | 'wide' | 'wind';

/** Effets en cours, compressés en un masque de bits pour les autres joueurs. */
export const FX_BITS: Record<TimedEffect, number> = {
  slow: 1,
  turbo: 2,
  invert: 4,
  fog: 8,
  wide: 16,
  wind: 32,
};
/** La tour penche ou s'écroule : sert aux mimiques chez les autres joueurs. */
export const FX_WORRIED = 64;

export interface Point {
  x: number;
  y: number;
}

/** Centre de masse d'une part, en cases, par rapport à son pivot. */
export function centroid(type: number): Point {
  const cells = PIECES[type].cells;
  const sum = cells.reduce((acc, [x, y]) => ({ x: acc.x + x, y: acc.y + y }), { x: 0, y: 0 });
  return { x: sum.x / cells.length, y: sum.y / cells.length };
}

const LOCAL_CELLS = PIECES.map((piece, type) => {
  const c = centroid(type);
  return piece.cells.map(([x, y]) => [x - c.x, y - c.y] as const);
});

/** Cases d'une part relatives à son centre de masse, en cases. */
export function localCells(type: number): ReadonlyArray<readonly [number, number]> {
  return LOCAL_CELLS[type] ?? LOCAL_CELLS[0];
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tirage « sac de 7 » : tous les joueurs d'une manche reçoivent la même suite. */
export function makeBag(seed: number): () => number {
  const rand = mulberry32(seed);
  let bag: number[] = [];
  return () => {
    if (bag.length === 0) {
      bag = PIECES.map((_, i) => i);
      for (let i = bag.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
    }
    return bag.pop() ?? 0;
  };
}
