/** 基于 WebAudio 的轻量音效合成，无需外部音频资源 */

export type SfxName =
  | 'punch'
  | 'hit'
  | 'heavy'
  | 'jump'
  | 'land'
  | 'pickup'
  | 'weapon'
  | 'shoot'
  | 'break'
  | 'special'
  | 'roar'
  | 'down'
  | 'start'
  | 'over'
  | 'clear';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function setSfxEnabled(v: boolean) {
  enabled = v;
}

export function unlockAudio() {
  ac();
}

function noiseBuffer(audio: AudioContext, dur: number) {
  const len = Math.max(1, Math.floor(audio.sampleRate * dur));
  const buf = audio.createBuffer(1, len, audio.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  }
  return buf;
}

function tone(
  audio: AudioContext,
  freq: number,
  dur: number,
  type: OscillatorType,
  gain: number,
  slideTo?: number
) {
  const osc = audio.createOscillator();
  const g = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audio.currentTime);
  if (slideTo) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), audio.currentTime + dur);
  }
  g.gain.setValueAtTime(gain, audio.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0008, audio.currentTime + dur);
  osc.connect(g);
  g.connect(master!);
  osc.start();
  osc.stop(audio.currentTime + dur + 0.02);
}

function noise(audio: AudioContext, dur: number, gain: number, freq: number, q = 1) {
  const src = audio.createBufferSource();
  src.buffer = noiseBuffer(audio, dur);
  const filter = audio.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = audio.createGain();
  g.gain.setValueAtTime(gain, audio.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0008, audio.currentTime + dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(master!);
  src.start();
}

export function playSfx(name: SfxName) {
  if (!enabled) return;
  const audio = ac();
  if (!audio || !master) return;
  try {
    switch (name) {
      case 'punch':
        noise(audio, 0.09, 0.5, 900, 1.2);
        break;
      case 'hit':
        noise(audio, 0.14, 0.6, 420, 0.8);
        tone(audio, 180, 0.12, 'square', 0.16, 90);
        break;
      case 'heavy':
        noise(audio, 0.22, 0.75, 260, 0.7);
        tone(audio, 120, 0.2, 'sawtooth', 0.2, 60);
        break;
      case 'jump':
        tone(audio, 420, 0.16, 'square', 0.14, 760);
        break;
      case 'land':
        noise(audio, 0.08, 0.35, 200);
        break;
      case 'pickup':
        tone(audio, 660, 0.1, 'square', 0.16);
        tone(audio, 990, 0.12, 'square', 0.12);
        break;
      case 'weapon':
        tone(audio, 300, 0.14, 'triangle', 0.18, 520);
        noise(audio, 0.12, 0.4, 1400, 2);
        break;
      case 'shoot':
        noise(audio, 0.16, 0.6, 1800, 0.8);
        tone(audio, 220, 0.1, 'sawtooth', 0.2, 60);
        break;
      case 'break':
        noise(audio, 0.26, 0.6, 700, 0.6);
        tone(audio, 150, 0.18, 'square', 0.14, 70);
        break;
      case 'special':
        tone(audio, 200, 0.5, 'sawtooth', 0.22, 900);
        noise(audio, 0.45, 0.5, 600, 0.5);
        break;
      case 'roar':
        tone(audio, 110, 0.7, 'sawtooth', 0.28, 55);
        noise(audio, 0.7, 0.4, 180, 0.4);
        break;
      case 'down':
        tone(audio, 260, 0.5, 'triangle', 0.2, 70);
        break;
      case 'start':
        tone(audio, 523, 0.12, 'square', 0.18);
        tone(audio, 659, 0.12, 'square', 0.18);
        tone(audio, 784, 0.2, 'square', 0.18);
        break;
      case 'over':
        tone(audio, 392, 0.25, 'sawtooth', 0.2, 180);
        tone(audio, 262, 0.5, 'sawtooth', 0.2, 90);
        break;
      case 'clear':
        [523, 659, 784, 1047].forEach((f, i) => {
          setTimeout(() => tone(audio, f, 0.18, 'square', 0.18), i * 110);
        });
        break;
    }
  } catch {
    /* 音频失败不影响游戏 */
  }
}
