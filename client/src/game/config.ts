import type { AiType, BuildType, CharColors, EnemyKind } from './types';

/** 逻辑分辨率（渲染时等比缩放到容器） */
export const VIEW_W = 960;
export const VIEW_H = 540;

/** 可活动纵深范围（脚底 y 坐标） */
export const WALK_TOP = 300;
export const WALK_BOTTOM = 468;

export const GRAVITY = 2200;
export const PUSH_MARGIN = 360;
export const PLAYER_EDGE = 44;

/** 纵深命中容差 */
export const DEPTH_TOLERANCE = 26;

export interface CharDef {
  id: string;
  name: string;
  desc: string;
  hp: number;
  speed: number;
  power: number;
  build: BuildType;
  colors: CharColors;
}

export const CHARACTERS: CharDef[] = [
  {
    id: 'jack',
    name: '杰克 Jack',
    desc: '全能型 · 出拳快、连招稳',
    hp: 120,
    speed: 205,
    power: 1,
    build: 'normal',
    colors: {
      hair: '#3f2d1f',
      skin: '#e9b48c',
      shirt: '#2f6fd0',
      pants: '#2b3550',
      boots: '#4a3527',
      accent: '#dbe4f0'
    }
  },
  {
    id: 'hannah',
    name: '汉娜 Hannah',
    desc: '速度型 · 移动最快、连击高',
    hp: 100,
    speed: 240,
    power: 0.86,
    build: 'slim',
    colors: {
      hair: '#b45309',
      skin: '#f0c19b',
      shirt: '#c026d3',
      pants: '#3b2a4a',
      boots: '#5b3a2a',
      accent: '#fbcfe8'
    }
  },
  {
    id: 'mustapha',
    name: '穆斯塔法 Mustapha',
    desc: '技术型 · 攻击范围大',
    hp: 115,
    speed: 215,
    power: 0.95,
    build: 'normal',
    colors: {
      hair: '#1f2937',
      skin: '#a97142',
      shirt: '#16a34a',
      pants: '#334155',
      boots: '#3f2d1f',
      accent: '#bbf7d0'
    }
  },
  {
    id: 'mess',
    name: '麦斯 Mess',
    desc: '力量型 · 血厚、单发伤害高',
    hp: 155,
    speed: 178,
    power: 1.28,
    build: 'heavy',
    colors: {
      hair: '#6b7280',
      skin: '#c98d63',
      shirt: '#b91c1c',
      pants: '#404a5a',
      boots: '#2b2118',
      accent: '#fecaca'
    }
  }
];

export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  hp: number;
  speed: number;
  power: number;
  score: number;
  scale: number;
  build: BuildType;
  reach: number;
  ai: AiType;
  /** 攻击冷却区间（秒） */
  cooldown: [number, number];
  boss?: boolean;
  colors: CharColors;
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  thug: {
    kind: 'thug',
    name: '街头打手',
    hp: 46,
    speed: 118,
    power: 0.8,
    score: 100,
    scale: 1,
    build: 'normal',
    reach: 44,
    ai: 'brawler',
    cooldown: [0.9, 1.6],
    colors: {
      hair: '#221c16',
      skin: '#d29a6a',
      shirt: '#6b7280',
      pants: '#3f3f46',
      boots: '#27272a',
      accent: '#9ca3af'
    }
  },
  punk: {
    kind: 'punk',
    name: '暴走族',
    hp: 38,
    speed: 158,
    power: 0.7,
    score: 120,
    scale: 0.95,
    build: 'slim',
    reach: 40,
    ai: 'brawler',
    cooldown: [0.6, 1.1],
    colors: {
      hair: '#7c2d12',
      skin: '#e0ac83',
      shirt: '#7c3aed',
      pants: '#1e1b4b',
      boots: '#312e81',
      accent: '#ddd6fe'
    }
  },
  knife: {
    kind: 'knife',
    name: '持刀刺客',
    hp: 52,
    speed: 175,
    power: 0.95,
    score: 200,
    scale: 1,
    build: 'slim',
    reach: 52,
    ai: 'slasher',
    cooldown: [0.8, 1.4],
    colors: {
      hair: '#111827',
      skin: '#c98d63',
      shirt: '#0f766e',
      pants: '#134e4a',
      boots: '#111827',
      accent: '#5eead4'
    }
  },
  brute: {
    kind: 'brute',
    name: '重装巨汉',
    hp: 110,
    speed: 96,
    power: 1.35,
    score: 350,
    scale: 1.25,
    build: 'heavy',
    reach: 54,
    ai: 'brute',
    cooldown: [1.2, 2],
    colors: {
      hair: '#404040',
      skin: '#b47c50',
      shirt: '#57534e',
      pants: '#292524',
      boots: '#1c1917',
      accent: '#a8a29e'
    }
  },
  raptor: {
    kind: 'raptor',
    name: '迅猛龙',
    hp: 64,
    speed: 205,
    power: 1.05,
    score: 300,
    scale: 1,
    build: 'normal',
    reach: 56,
    ai: 'beast',
    cooldown: [0.7, 1.3],
    colors: {
      hair: '#166534',
      skin: '#3f6212',
      shirt: '#4d7c0f',
      pants: '#365314',
      boots: '#1a2e05',
      accent: '#a3e635'
    }
  },
  trex: {
    kind: 'trex',
    name: '暴君恐龙 T-REX',
    hp: 520,
    speed: 130,
    power: 1.6,
    score: 5000,
    scale: 1.9,
    build: 'heavy',
    reach: 78,
    ai: 'trex',
    cooldown: [1.1, 1.8],
    boss: true,
    colors: {
      hair: '#3f2d1f',
      skin: '#4d7c0f',
      shirt: '#3f6212',
      pants: '#365314',
      boots: '#1a2e05',
      accent: '#facc15'
    }
  }
};

/** 基础攻击伤害（乘以角色 power） */
export const BASE_DAMAGE = {
  punch: 9,
  finisher: 14,
  jump: 12,
  dash: 18,
  weapon: 20,
  bullet: 16,
  special: 26
};

export const WEAPON_LABEL: Record<string, string> = {
  pipe: '铁管',
  bat: '球棒',
  gun: '手枪'
};

export const HI_SCORE_KEY = 'dino-hiscore';
