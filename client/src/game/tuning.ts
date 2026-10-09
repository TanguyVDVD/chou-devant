// Tous les réglages de sensation de jeu, au même endroit.
// Les distances sont en cases (1 case = 32 px) ou en pixels quand c'est précisé,
// les vitesses en pixels par pas de simulation (60 pas par seconde).
// Après un changement : `npm test` (tests/unit/physique.test.ts vérifie la stabilité).

// --- Présentoir et parts ---------------------------------------------------

export const BASE_CELLS = 5;
export const GIANT_SCALE = 1.5;

// --- Moteur physique -------------------------------------------------------

export const ENGINE = {
  /** Sous-pas par pas de jeu. Plus = tour plus rigide (moins d'enfoncement), plus de calcul. */
  substeps: 3,
  /** Passes de séparation des parts qui se chevauchent. Plus = moins d'enfoncement. */
  positionIterations: 12,
  /** Passes de résolution des chocs et du frottement. */
  velocityIterations: 8,
  /** Pesanteur (1 ≈ 31 cases/s²). Plus = parts plus lourdes, bascules plus vives. */
  gravity: 1,
};

// --- Matière des parts -----------------------------------------------------

export const MATERIAL = {
  /** Frottement de glissement entre parts (0 = savon, 1 = très accrocheur). */
  friction: 0.9,
  /** Adhérence à l'arrêt : plus = une part posée se remet moins facilement à glisser. */
  frictionStatic: 1.5,
  /** Freinage dans l'air : calme les parts qui tombent ou basculent. */
  frictionAir: 0.02,
  /** Rebond. 0 = aucun. */
  restitution: 0,
  density: 0.0015,
  /** Chevauchement toléré entre deux parts au repos, en pixels. */
  slop: 0.05,
  /** Les parts physiques sont plus petites que la grille de ce nombre de pixels, pour se glisser dans un trou. */
  skin: 1,
  baseFriction: 1,
  baseFrictionStatic: 1.5,
  /** Motte de beurre. */
  soapyFriction: 0.02,
  soapyFrictionStatic: 0,
};

// --- Chute de la part en main ----------------------------------------------

export const FALL = {
  speed: 1.7,
  /** Multiplicateurs : flèche du bas, Blancs en neige, Coup de feu. */
  softDrop: 5,
  slow: 0.45,
  turbo: 2.2,
  /** Vitesse verticale donnée à la part à l'instant où elle se pose. 0 = posée sans choc. */
  landSpeed: 0,
  /** Précision de la pose au contact, en pixels. */
  contactPrecision: 1 / 1024,
  spawnDelayMs: 380,
  /** Hauteur d'apparition au-dessus de la tour, et hauteur minimale, en cases. */
  spawnAbove: 11,
  minSpawnHeight: 13,
  /** Déplacement latéral maximal depuis le centre, en cases (la vue en montre 5 de chaque côté). */
  moveLimit: 4.5,
};

/** Répétition automatique quand on garde ← ou → enfoncée. */
export const INPUT = {
  repeatDelayMs: 170,
  repeatEveryMs: 60,
};

// --- Repos de la tour ------------------------------------------------------

export const REST = {
  /**
   * Maintien en place : un corps qui bouge de moins que cela en un sous-pas est remis
   * exactement où il était. L'unité est le déplacement dû à la seule pesanteur en un
   * sous-pas : garder la valeur un peu au-dessus de 1. Plus grand = une tour à peine
   * déséquilibrée tient quand même ; sous 1 = les parts posées de travers glissent lentement.
   */
  hold: 1.3,
  /**
   * Tour entièrement immobile pendant ce délai : le calcul s'arrête jusqu'au prochain événement.
   * Assez long pour qu'une part en équilibre instable ait le temps de partir avant.
   */
  calmMs: 1000,
  /** Une part compte dans la hauteur une fois posée depuis ce délai et sous ces vitesses. */
  settleMs: 250,
  settleSpeed: 0.9,
  settleSpin: 0.04,
  /** Passé ce délai, une part encore agitée inquiète les mimiques. */
  shakyMs: 700,
};

// --- Parts perdues ---------------------------------------------------------

/** Une part est perdue sous cette profondeur ou au-delà de cet écart latéral, en cases. */
export const LOST = { below: 7, aside: 16 };

// --- Cartes ----------------------------------------------------------------

/** Durée des effets minutés, en millisecondes. */
export const DURATIONS = {
  slow: 8000,
  turbo: 8000,
  invert: 5000,
  fog: 6000,
  wind: 1200,
};

export const WIND = {
  /** Dérive de la part en main, en px/pas. */
  drift: 1.3,
  /** Poussée sur la part du sommet (en fraction de son poids par ms²). */
  push: 0.0009,
  /** La part du sommet n'est jamais poussée plus loin que cela, en cases. */
  maxShove: 0.5,
};

export const WELD = {
  /** Distance, en pixels, à laquelle le caramel attrape une voisine. Doit dépasser `MATERIAL.skin`. */
  reach: 2,
};
