import type { EnemyKind, PickupType } from './types';

export interface Palette {
  skyTop: string;
  skyBottom: string;
  far: string;
  farAlt: string;
  mid: string;
  groundTop: string;
  groundBottom: string;
  groundLine: string;
  haze: string;
}

export interface WaveSpawn {
  kind: EnemyKind;
  y?: number;
}

export interface Wave {
  /** 本波战斗时镜头允许推进到的最右位置 */
  gate: number;
  spawns: WaveSpawn[];
}

export interface StageDef {
  name: string;
  subtitle: string;
  length: number;
  palette: Palette;
  waves: Wave[];
  crates: { x: number; y: number; drop: PickupType }[];
  boss: EnemyKind | null;
}

export const STAGES: StageDef[] = [
  {
    name: '第一关 · 废墟都市',
    subtitle: 'THE CITY',
    length: 3400,
    palette: {
      skyTop: '#1b2456',
      skyBottom: '#8a4a63',
      far: '#20233f',
      farAlt: '#2b2f52',
      mid: '#3a3550',
      groundTop: '#4b4a5a',
      groundBottom: '#2e2d38',
      groundLine: '#6b6a7d',
      haze: 'rgba(255,150,120,0.10)'
    },
    waves: [
      {
        gate: 700,
        spawns: [
          { kind: 'thug', y: 380 },
          { kind: 'thug', y: 440 },
          { kind: 'punk', y: 330 }
        ]
      },
      {
        gate: 1500,
        spawns: [
          { kind: 'thug', y: 340 },
          { kind: 'punk', y: 460 },
          { kind: 'knife', y: 400 },
          { kind: 'thug', y: 430 }
        ]
      },
      {
        gate: 2300,
        spawns: [
          { kind: 'knife', y: 350 },
          { kind: 'knife', y: 450 },
          { kind: 'brute', y: 400 },
          { kind: 'punk', y: 320 }
        ]
      }
    ],
    crates: [
      { x: 420, y: 430, drop: 'food' },
      { x: 980, y: 360, drop: 'pipe' },
      { x: 1620, y: 445, drop: 'gem' },
      { x: 2180, y: 350, drop: 'bat' },
      { x: 2560, y: 420, drop: 'food' }
    ],
    boss: null
  },
  {
    name: '第二关 · 丛林沼泽',
    subtitle: 'THE JUNGLE',
    length: 3600,
    palette: {
      skyTop: '#0b3d4f',
      skyBottom: '#4f7f5b',
      far: '#123c3a',
      farAlt: '#1c5247',
      mid: '#2f5b3a',
      groundTop: '#4a6b32',
      groundBottom: '#2d4420',
      groundLine: '#6f9048',
      haze: 'rgba(180,255,200,0.08)'
    },
    waves: [
      {
        gate: 760,
        spawns: [
          { kind: 'punk', y: 340 },
          { kind: 'raptor', y: 420 },
          { kind: 'thug', y: 460 }
        ]
      },
      {
        gate: 1600,
        spawns: [
          { kind: 'raptor', y: 350 },
          { kind: 'raptor', y: 450 },
          { kind: 'knife', y: 400 },
          { kind: 'brute', y: 430 }
        ]
      },
      {
        gate: 2440,
        spawns: [
          { kind: 'thug', y: 330 },
          { kind: 'thug', y: 460 },
          { kind: 'raptor', y: 390 },
          { kind: 'raptor', y: 440 },
          { kind: 'brute', y: 360 }
        ]
      }
    ],
    crates: [
      { x: 500, y: 400, drop: 'bat' },
      { x: 1180, y: 450, drop: 'food' },
      { x: 1780, y: 340, drop: 'gun' },
      { x: 2380, y: 430, drop: 'gem' },
      { x: 2880, y: 380, drop: 'food' }
    ],
    boss: null
  },
  {
    name: '第三关 · 恐龙巢穴',
    subtitle: 'THE NEST',
    length: 3200,
    palette: {
      skyTop: '#2a0f1a',
      skyBottom: '#7a2b1e',
      far: '#2b1116',
      farAlt: '#43191d',
      mid: '#5a2620',
      groundTop: '#5b3b2c',
      groundBottom: '#33221a',
      groundLine: '#7c5340',
      haze: 'rgba(255,90,60,0.10)'
    },
    waves: [
      {
        gate: 720,
        spawns: [
          { kind: 'raptor', y: 360 },
          { kind: 'raptor', y: 450 },
          { kind: 'brute', y: 410 },
          { kind: 'knife', y: 330 }
        ]
      },
      {
        gate: 1560,
        spawns: [
          { kind: 'brute', y: 350 },
          { kind: 'brute', y: 460 },
          { kind: 'raptor', y: 400 },
          { kind: 'knife', y: 320 },
          { kind: 'punk', y: 440 }
        ]
      },
      {
        gate: 2360,
        spawns: [{ kind: 'trex', y: 410 }]
      }
    ],
    crates: [
      { x: 460, y: 430, drop: 'pipe' },
      { x: 1240, y: 360, drop: 'food' },
      { x: 1900, y: 440, drop: 'gun' },
      { x: 2260, y: 350, drop: 'food' }
    ],
    boss: 'trex'
  }
];
