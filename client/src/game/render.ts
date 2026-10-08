import { RULES } from '../../../shared/rules';
import { COLORS, EFFECT_LABELS, FONT_DISPLAY, FONT_TEXT, mix } from '../theme';
import { CELL, FLAG, FX_BITS, FX_WORRIED, GIANT_SCALE, PIECES, localCells, type TimedEffect } from './pieces';
import { Tower, type RenderBody } from './tower';

const VIEW_CELLS = 13;
const GROUND_MARGIN = 3.2 * CELL;
const COUNTER_Y = 2.6 * CELL;
const FACE_CELL = 1;
const TAU = Math.PI * 2;

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
  size: number;
  color: string;
  spin: number;
}

export interface Popup {
  x: number;
  y: number;
  text: string;
  life: number;
  ttl: number;
  color: string;
}

export interface Scene {
  bodies: RenderBody[];
  baseCells: number;
  color: string;
  /** hauteur stabilisée, en étages */
  height: number;
  /** masque d'effets en cours, tel qu'envoyé sur le réseau */
  fx: number;
  /** progression du maintien au-dessus de la ligne, de 0 à 1 */
  hold: number | null;
  mini: boolean;
  time: number;
  /** décalage vertical de la caméra, en pixels du monde */
  camera: number;
  windDir: number;
  next: number | null;
  effects: Record<TimedEffect, number> | null;
  pending: { glue: boolean; soap: boolean; giant: boolean } | null;
  particles: Particle[];
  popups: Popup[];
  shakeX: number;
  shakeY: number;
  frozen: boolean;
}

interface View {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  /** pixels écran par pixel du monde */
  s: number;
  ox: number;
  oy: number;
}

type Segment = readonly [number, number, number, number];

// Contour de chaque forme : les côtés de case qui ne touchent aucune autre case.
const OUTLINES: Segment[][] = PIECES.map((piece, type) => {
  const cells = localCells(type);
  const has = (x: number, y: number): boolean =>
    cells.some(([cx, cy]) => Math.abs(cx - x) < 0.01 && Math.abs(cy - y) < 0.01);
  const segments: Segment[] = [];
  for (const [x, y] of cells) {
    if (!has(x, y - 1)) segments.push([x - 0.5, y - 0.5, x + 0.5, y - 0.5]);
    if (!has(x, y + 1)) segments.push([x - 0.5, y + 0.5, x + 0.5, y + 0.5]);
    if (!has(x - 1, y)) segments.push([x - 0.5, y - 0.5, x - 0.5, y + 0.5]);
    if (!has(x + 1, y)) segments.push([x + 0.5, y - 0.5, x + 0.5, y + 0.5]);
  }
  void piece;
  return segments;
});

const MAIN_VIEW_FLOORS = 19;
const MINI_VIEW_FLOORS = 11;

/** Échelle d'une vue : toute la largeur de jeu, et assez de hauteur pour voir le présentoir. */
export function viewScale(width: number, height: number, mini: boolean): number {
  const floors = mini ? MINI_VIEW_FLOORS : MAIN_VIEW_FLOORS;
  return Math.min(width / (VIEW_CELLS * CELL), height / (floors * CELL));
}

/** Où placer la caméra pour garder en vue la zone d'apparition des parts. */
export function cameraTarget(height: number, width: number, canvasHeight: number, mini: boolean): number {
  const visible = canvasHeight / viewScale(width, canvasHeight, mini);
  // En petit, on suit seulement le sommet de la tour : pas besoin de la zone d'apparition.
  const needed = (mini ? height + 6 : Math.max(height + 12, 14)) * CELL;
  return Math.max(0, needed - (visible - GROUND_MARGIN));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function tileHash(i: number, j: number): number {
  const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function drawWall(v: View, scene: Scene): void {
  const { ctx, w, h, s } = v;
  ctx.fillStyle = COLORS.carrelage;
  ctx.fillRect(0, 0, w, h);

  const tile = 2 * CELL * s;
  const startX = v.ox - Math.ceil(v.ox / tile) * tile;
  const startY = v.oy - Math.ceil(v.oy / tile) * tile;
  const baseJ = Math.round((startY - v.oy) / tile);
  const baseI = Math.round((startX - v.ox) / tile);

  // Quelques carreaux plus clairs, toujours les mêmes, pour donner du rythme.
  for (let x = startX, i = baseI; x < w; x += tile, i += 1) {
    for (let y = startY, j = baseJ; y < h; y += tile, j += 1) {
      const hash = tileHash(i, j);
      if (hash > 0.86) {
        ctx.fillStyle = mix(COLORS.carrelage, COLORS.creme, 0.55);
        ctx.fillRect(x, y, tile, tile);
      }
    }
  }

  ctx.strokeStyle = COLORS.joint;
  ctx.lineWidth = Math.max(1, 1.6 * s);
  ctx.beginPath();
  for (let x = startX; x < w; x += tile) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = startY; y < h; y += tile) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();

  if (scene.mini) return;

  // Toise peinte sur le mur : un trait par étage, un repère à chaque palier de carte.
  ctx.font = `${Math.round(13 * s)}px ${FONT_DISPLAY}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (let floor = 1; floor <= RULES.FINISH_HEIGHT + 4; floor += 1) {
    const y = v.oy - floor * CELL * s;
    if (y < -20 || y > h + 20) continue;
    const tier = floor % RULES.TIER_HEIGHT === 0 && floor < RULES.FINISH_HEIGHT;
    const reached = scene.height >= floor;
    ctx.strokeStyle = tier ? COLORS.choco : mix(COLORS.joint, COLORS.choco, 0.35);
    ctx.globalAlpha = tier ? (reached ? 0.35 : 0.9) : 0.6;
    ctx.lineWidth = (tier ? 2.5 : 1.5) * s;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo((tier ? 22 : 10) * s, y);
    ctx.stroke();
    if (tier) {
      ctx.fillStyle = COLORS.choco;
      ctx.fillText(reached ? '✓' : 'carte', 27 * s, y + s);
    }
  }
  ctx.globalAlpha = 1;
}

function drawGuides(v: View, scene: Scene): void {
  const { ctx, s } = v;
  const half = (scene.baseCells * CELL * s) / 2;
  ctx.save();
  ctx.strokeStyle = COLORS.choco;
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = Math.max(1, 1.5 * s);
  ctx.setLineDash([5 * s, 7 * s]);
  ctx.beginPath();
  for (const x of [v.ox - half, v.ox + half]) {
    ctx.moveTo(x, v.oy);
    ctx.lineTo(x, 0);
  }
  ctx.stroke();
  ctx.restore();
}

function drawFinish(v: View, scene: Scene): void {
  const { ctx, w, s } = v;
  const y = v.oy - RULES.FINISH_HEIGHT * CELL * s;
  if (y < -14 * s && !scene.mini) {
    // La ligne est encore hors champ : on rappelle où elle se trouve.
    const left = Math.max(1, Math.ceil(RULES.FINISH_HEIGHT - scene.height));
    const text = `Ligne de service dans ${left} étage${left > 1 ? 's' : ''}`;
    ctx.font = `700 ${Math.round(12 * s)}px ${FONT_TEXT}`;
    const width = ctx.measureText(text).width + 20 * s;
    const x = v.w - width - 10 * s;
    const top = v.h - 36 * s;
    roundRect(ctx, x, top, width, 24 * s, 12 * s);
    ctx.fillStyle = COLORS.framboise;
    ctx.fill();
    ctx.fillStyle = COLORS.creme;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 10 * s, top + 12.5 * s);
    return;
  }
  if (y < -40 * s || y > v.h + 40 * s) return;
  const holding = scene.hold !== null;
  ctx.save();
  ctx.strokeStyle = COLORS.framboise;
  ctx.lineWidth = (holding ? 6 : 4) * s;
  if (!holding) {
    ctx.setLineDash([14 * s, 9 * s]);
    ctx.lineDashOffset = -(scene.time / 60) * s;
  }
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(w, y);
  ctx.stroke();
  ctx.restore();

  if (scene.mini) return;
  const label = 'Service !';
  ctx.font = `${Math.round(15 * s)}px ${FONT_DISPLAY}`;
  const padding = 9 * s;
  const width = ctx.measureText(label).width + padding * 2 + 20 * s;
  const height = 26 * s;
  const x = w - width - 8 * s;
  roundRect(ctx, x, y - height / 2, width, height, height / 2);
  ctx.fillStyle = COLORS.framboise;
  ctx.fill();
  ctx.fillStyle = COLORS.creme;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + padding + 20 * s, y + s);
  drawBell(ctx, x + padding + 8 * s, y, 8 * s, COLORS.creme);
}

function drawBell(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y + r * 0.2, r, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(x - r * 1.2, y + r * 0.2, r * 2.4, r * 0.3);
  ctx.beginPath();
  ctx.arc(x, y - r * 0.9, r * 0.22, 0, TAU);
  ctx.fill();
}

function drawStand(v: View, scene: Scene): void {
  const { ctx, s } = v;
  const half = (scene.baseCells * CELL * s) / 2;
  const top = v.oy;
  const plate = 11 * s;
  const footTop = top + plate;
  const footBottom = v.oy + COUNTER_Y * s + 4 * s;

  ctx.lineJoin = 'round';
  ctx.strokeStyle = COLORS.choco;
  ctx.lineWidth = 2.5 * s;

  // pied
  ctx.fillStyle = mix(COLORS.creme, COLORS.choco, 0.12);
  ctx.beginPath();
  ctx.moveTo(v.ox - 9 * s, footTop);
  ctx.lineTo(v.ox + 9 * s, footTop);
  ctx.lineTo(v.ox + 30 * s, footBottom);
  ctx.lineTo(v.ox - 30 * s, footBottom);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // napperon
  ctx.fillStyle = COLORS.creme;
  const scallops = Math.max(4, Math.round(scene.baseCells * 2));
  const step = (half * 2) / scallops;
  for (let i = 0; i < scallops; i += 1) {
    ctx.beginPath();
    ctx.arc(v.ox - half + step * (i + 0.5), footTop, step / 2, 0, Math.PI);
    ctx.fill();
    ctx.stroke();
  }

  // plateau : ses bords sont exactement ceux du présentoir physique
  roundRect(ctx, v.ox - half, top, half * 2, plate, 4 * s);
  ctx.fillStyle = COLORS.creme;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = COLORS.choco;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(v.ox + side * half, top - 9 * s);
    ctx.lineTo(v.ox + side * (half - 7 * s), top - 1.5 * s);
    ctx.lineTo(v.ox + side * (half + 7 * s), top - 1.5 * s);
    ctx.closePath();
    ctx.fill();
  }
}

function drawCounter(v: View): void {
  const { ctx, w, h, s } = v;
  const y = v.oy + COUNTER_Y * s;
  if (y > h) return;
  ctx.fillStyle = mix(COLORS.creme, COLORS.choco, 0.2);
  ctx.fillRect(0, y, w, h - y);
  ctx.fillStyle = COLORS.choco;
  ctx.fillRect(0, y, w, 3 * s);
}

function drawFace(ctx: CanvasRenderingContext2D, size: number, worried: boolean, falling: boolean, time: number, id: number): void {
  const eye = size * 0.14;
  const gap = size * 0.2;
  const blink = (time + id * 733) % 3600 < 120 && !worried && !falling;
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = COLORS.choco;
  ctx.lineWidth = Math.max(0.8, size * 0.035);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * gap, -size * 0.06, eye, blink ? eye * 0.15 : eye * (worried || falling ? 1.25 : 1), 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    if (!blink) {
      ctx.fillStyle = COLORS.choco;
      ctx.beginPath();
      ctx.arc(side * gap, -size * 0.06 + (falling ? -eye * 0.3 : eye * 0.25), eye * (worried ? 0.35 : 0.5), 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#fff';
    }
  }
  ctx.strokeStyle = COLORS.choco;
  ctx.lineWidth = Math.max(1, size * 0.05);
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (falling) {
    ctx.ellipse(0, size * 0.24, size * 0.09, size * 0.12, 0, 0, TAU);
    ctx.fillStyle = COLORS.choco;
    ctx.fill();
  } else if (worried) {
    ctx.moveTo(-size * 0.13, size * 0.26);
    ctx.quadraticCurveTo(-size * 0.06, size * 0.18, 0, size * 0.25);
    ctx.quadraticCurveTo(size * 0.06, size * 0.32, size * 0.13, size * 0.24);
    ctx.stroke();
  } else {
    ctx.arc(0, size * 0.16, size * 0.11, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }
}

function drawBrick(v: View, scene: Scene, body: RenderBody): void {
  const { ctx, s } = v;
  const active = (body.flags & FLAG.ACTIVE) !== 0;
  const soapy = (body.flags & FLAG.SOAPY) !== 0;
  const glued = (body.flags & FLAG.GLUED) !== 0;
  const falling = (body.flags & FLAG.FALLING) !== 0;
  const scale = body.flags & FLAG.GIANT ? GIANT_SCALE : 1;
  const size = CELL * scale * s;
  const cells = localCells(body.type);
  const outline = OUTLINES[body.type] ?? OUTLINES[0];

  let fill: string = scene.color;
  let top = mix(scene.color, COLORS.creme, 0.34);
  if (soapy) {
    fill = mix(COLORS.citron, COLORS.creme, 0.5);
    top = COLORS.creme;
  }
  if (active) {
    fill = COLORS.creme;
    top = soapy ? mix(COLORS.citron, COLORS.creme, 0.3) : mix(scene.color, COLORS.creme, 0.45);
  }

  const trace = (): void => {
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of outline) {
      ctx.moveTo(x1 * size, y1 * size);
      ctx.lineTo(x2 * size, y2 * size);
    }
  };

  ctx.save();
  ctx.translate(v.ox + body.x * s, v.oy + body.y * s);
  ctx.rotate(body.angle);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (active) {
    // halo clair : la part en main se détache toujours du décor
    trace();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 9 * s;
    ctx.stroke();
  }

  ctx.fillStyle = fill;
  for (const [x, y] of cells) {
    ctx.fillRect((x - 0.5) * size - 0.4, (y - 0.5) * size - 0.4, size + 0.8, size + 0.8);
  }
  ctx.fillStyle = top;
  const inset = size * 0.17;
  for (const [x, y] of cells) {
    roundRect(ctx, (x - 0.5) * size + inset, (y - 0.5) * size + inset, size - inset * 2, size - inset * 2, size * 0.2);
    ctx.fill();
  }
  if (soapy) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = size * 0.09;
    for (const [x, y] of cells) {
      ctx.beginPath();
      ctx.moveTo((x - 0.28) * size, (y + 0.1) * size);
      ctx.lineTo((x + 0.05) * size, (y - 0.26) * size);
      ctx.stroke();
    }
  }

  trace();
  if (glued) {
    ctx.strokeStyle = mix(COLORS.citron, COLORS.choco, 0.35);
    ctx.lineWidth = 7 * s;
    ctx.stroke();
    trace();
  }
  ctx.strokeStyle = COLORS.choco;
  ctx.lineWidth = Math.max(1, (active ? 3.2 : 2.3) * s);
  ctx.stroke();

  const [fx, fy] = cells[FACE_CELL];
  ctx.translate(fx * size, fy * size);
  const worried = (scene.fx & FX_WORRIED) !== 0 && !active;
  drawFace(ctx, size, worried, falling, scene.time, body.id);
  ctx.restore();
}

function drawDropGuide(v: View, body: RenderBody): void {
  const { ctx, s } = v;
  const scale = body.flags & FLAG.GIANT ? GIANT_SCALE : 1;
  const cos = Math.cos(body.angle);
  const sin = Math.sin(body.angle);
  let min = Infinity;
  let max = -Infinity;
  let bottom = -Infinity;
  for (const [x, y] of localCells(body.type)) {
    const wx = body.x + (x * cos - y * sin) * CELL * scale;
    const wy = body.y + (x * sin + y * cos) * CELL * scale;
    min = Math.min(min, wx - (CELL * scale) / 2);
    max = Math.max(max, wx + (CELL * scale) / 2);
    bottom = Math.max(bottom, wy + (CELL * scale) / 2);
  }
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.globalAlpha = 0.22;
  ctx.fillRect(v.ox + min * s, v.oy + bottom * s, (max - min) * s, Math.max(0, -bottom) * s);
  ctx.restore();
}

function drawParticles(v: View, scene: Scene): void {
  const { ctx, s } = v;
  for (const p of scene.particles) {
    const alpha = Math.max(0, 1 - p.life / p.ttl);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(v.ox + p.x * s, v.oy + p.y * s);
    ctx.rotate(p.spin * p.life * 0.01);
    ctx.fillStyle = p.color;
    ctx.fillRect((-p.size / 2) * s, (-p.size / 2) * s, p.size * s, p.size * s);
    ctx.restore();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const popup of scene.popups) {
    const t = popup.life / popup.ttl;
    const pop = Math.min(1, t * 6);
    ctx.save();
    ctx.globalAlpha = Math.min(1, (1 - t) * 3);
    ctx.translate(v.ox + popup.x * s, v.oy + (popup.y - t * 46) * s);
    ctx.scale(0.6 + pop * 0.4, 0.6 + pop * 0.4);
    ctx.font = `${Math.round(24 * s)}px ${FONT_DISPLAY}`;
    ctx.lineWidth = 6 * s;
    ctx.strokeStyle = COLORS.creme;
    ctx.lineJoin = 'round';
    ctx.strokeText(popup.text, 0, 0);
    ctx.fillStyle = popup.color;
    ctx.fillText(popup.text, 0, 0);
    ctx.restore();
  }
}

function drawFog(v: View, scene: Scene, strength: number): void {
  const { ctx, w, h } = v;
  const edge = h * 0.58;
  ctx.save();
  ctx.globalAlpha = 0.96 * strength;
  ctx.fillStyle = '#fffaf0';
  ctx.fillRect(0, 0, w, edge);
  const puffs = 7;
  for (let i = 0; i <= puffs; i += 1) {
    const wobble = Math.sin(scene.time / 500 + i * 1.7) * h * 0.012;
    ctx.beginPath();
    ctx.arc((w / puffs) * i, edge + wobble, w / puffs / 1.3, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawWind(v: View, scene: Scene): void {
  const { ctx, w, h, s } = v;
  ctx.save();
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineWidth = 3 * s;
  ctx.globalAlpha = 0.75;
  for (let i = 0; i < 9; i += 1) {
    const y = (h / 9) * (i + 0.5);
    const travel = ((scene.time * 1.1 + i * 137) % (w + 160 * s)) - 80 * s;
    const x = scene.windDir > 0 ? travel : w - travel;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - scene.windDir * (50 + (i % 3) * 26) * s, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHold(v: View, scene: Scene, progress: number): void {
  const { ctx, w, s } = v;
  const r = (scene.mini ? 34 : 42) * s;
  const x = w / 2;
  const y = r + 22 * s;
  ctx.save();
  ctx.fillStyle = COLORS.creme;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = mix(COLORS.creme, COLORS.choco, 0.2);
  ctx.lineWidth = 9 * s;
  ctx.stroke();
  ctx.strokeStyle = COLORS.framboise;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, progress));
  ctx.stroke();
  ctx.fillStyle = COLORS.choco;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(r * 0.95)}px ${FONT_DISPLAY}`;
  const seconds = Math.max(1, Math.ceil((1 - progress) * (RULES.HOLD_MS / 1000)));
  ctx.fillText(String(seconds), x, y + r * 0.06);
  if (!scene.mini) {
    ctx.font = `${Math.round(17 * s)}px ${FONT_DISPLAY}`;
    ctx.lineWidth = 5 * s;
    ctx.strokeStyle = COLORS.creme;
    ctx.strokeText('Tiens bon !', x, y + r + 20 * s);
    ctx.fillText('Tiens bon !', x, y + r + 20 * s);
  }
  ctx.restore();
}

function drawNext(v: View, type: number, color: string): void {
  const { ctx, w, s } = v;
  const box = 74 * s;
  const x = w - box - 10 * s;
  const y = 10 * s;
  roundRect(ctx, x, y, box, box + 4 * s, 12 * s);
  ctx.fillStyle = COLORS.creme;
  ctx.fill();
  ctx.strokeStyle = COLORS.choco;
  ctx.lineWidth = 2.2 * s;
  ctx.stroke();
  ctx.fillStyle = COLORS.choco;
  ctx.font = `600 ${Math.round(11 * s)}px ${FONT_TEXT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('Ensuite', x + box / 2, y + 6 * s);
  const size = 13 * s;
  ctx.save();
  ctx.translate(x + box / 2, y + box / 2 + 9 * s);
  ctx.fillStyle = color;
  ctx.strokeStyle = COLORS.choco;
  ctx.lineWidth = 1.6 * s;
  for (const [cx, cy] of localCells(type)) {
    ctx.fillRect((cx - 0.5) * size, (cy - 0.5) * size, size, size);
    ctx.strokeRect((cx - 0.5) * size, (cy - 0.5) * size, size, size);
  }
  ctx.restore();
}

function drawChips(v: View, scene: Scene): void {
  const { ctx, h, s } = v;
  const chips: Array<{ label: string; ratio: number | null; bad: boolean }> = [];
  if (scene.effects) {
    for (const name of Object.keys(scene.effects) as TimedEffect[]) {
      const left = scene.effects[name];
      if (left <= 0) continue;
      const bad = name === 'turbo' || name === 'invert' || name === 'fog' || name === 'wind';
      chips.push({ label: EFFECT_LABELS[name], ratio: left / Tower.duration(name), bad });
    }
  }
  if (scene.pending?.glue) chips.push({ label: 'Prochaine part : caramel', ratio: null, bad: false });
  if (scene.pending?.soap) chips.push({ label: 'Prochaine part : beurrée', ratio: null, bad: true });
  if (scene.pending?.giant) chips.push({ label: 'Prochaine part : énorme', ratio: null, bad: true });

  ctx.font = `700 ${Math.round(12 * s)}px ${FONT_TEXT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let y = h - 12 * s;
  for (const chip of chips) {
    const height = 24 * s;
    const width = ctx.measureText(chip.label).width + 20 * s;
    y -= height;
    const x = 10 * s;
    roundRect(ctx, x, y, width, height, height / 2);
    ctx.fillStyle = COLORS.creme;
    ctx.fill();
    if (chip.ratio !== null) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = mix(chip.bad ? COLORS.framboise : COLORS.pistache, COLORS.creme, 0.55);
      ctx.fillRect(x, y, width * chip.ratio, height);
      ctx.restore();
      roundRect(ctx, x, y, width, height, height / 2);
    }
    ctx.strokeStyle = COLORS.choco;
    ctx.lineWidth = 2 * s;
    ctx.stroke();
    ctx.fillStyle = COLORS.choco;
    ctx.fillText(chip.label, x + 10 * s, y + height / 2 + s * 0.5);
    y -= 6 * s;
  }
}

/** Dessine une tour (la mienne en grand, ou celle d'un adversaire en petit). */
export function drawTower(ctx: CanvasRenderingContext2D, w: number, h: number, scene: Scene): void {
  const s = viewScale(w, h, scene.mini);
  const v: View = {
    ctx,
    w,
    h,
    s,
    ox: w / 2 + scene.shakeX * s,
    oy: h - GROUND_MARGIN * s + scene.camera * s + scene.shakeY * s,
  };

  drawWall(v, scene);
  drawGuides(v, scene);
  drawFinish(v, scene);

  const active = scene.bodies.find((body) => body.flags & FLAG.ACTIVE);
  if (active && !scene.mini) drawDropGuide(v, active);
  drawStand(v, scene);
  for (const body of scene.bodies) {
    if (!(body.flags & FLAG.ACTIVE)) drawBrick(v, scene, body);
  }
  if (active) drawBrick(v, scene, active);
  drawCounter(v);
  drawParticles(v, scene);

  if (scene.fx & FX_BITS.wind && scene.windDir !== 0) drawWind(v, scene);
  if (scene.fx & FX_BITS.fog) {
    const left = scene.effects ? scene.effects.fog : 1000;
    drawFog(v, scene, Math.min(1, left / 400));
  }
  if (scene.hold !== null) drawHold(v, scene, scene.hold);
  if (!scene.mini) {
    if (scene.next !== null && !scene.frozen) drawNext(v, scene.next, scene.color);
    drawChips(v, scene);
  }
  if (scene.frozen) {
    ctx.fillStyle = COLORS.creme;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }
}
