/** 恐龙快打 - 公共类型定义 */

export type Facing = 1 | -1;

export type FighterState =
  | 'idle'
  | 'walk'
  | 'attack'
  | 'jump'
  | 'hurt'
  | 'down'
  | 'dead'
  | 'dash'
  | 'special';

/** 攻击类型，决定伤害倍率、判定时序与表现 */
export type AttackKind = 'punch' | 'jump' | 'dash' | 'weapon' | 'gun';

export type EnemyKind = 'thug' | 'punk' | 'knife' | 'brute' | 'raptor' | 'trex';

export type AiType = 'brawler' | 'slasher' | 'brute' | 'beast' | 'trex';

export type BuildType = 'slim' | 'normal' | 'heavy';

export interface CharColors {
  hair: string;
  skin: string;
  shirt: string;
  pants: string;
  boots: string;
  accent: string;
}

export interface Weapon {
  type: 'pipe' | 'bat' | 'gun';
  /** 枪械弹药，近战武器为 0 */
  ammo: number;
  /** 近战武器剩余挥击次数 */
  hits: number;
}

export interface Fighter {
  id: number;
  faction: 'player' | 'enemy';
  kind: string;
  name: string;

  /** 世界坐标：x 横向，y 纵深（越大越靠近镜头），z 离地高度 */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;

  facing: Facing;
  hp: number;
  maxHp: number;

  state: FighterState;
  stateTime: number;
  animTime: number;
  onGround: boolean;

  /** 连招段数 0/1/2 */
  comboStep: number;
  attackKind: AttackKind;
  /** 本次攻击是否已结算过伤害 */
  hitFired: boolean;
  /** 多段判定（跳跃踢）时已命中的目标 */
  hitSet: Set<number>;

  invuln: number;
  stun: number;
  flash: number;
  downTime: number;
  dead: boolean;
  removeAt: number;

  weapon: Weapon | null;
  /** AI 决策计时 */
  aiTimer: number;
  aiMode: 'approach' | 'retreat' | 'wait' | 'strike';
  /** AI 期望的纵深位置 */
  wantY: number;

  speed: number;
  power: number;
  scale: number;
  width: number;
  height: number;
  build: BuildType;
  colors: CharColors;
  /** 敌人站位偏好：站在玩家的左侧还是右侧 */
  side: -1 | 1;
  /** boss 咆哮（召唤）冷却 */
  roarCd: number;
  /** 是否缓存了下一段连招输入 */
  queued: boolean;
  /** boss 当前攻击是否为跺地（范围伤害） */
  stomp: boolean;

  /** 玩家专属：特殊技冷却 */
  specialCd: number;
  /** 冲刺剩余时间 */
  dashTime: number;
  /** 双击检测 */
  tapTime: number;
  tapDir: Facing;
}

export interface Projectile {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  damage: number;
  owner: 'player' | 'enemy';
  life: number;
}

export type PickupType = 'food' | 'pipe' | 'bat' | 'gun' | 'gem';

export interface Pickup {
  id: number;
  type: PickupType;
  x: number;
  y: number;
  z: number;
  vz: number;
  life: number;
  /** 落地后静止 */
  landed: boolean;
}

export interface Crate {
  id: number;
  x: number;
  y: number;
  hp: number;
  drop: PickupType | null;
  shake: number;
}

export interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface Floater {
  x: number;
  y: number;
  z: number;
  text: string;
  life: number;
  color: string;
  size: number;
}

export type GameStatus =
  | 'menu'
  | 'playing'
  | 'paused'
  | 'stageclear'
  | 'gameover'
  | 'victory';

export interface HudState {
  status: GameStatus;
  score: number;
  hiScore: number;
  lives: number;
  hp: number;
  maxHp: number;
  stage: number;
  stageName: string;
  wave: number;
  totalWaves: number;
  combo: number;
  weapon: Weapon | null;
  bossName: string | null;
  bossHp: number | null;
  bossMaxHp: number | null;
  enemiesLeft: number;
}

export interface GameEvent {
  type: 'stageclear' | 'gameover' | 'victory' | 'waveclear' | 'extralife';
  stage?: number;
  score?: number;
}
