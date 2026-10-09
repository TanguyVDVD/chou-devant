import type { CardId } from '../../../shared/rules';

// Tous les sons sont fabriqués à la volée avec la Web Audio API : pas de fichier.

export type SoundName =
  | 'move'
  | 'rotate'
  | 'blocked'
  | 'land'
  | 'lost'
  | 'gain'
  | 'tick'
  | 'go'
  | 'holdTick'
  | 'out'
  | 'bell'
  | 'win'
  | 'lose'
  | 'click';

interface Tone {
  freq: number;
  to?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  at?: number;
}

interface Hiss {
  dur: number;
  gain?: number;
  at?: number;
  from: number;
  to?: number;
  q?: number;
}

const MUTE_KEY = 'chou.muet';

let context: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let muted = readMuted();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function ensure(): { ctx: AudioContext; out: GainNode } | null {
  if (muted) return null;
  if (!context) {
    const Ctor = window.AudioContext;
    if (!Ctor) return null;
    context = new Ctor();
    master = context.createGain();
    master.gain.value = 0.5;
    master.connect(context.destination);
  }
  if (context.state === 'suspended') void context.resume();
  return master ? { ctx: context, out: master } : null;
}

function tone({ freq, to, dur, type = 'sine', gain = 0.25, at = 0 }: Tone): void {
  const audio = ensure();
  if (!audio) return;
  const { ctx, out } = audio;
  const start = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, start + dur);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(amp).connect(out);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

function hiss({ dur, gain = 0.2, at = 0, from, to, q = 1 }: Hiss): void {
  const audio = ensure();
  if (!audio) return;
  const { ctx, out } = audio;
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  const start = ctx.currentTime + at;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from, start);
  if (to) filter.frequency.exponentialRampToValueAtTime(to, start + dur);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.02);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  source.connect(filter).connect(amp).connect(out);
  source.start(start);
  source.stop(start + dur + 0.02);
}

function melody(notes: number[], step: number, options: Partial<Tone> = {}): void {
  notes.forEach((freq, i) => tone({ freq, dur: step * 1.6, at: i * step, type: 'triangle', ...options }));
}

/** La cloche du passe : deux partiels qui résonnent. */
function bell(at = 0): void {
  tone({ freq: 1568, dur: 1.4, gain: 0.3, at });
  tone({ freq: 3136, dur: 0.9, gain: 0.12, at });
  tone({ freq: 2349, dur: 1.1, gain: 0.08, at });
}

const SOUNDS: Record<SoundName, () => void> = {
  move: () => tone({ freq: 420, to: 520, dur: 0.05, type: 'triangle', gain: 0.12 }),
  rotate: () => tone({ freq: 520, to: 880, dur: 0.08, type: 'triangle', gain: 0.14 }),
  blocked: () => tone({ freq: 160, dur: 0.07, type: 'square', gain: 0.07 }),
  land: () => {
    tone({ freq: 170, to: 70, dur: 0.16, gain: 0.4 });
    hiss({ dur: 0.09, from: 900, to: 300, gain: 0.16 });
  },
  lost: () => {
    tone({ freq: 620, to: 90, dur: 0.45, type: 'sawtooth', gain: 0.16 });
    hiss({ dur: 0.3, from: 2200, to: 200, gain: 0.3, at: 0.38 });
    tone({ freq: 90, to: 50, dur: 0.25, gain: 0.35, at: 0.38 });
  },
  gain: () => melody([784, 988, 1319], 0.07, { gain: 0.18 }),
  tick: () => tone({ freq: 660, dur: 0.12, type: 'triangle', gain: 0.22 }),
  go: () => melody([784, 1175], 0.09, { gain: 0.25 }),
  holdTick: () => tone({ freq: 1047, dur: 0.1, type: 'triangle', gain: 0.2 }),
  out: () => melody([392, 311, 233], 0.16, { type: 'sawtooth', gain: 0.12 }),
  bell: () => bell(),
  win: () => {
    bell();
    melody([523, 659, 784, 1047, 1319], 0.11, { gain: 0.2, at: 0.25 });
    bell(0.9);
  },
  lose: () => melody([440, 392, 330], 0.2, { gain: 0.14 }),
  click: () => tone({ freq: 700, dur: 0.04, type: 'triangle', gain: 0.1 }),
};

// Chaque carte a sa petite signature sonore.
const CARD_SOUNDS: Record<CardId, () => void> = {
  caramel: () => tone({ freq: 220, to: 660, dur: 0.5, type: 'sawtooth', gain: 0.1 }),
  froid: () => melody([1175, 988, 1319], 0.07, { gain: 0.16 }),
  fourchette: () => {
    tone({ freq: 2400, dur: 0.08, gain: 0.12 });
    hiss({ dur: 0.12, from: 1500, gain: 0.25, at: 0.08 });
    hiss({ dur: 0.12, from: 1100, gain: 0.25, at: 0.24 });
  },
  neige: () => {
    hiss({ dur: 0.7, from: 3000, to: 6000, gain: 0.12, q: 3 });
    melody([1319, 1568, 2093], 0.12, { type: 'sine', gain: 0.1 });
  },
  chef: () => tone({ freq: 130, to: 55, dur: 0.6, type: 'square', gain: 0.18 }),
  beurre: () => tone({ freq: 900, to: 180, dur: 0.4, type: 'sine', gain: 0.25 }),
  farine: () => hiss({ dur: 0.7, from: 400, to: 2600, gain: 0.35, q: 0.6 }),
  rhum: () => {
    tone({ freq: 500, to: 300, dur: 0.22, type: 'triangle', gain: 0.2 });
    tone({ freq: 300, to: 560, dur: 0.22, type: 'triangle', gain: 0.2, at: 0.22 });
    tone({ freq: 560, to: 240, dur: 0.3, type: 'triangle', gain: 0.2, at: 0.44 });
  },
  air: () => hiss({ dur: 1.1, from: 300, to: 1800, gain: 0.4, q: 2 }),
  feu: () => melody([988, 988, 988, 1319], 0.06, { type: 'square', gain: 0.1 }),
};

export function play(name: SoundName): void {
  SOUNDS[name]();
}

export function playCard(card: CardId): void {
  CARD_SOUNDS[card]();
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    // Stockage indisponible (navigation privée) : le réglage vaut pour cette visite.
  }
  if (master) master.gain.value = value ? 0 : 0.5;
}
