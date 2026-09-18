import {
  BASE_DAMAGE,
  CHARACTERS,
  DEPTH_TOLERANCE,
  ENEMIES,
  GRAVITY,
  HI_SCORE_KEY,
  PLAYER_EDGE,
  VIEW_H,
  VIEW_W,
  WALK_BOTTOM,
  WALK_TOP,
  type CharDef
} from './config';
import { STAGES, type StageDef, type Wave } from './levels';
import { Input } from './input';
import { playSfx } from './sfx';
import type {
  AttackKind,
  Crate,
  EnemyKind,
  Facing,
  Fighter,
  Floater,
  GameEvent,
  GameStatus,
  HudState,
  Particle,
  Pickup,
  PickupType,
  Projectile
} from './types';

const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);

let nextId = 1;

export const isDino = (kind: string) => kind === 'raptor' || kind === 'trex';

export class Game {
  readonly input = new Input();

  status: GameStatus = 'menu';
  statusTime = 0;
  charId = 'jack';
  onEvent?: (e: GameEvent) => void;

  stageIndex = 0;
  waveIndex = 0;
  waveSpawned = false;
  gate = 0;
  cameraX = 0;
  time = 0;
  frame = 0;

  score = 0;
  hiScore = 0;
  lives = 3;
  combo = 0;
  comboTimer = 0;
  nextExtraScore = 40000;

  player!: Fighter;
  enemies: Fighter[] = [];
  projectiles: Projectile[] = [];
  pickups: Pickup[] = [];
  crates: Crate[] = [];
  particles: Particle[] = [];
  floaters: Floater[] = [];

  hitStop = 0;
  shake = 0;
  flashScreen = 0;
  banner: string | null = null;
  bannerTime = 0;
  private lastEnemyAttack = -1;

  constructor() {
    this.hiScore = Number(localStorage.getItem(HI_SCORE_KEY) ?? 0) || 0;
    this.player = this.createPlayer();
    this.stageIndex = 0;
    this.loadStage(0);
  }

  get stage(): StageDef {
    return STAGES[this.stageIndex];
  }

  // ---------- 生命周期 ----------

  startRun(charId: string) {
    this.charId = charId;
    this.score = 0;
    this.lives = 3;
    this.combo = 0;
    this.comboTimer = 0;
    this.nextExtraScore = 40000;
    this.stageIndex = 0;
    this.player = this.createPlayer();
    this.loadStage(0);
    this.status = 'playing';
    this.statusTime = 0;
    this.banner = STAGES[0].name;
    this.bannerTime = 2;
    playSfx('start');
  }

  private loadStage(index: number) {
    this.stageIndex = index;
    const stage = STAGES[index];
    this.waveIndex = 0;
    this.waveSpawned = false;
    this.gate = stage.waves[0].gate;
    this.cameraX = 0;
    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.particles = [];
    this.floaters = [];
    this.crates = stage.crates.map((c) => ({
      id: nextId++,
      x: c.x,
      y: c.y,
      hp: 1,
      drop: c.drop,
      shake: 0
    }));
    this.player.x = 140;
    this.player.y = 420;
    this.player.z = 0;
    this.player.vx = 0;
    this.player.vz = 0;
    this.player.hp = this.player.maxHp;
    this.player.state = 'idle';
    this.player.stateTime = 0;
    this.player.invuln = 1.2;
    this.player.weapon = null;
    this.player.dead = false;
  }

  private stageClear() {
    this.status = 'stageclear';
    this.statusTime = 0;
    playSfx('clear');
    this.onEvent?.({ type: 'stageclear', stage: this.stageIndex + 1, score: this.score });
  }

  nextStage() {
    if (this.stageIndex + 1 >= STAGES.length) {
      this.status = 'victory';
      this.statusTime = 0;
      this.saveHiScore();
      playSfx('clear');
      this.onEvent?.({ type: 'victory', score: this.score });
      return;
    }
    this.loadStage(this.stageIndex + 1);
    this.status = 'playing';
    this.statusTime = 0;
    this.banner = STAGES[this.stageIndex].name;
    this.bannerTime = 2;
    playSfx('start');
  }

  private gameOver() {
    this.status = 'gameover';
    this.statusTime = 0;
    this.saveHiScore();
    playSfx('over');
    this.onEvent?.({ type: 'gameover', score: this.score });
  }

  private saveHiScore() {
    if (this.score > this.hiScore) {
      this.hiScore = this.score;
      localStorage.setItem(HI_SCORE_KEY, String(this.hiScore));
    }
  }

  togglePause() {
    if (this.status === 'playing') this.status = 'paused';
    else if (this.status === 'paused') this.status = 'playing';
  }

  // ---------- 实体构造 ----------

  private createPlayer(): Fighter {
    const def: CharDef = CHARACTERS.find((c) => c.id === this.charId) ?? CHARACTERS[0];
    return this.makeFighter({
      faction: 'player',
      kind: 'player',
      name: def.name,
      def: {
        hp: def.hp,
        speed: def.speed,
        power: def.power,
        scale: 1,
        build: def.build,
        colors: def.colors
      },
      x: 140,
      y: 420
    });
  }

  private makeFighter(opts: {
    faction: 'player' | 'enemy';
    kind: string;
    name: string;
    def: {
      hp: number;
      speed: number;
      power: number;
      scale: number;
      build: Fighter['build'];
      colors: Fighter['colors'];
    };
    x: number;
    y: number;
  }): Fighter {
    return {
      id: nextId++,
      faction: opts.faction,
      kind: opts.kind,
      name: opts.name,
      x: opts.x,
      y: opts.y,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      facing: opts.faction === 'player' ? 1 : -1,
      hp: opts.def.hp,
      maxHp: opts.def.hp,
      state: 'idle',
      stateTime: 0,
      animTime: Math.random() * 6,
      onGround: true,
      comboStep: -1,
      attackKind: 'punch',
      hitFired: false,
      hitSet: new Set<number>(),
      invuln: 0,
      stun: 0,
      flash: 0,
      downTime: 0,
      dead: false,
      removeAt: 0,
      weapon: null,
      aiTimer: 0.6 + Math.random() * 0.8,
      aiMode: 'approach',
      wantY: opts.y,
      speed: opts.def.speed,
      power: opts.def.power,
      scale: opts.def.scale,
      width: 34 * opts.def.scale,
      height: 70 * opts.def.scale,
      build: opts.def.build,
      colors: opts.def.colors,
      specialCd: 0,
      dashTime: 0,
      tapTime: 0,
      tapDir: 1,
      side: Math.random() < 0.5 ? -1 : 1,
      roarCd: 6,
      queued: false,
      stomp: false
    };
  }

  private spawnEnemy(kind: EnemyKind, x: number, y: number) {
    const def = ENEMIES[kind];
    const e = this.makeFighter({
      faction: 'enemy',
      kind,
      name: def.name,
      def,
      x,
      y
    });
    // 相对玩家的纵深偏好，避免所有敌人挤在同一条线上
    e.wantY = (Math.random() * 2 - 1) * 20;
    e.invuln = 0.4;
    this.enemies.push(e);
  }

  private spawnWave(wave: Wave) {
    wave.spawns.forEach((s, i) => {
      const fromRight = i % 2 === 0;
      const x = fromRight
        ? this.cameraX + VIEW_W + 60 + Math.random() * 140
        : this.cameraX - 60 - Math.random() * 120;
      const y = s.y ?? WALK_TOP + 40 + Math.random() * (WALK_BOTTOM - WALK_TOP - 60);
      this.spawnEnemy(s.kind, x, clamp(y, WALK_TOP + 20, WALK_BOTTOM));
    });
    if (wave.spawns.some((s) => ENEMIES[s.kind].boss)) playSfx('roar');
  }

  // ---------- 主循环 ----------

  update(dt: number) {
    this.frame++;
    this.statusTime += dt;

    if (this.status === 'menu') {
      this.cameraX = (this.cameraX + 22 * dt) % STAGES[0].length;
      this.player.animTime += dt;
      if (this.input.justPressed('attack') || this.input.justPressed('jump')) {
        this.startRun(this.charId);
      }
      this.input.endFrame();
      return;
    }

    if (this.status === 'paused') {
      this.input.endFrame();
      return;
    }

    if (this.status === 'stageclear') {
      this.updateEffects(dt);
      if (this.statusTime > 0.6 && this.input.justPressed('attack')) this.nextStage();
      this.input.endFrame();
      return;
    }

    if (this.status === 'gameover' || this.status === 'victory') {
      this.updateEffects(dt);
      if (this.statusTime > 0.8 && (this.input.justPressed('attack') || this.input.justPressed('jump'))) {
        this.startRun(this.charId);
      }
      this.input.endFrame();
      return;
    }

    this.time += dt;

    let step = dt;
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      step = dt * 0.12;
    }

    this.updatePlayer(step);
    for (const e of this.enemies) this.updateEnemy(e, step);
    this.separate(step);
    this.updateProjectiles(step);
    this.updatePickups(step);
    this.updateWaves();
    this.updateCamera(dt);

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
    if (this.bannerTime > 0) {
      this.bannerTime -= dt;
      if (this.bannerTime <= 0) this.banner = null;
    }

    this.updateEffects(dt);
    this.input.endFrame();
  }

  private updateEffects(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vz -= GRAVITY * 0.55 * dt;
      if (p.z < 0) {
        p.z = 0;
        p.vz *= -0.35;
        p.vx *= 0.6;
      }
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= dt;
      f.z += 42 * dt;
      if (f.life <= 0) this.floaters.splice(i, 1);
    }
    for (const c of this.crates) {
      if (c.shake > 0) c.shake = Math.max(0, c.shake - dt * 3);
    }
    this.shake = Math.max(0, this.shake - dt * 26);
    this.flashScreen = Math.max(0, this.flashScreen - dt * 3.4);
  }

  private updateCamera(dt: number) {
    const maxCam = Math.min(this.gate ?? 0, this.stage.length - VIEW_W);
    const target = clamp(this.player.x - VIEW_W * 0.45, 0, Math.max(0, maxCam));
    this.cameraX += (target - this.cameraX) * Math.min(1, dt * 5);
    this.cameraX = clamp(this.cameraX, 0, Math.max(0, maxCam));
  }

  // ---------- 玩家 ----------

  private updatePlayer(dt: number) {
    const p = this.player;
    p.animTime += dt;
    p.stateTime += dt;
    p.specialCd = Math.max(0, p.specialCd - dt);
    p.flash = Math.max(0, p.flash - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    p.tapTime = Math.max(0, p.tapTime - dt);

    if (p.state === 'down') {
      this.physics(p, dt);
      if (p.z <= 0) {
        p.downTime -= dt;
        if (p.downTime <= 0) {
          if (p.hp > 0) {
            // 非致命击倒：爬起来继续战斗
            p.state = 'idle';
            p.stateTime = 0;
            p.invuln = Math.max(p.invuln, 0.6);
          } else if (this.lives > 0) {
            this.respawn();
          } else {
            this.gameOver();
          }
        }
      }
      return;
    }

    const canAct = p.state === 'idle' || p.state === 'walk';
    const inAir = p.z > 0;

    // 双击冲刺
    let mx = 0;
    let my = 0;
    if (this.input.isDown('left')) mx -= 1;
    if (this.input.isDown('right')) mx += 1;
    if (this.input.isDown('up')) my -= 1;
    if (this.input.isDown('down')) my += 1;
    if (mx !== 0 && canAct && !inAir) {
      if (this.input.justPressed(mx > 0 ? 'right' : 'left')) {
        if (p.tapTime > 0 && p.tapDir === mx) {
          p.state = 'dash';
          p.stateTime = 0;
          p.dashTime = 0.26;
          p.facing = mx > 0 ? 1 : -1;
          p.tapTime = 0;
          playSfx('jump');
        } else {
          p.tapTime = 0.3;
          p.tapDir = mx > 0 ? 1 : -1;
        }
      }
    }

    // 跳跃
    if (canAct && !inAir && this.input.justPressed('jump')) {
      p.vz = 640;
      p.z = 0.1;
      p.state = 'jump';
      p.stateTime = 0;
      p.onGround = false;
      playSfx('jump');
    }

    // 特殊技（耗费生命值的全向攻击）
    if (canAct && !inAir && this.input.justPressed('special') && p.specialCd <= 0) {
      p.state = 'special';
      p.stateTime = 0;
      p.attackKind = 'punch';
      p.hitFired = false;
      p.hitSet.clear();
      p.specialCd = 4;
      p.invuln = Math.max(p.invuln, 0.75);
      p.hp = Math.max(1, p.hp - Math.round(p.maxHp * 0.16));
      p.vz = 220;
      playSfx('special');
      this.flashScreen = 0.55;
      this.shake = 9;
    }

    // 攻击
    if (this.input.justPressed('attack')) {
      if (inAir && p.state !== 'attack') this.startAttack(p, 'jump');
      else if (p.state === 'dash') this.startAttack(p, 'dash');
      else if (canAct) this.startAttack(p, p.weapon?.type === 'gun' ? 'gun' : p.weapon ? 'weapon' : 'punch');
      else if (p.state === 'attack' && p.stateTime > 0.12 && p.comboStep < 2 && p.attackKind !== 'gun')
        p.queued = true;
    }

    // 状态推进
    if (p.state === 'attack') {
      // 出招时的小幅位移：冲撞大幅前冲，普通攻击轻微前压
      if (p.stateTime < 0.18) {
        p.x += p.facing * (p.attackKind === 'dash' ? p.speed * 2.0 : 40) * dt;
      }
      this.resolveAttack(p);
      const dur = this.attackDuration(p);
      if (p.stateTime >= dur) {
        if (p.queued && p.attackKind !== 'gun') {
          p.queued = false;
          this.startAttack(p, p.weapon?.type === 'gun' ? 'gun' : p.weapon ? 'weapon' : 'punch');
        } else {
          p.state = inAir ? 'jump' : 'idle';
          p.stateTime = 0;
          p.comboStep = -1;
        }
      }
    } else if (p.state === 'special') {
      this.resolveSpecial(p);
      if (p.stateTime >= 0.72) {
        p.state = 'idle';
        p.stateTime = 0;
      }
    } else if (p.state === 'dash') {
      p.dashTime -= dt;
      p.x += p.facing * p.speed * 2.1 * dt;
      if (Math.abs(mx) === 0 && Math.abs(my) === 0) p.dashTime = Math.min(p.dashTime, 0.08);
      if (p.dashTime <= 0) {
        p.state = 'idle';
        p.stateTime = 0;
      }
    } else if (p.state === 'hurt') {
      if (p.stateTime >= 0.32) {
        p.state = 'idle';
        p.stateTime = 0;
      }
    } else if (p.state === 'jump') {
      if (p.z <= 0 && p.onGround) {
        p.state = 'idle';
        p.stateTime = 0;
      }
    } else {
      // idle / walk
      if (canAct) {
        const len = Math.hypot(mx, my) || 1;
        const sp = p.speed * (inAir ? 0.82 : 1);
        if (mx !== 0 || my !== 0) {
          p.x += (mx / len) * sp * dt;
          p.y += (my / len) * sp * 0.68 * dt;
          p.state = 'walk';
        } else {
          p.state = 'idle';
        }
        if (mx !== 0) p.facing = mx > 0 ? 1 : -1;
      }
    }

    this.physics(p, dt);
  }

  private startAttack(f: Fighter, kind: AttackKind) {
    f.state = 'attack';
    f.stateTime = 0;
    f.attackKind = kind;
    f.hitFired = false;
    f.hitSet.clear();
    f.comboStep = f.comboStep >= 2 ? 0 : f.comboStep + 1;
    if (kind === 'dash' || kind === 'jump') f.comboStep = 0;
    if (kind === 'gun') f.comboStep = -1;
  }

  private attackDuration(f: Fighter) {
    switch (f.attackKind) {
      case 'weapon':
        return 0.36;
      case 'dash':
        return 0.4;
      case 'gun':
        return 0.26;
      case 'jump':
        return 0.5;
      default:
        return 0.32;
    }
  }

  private attackHitTime(f: Fighter) {
    switch (f.attackKind) {
      case 'weapon':
        return 0.14;
      case 'dash':
        return 0.1;
      case 'gun':
        return 0.05;
      case 'jump':
        return 0.02;
      default:
        return 0.12;
    }
  }

  // ---------- 战斗结算 ----------

  private resolveAttack(f: Fighter) {
    if (f.attackKind === 'jump') {
      // 空中连续判定，同一目标只命中一次
      const hit = this.doHitTest(f);
      if (hit.length) this.applyHits(f, hit);
      return;
    }
    if (f.hitFired || f.stateTime < this.attackHitTime(f)) return;
    f.hitFired = true;

    // boss 跺地：范围冲击
    if (f.stomp) {
      this.resolveEnemyArea(f);
      return;
    }

    if (f.attackKind === 'gun' && f.weapon) {
      f.weapon.ammo -= 1;
      this.projectiles.push({
        id: nextId++,
        x: f.x + f.facing * 24,
        y: f.y,
        z: 46,
        vx: f.facing * 980,
        damage: BASE_DAMAGE.bullet * f.power,
        owner: f.faction,
        life: 1.1
      });
      this.burst(f.x + f.facing * 30, f.y, 48, '#fde68a', 6, 1);
      playSfx('shoot');
      if (f.weapon.ammo <= 0) f.weapon = null;
      return;
    }

    const hit = this.doHitTest(f);
    if (hit.length) {
      this.applyHits(f, hit);
    } else {
      playSfx('punch');
      // 挥击也可能打碎箱子
      this.hitCrates(f);
    }
    if (f.weapon && f.weapon.type !== 'gun') {
      f.weapon.hits -= 1;
      if (f.weapon.hits <= 0) {
        this.burst(f.x + f.facing * 30, f.y, 40, '#9ca3af', 8, 1.2);
        f.weapon = null;
      }
    }
  }

  private resolveSpecial(p: Fighter) {
    if (p.hitFired || p.stateTime < 0.12) return;
    p.hitFired = true;
    let count = 0;
    for (const e of this.enemies) {
      if (Math.abs(e.x - p.x) < 150 && Math.abs(e.y - p.y) < 70) {
        this.damage(
          e,
          BASE_DAMAGE.special * p.power,
          (Math.sign(e.x - p.x) || p.facing) as Facing,
          true,
          p
        );
        count++;
      }
    }
    for (const c of this.crates) {
      if (Math.abs(c.x - p.x) < 120 && Math.abs(c.y - p.y) < 50) this.breakCrate(c);
    }
    if (count) {
      this.shake = 12;
      playSfx('heavy');
    }
  }

  /** 返回被本次攻击命中的目标（敌人或玩家） */
  private doHitTest(f: Fighter): Fighter[] {
    const kind = f.attackKind;
    let reach = 46;
    if (kind === 'weapon') reach = f.weapon?.type === 'bat' ? 78 : 72;
    if (kind === 'dash') reach = 64;
    if (kind === 'jump') reach = 56;
    if (f.kind === 'trex') reach += 40;
    if (f.kind === 'brute') reach += 8;

    const x1 = f.x + f.facing * 4;
    const x2 = f.x + f.facing * (4 + reach);
    const min = Math.min(x1, x2);
    const max = Math.max(x1, x2);
    const out: Fighter[] = [];

    const targets = f.faction === 'player' ? this.enemies : [this.player];
    for (const t of targets) {
      if (t.dead || t.state === 'down') continue;
      if (f.hitSet.has(t.id)) continue;
      if (Math.abs(t.y - f.y) > DEPTH_TOLERANCE) continue;
      if (Math.abs(t.z - f.z) > 56) continue;
      if (t.x < min - 16 || t.x > max + 16) continue;
      out.push(t);
      f.hitSet.add(t.id);
    }
    return out;
  }

  private applyHits(f: Fighter, targets: Fighter[]) {
    const kind = f.attackKind;
    const finisher = kind !== 'jump' && f.comboStep === 2;
    let base =
      kind === 'weapon'
        ? BASE_DAMAGE.weapon
        : kind === 'dash'
          ? BASE_DAMAGE.dash
          : kind === 'jump'
            ? BASE_DAMAGE.jump
            : finisher
              ? BASE_DAMAGE.finisher
              : BASE_DAMAGE.punch;
    if (f.kind === 'brute') base *= 1.15;
    if (f.kind === 'trex') base *= 1.4;

    for (const t of targets) {
      const dir = Math.sign(t.x - f.x) || f.facing;
      const knock = finisher || kind === 'dash';
      this.damage(t, base * f.power, dir as Facing, knock, f);
      if (f.faction === 'player') this.registerHit(t);
    }
    this.hitCrates(f);
    playSfx(kind === 'weapon' ? 'weapon' : finisher || kind === 'dash' ? 'heavy' : 'hit');
    this.hitStop = Math.max(this.hitStop, finisher ? 0.09 : 0.05);
    this.shake = Math.max(this.shake, finisher ? 7 : 3);
  }

  private registerHit(_t: Fighter) {
    this.combo += 1;
    this.comboTimer = 2.4;
  }

  damage(
    target: Fighter,
    amount: number,
    dir: Facing,
    knockdown: boolean,
    _source?: Fighter | null
  ) {
    if (target.invuln > 0 || target.dead) return;
    const dmg = Math.max(1, Math.round(amount));
    target.hp -= dmg;
    target.flash = 0.13;
    this.floaters.push({
      x: target.x,
      y: target.y,
      z: (isDino(target.kind) ? 70 : 78) * target.scale,
      text: String(dmg),
      life: 0.75,
      color: target.faction === 'player' ? '#fca5a5' : '#fef08a',
      size: 20
    });
    this.burst(
      target.x,
      target.y,
      (isDino(target.kind) ? 50 : 56) * target.scale,
      target.faction === 'player' ? '#fca5a5' : '#fde68a',
      7,
      1
    );

    if (target.hp <= 0) {
      this.knockDown(target, dir, true);
      return;
    }
    if (knockdown) {
      this.knockDown(target, dir, false);
    } else {
      target.state = 'hurt';
      target.stateTime = 0;
      target.vx = dir * 150;
    }
  }

  private knockDown(target: Fighter, dir: Facing, fatal: boolean) {
    target.state = 'down';
    target.stateTime = 0;
    target.downTime = fatal ? 1 : 0.85;
    target.vz = fatal ? 240 : 190;
    target.z = Math.max(target.z, 0.1);
    target.vx = dir * (fatal ? 300 : 230);
    target.hitSet.clear();
    playSfx('down');

    if (target.faction === 'enemy') {
      if (fatal) {
        const def = ENEMIES[target.kind as EnemyKind];
        const mult = 1 + Math.min(this.combo - 1, 12) * 0.1;
        this.addScore(Math.round(def.score * mult));
        this.floaters.push({
          x: target.x,
          y: target.y,
          z: 96,
          text: `+${Math.round(def.score * mult)}`,
          life: 1,
          color: '#86efac',
          size: 18
        });
        this.burst(target.x, target.y, 50, '#fca5a5', 14, 1.4);
        if (Math.random() < 0.22) this.dropPickup(target.x, target.y, 'food');
      }
    } else if (fatal) {
      this.lives -= 1;
      this.combo = 0;
      this.shake = 10;
      this.flashScreen = 0.4;
    }
  }

  addScore(n: number) {
    this.score += n;
    if (this.score >= this.nextExtraScore) {
      this.nextExtraScore += 40000;
      this.lives += 1;
      playSfx('pickup');
      this.onEvent?.({ type: 'extralife' });
    }
  }

  private respawn() {
    const p = this.player;
    p.hp = p.maxHp;
    p.state = 'idle';
    p.stateTime = 0;
    p.downTime = 0;
    p.z = 0;
    p.vz = 0;
    p.vx = 0;
    p.x = this.cameraX + 130;
    p.y = 420;
    p.invuln = 2;
    p.weapon = null;
    p.comboStep = -1;
    this.burst(p.x, p.y, 40, '#bae6fd', 12, 1.2);
  }

  // ---------- 敌人 AI ----------

  private updateEnemy(e: Fighter, dt: number) {
    e.animTime += dt;
    e.stateTime += dt;
    e.flash = Math.max(0, e.flash - dt);
    e.invuln = Math.max(0, e.invuln - dt);
    e.aiTimer -= dt;
    e.roarCd -= dt;

    if (e.state === 'down') {
      this.physics(e, dt);
      if (e.z <= 0) {
        e.downTime -= dt;
        if (e.downTime <= 0) {
          if (e.hp > 0) {
            // 爬起来继续战斗
            e.state = 'idle';
            e.stateTime = 0;
            e.invuln = 0.4;
            e.aiTimer = 0.6;
          } else {
            e.dead = true;
          }
        }
      }
      return;
    }
    if (e.state === 'hurt') {
      this.physics(e, dt);
      if (e.stateTime >= 0.34) {
        e.state = 'idle';
        e.stateTime = 0;
      }
      return;
    }
    if (e.state === 'attack') {
      this.physics(e, dt);
      this.resolveAttack(e);
      if (e.stateTime >= this.attackDuration(e)) {
        e.state = 'idle';
        e.stateTime = 0;
        e.aiTimer = this.rollCooldown(e);
        e.stomp = false;
      }
      return;
    }

    const def = ENEMIES[e.kind as EnemyKind];
    const p = this.player;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const playerDown = p.state === 'down';

    if (e.state === 'dash') {
      e.dashTime -= dt;
      e.x += e.facing * e.speed * 1.9 * dt;
      if (e.dashTime <= 0) {
        e.state = 'idle';
        e.stateTime = 0;
      }
      this.physics(e, dt);
      return;
    }

    // boss 咆哮召唤
    if (e.kind === 'trex' && e.roarCd <= 0 && this.enemies.length < 6 && !playerDown) {
      e.roarCd = 11;
      playSfx('roar');
      this.shake = 8;
      for (let i = 0; i < 2; i++) {
        this.spawnEnemy(
          'raptor',
          this.cameraX + (i === 0 ? -50 : VIEW_W + 60),
          clamp(p.y + (i === 0 ? -60 : 60), WALK_TOP + 20, WALK_BOTTOM)
        );
      }
      return;
    }

    if (playerDown) {
      e.state = 'idle';
      this.physics(e, dt);
      return;
    }

    // 站位：绕到玩家侧后方
    const sideX = p.x + e.side * def.reach * 0.7;
    const targetY = clamp(p.y + e.wantY, WALK_TOP + 16, WALK_BOTTOM);

    let mx = 0;
    let my = 0;
    if (Math.abs(e.y - targetY) > 8) my = Math.sign(targetY - e.y);
    if (adx > def.reach * 1.6) mx = Math.sign(dx);
    else if (Math.abs(e.x - sideX) > 26) mx = Math.sign(sideX - e.x);

    // 攻击判定
    const inRange = adx <= def.reach && ady <= 20;
    if (inRange && e.aiTimer <= 0 && this.time - this.lastEnemyAttack > 0.28) {
      this.lastEnemyAttack = this.time;
      e.facing = (Math.sign(dx) || e.facing) as Facing;
      e.stomp = e.kind === 'trex' && Math.random() < 0.35;
      this.startAttack(e, 'punch');
      return;
    }

    // 特殊 AI
    if (def.ai === 'slasher' && adx > 120 && adx < 320 && e.aiTimer <= 0.3 && Math.random() < dt * 1.6) {
      e.state = 'dash';
      e.dashTime = 0.3;
      e.facing = (Math.sign(dx) || 1) as Facing;
      e.aiTimer = this.rollCooldown(e);
      return;
    }
    if (def.ai === 'beast' && adx > 90 && adx < 300 && e.aiTimer <= 0 && Math.random() < dt * 2.2) {
      e.vz = 520;
      e.z = 0.1;
      e.state = 'jump';
      e.stateTime = 0;
      e.facing = (Math.sign(dx) || 1) as Facing;
      e.vx = e.facing * 220;
      e.aiTimer = this.rollCooldown(e);
      return;
    }
    if (def.ai === 'beast' && e.state === 'jump' && e.z > 0) {
      if (e.stateTime > 0.12 && !e.hitFired) this.startAttack(e, 'jump');
      this.physics(e, dt);
      return;
    }

    if (mx !== 0 || my !== 0) {
      const len = Math.hypot(mx, my) || 1;
      const sp = def.speed;
      e.x += (mx / len) * sp * dt;
      e.y += (my / len) * sp * 0.66 * dt;
      if (e.state !== 'jump') e.state = 'walk';
      if (adx > def.reach * 0.9 && mx !== 0) e.facing = (mx > 0 ? 1 : -1) as Facing;
    } else {
      if (e.state !== 'jump') e.state = 'idle';
      if (adx > 8) e.facing = (dx > 0 ? 1 : -1) as Facing;
    }

    this.physics(e, dt);
  }

  private rollCooldown(e: Fighter) {
    const [a, b] = ENEMIES[e.kind as EnemyKind].cooldown;
    return a + Math.random() * (b - a);
  }

  /** 敌人跺地 / 咬击的范围结算 */
  private resolveEnemyArea(e: Fighter) {
    const p = this.player;
    if (Math.abs(p.x - e.x) < 150 && Math.abs(p.y - e.y) < 60 && p.z < 30) {
      this.damage(p, BASE_DAMAGE.punch * e.power * 1.4, Math.sign(p.x - e.x) as Facing, true, e);
      this.shake = 14;
    }
  }

  private separate(dt: number) {
    const all = [this.player, ...this.enemies];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i];
        const b = all[j];
        if (a.state === 'down' || b.state === 'down') continue;
        if (Math.abs(a.z - b.z) > 40) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minDist = 22;
        if (Math.abs(dx) < minDist && Math.abs(dy) < 12) {
          const push = ((minDist - Math.abs(dx)) / minDist) * 60 * dt;
          const dir = dx === 0 ? 1 : Math.sign(dx);
          a.x -= dir * push;
          b.x += dir * push;
        }
      }
    }
  }

  // ---------- 物理 ----------

  private physics(f: Fighter, dt: number) {
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    const damp = Math.pow(0.0009, dt);
    f.vx *= damp;
    f.vy *= damp;

    if (f.z > 0 || f.vz > 0) {
      f.vz -= GRAVITY * dt;
      f.z += f.vz * dt;
      if (f.z <= 0) {
        f.z = 0;
        f.vz = 0;
        if (!f.onGround) {
          f.onGround = true;
          if (f.faction === 'player') playSfx('land');
          if (f.state === 'jump' && f.faction === 'player') {
            f.state = 'idle';
            f.stateTime = 0;
          }
        }
      } else {
        f.onGround = false;
      }
    } else {
      f.onGround = true;
    }

    f.y = clamp(f.y, WALK_TOP, WALK_BOTTOM);
    if (f.faction === 'player') {
      f.x = clamp(f.x, this.cameraX + PLAYER_EDGE, this.cameraX + VIEW_W - PLAYER_EDGE);
    } else {
      f.x = clamp(f.x, this.cameraX - 140, this.cameraX + VIEW_W + 220);
    }
  }

  // ---------- 子弹 / 道具 / 箱子 ----------

  private updateProjectiles(dt: number) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.life -= dt;
      pr.x += pr.vx * dt;
      let removed = pr.life <= 0;
      if (!removed) {
        const targets = pr.owner === 'player' ? this.enemies : [this.player];
        for (const t of targets) {
          if (t.dead || t.state === 'down') continue;
          if (Math.abs(t.y - pr.y) > 22) continue;
          if (Math.abs(t.x - pr.x) > 22) continue;
          if (pr.z > (isDino(t.kind) ? 90 : 80)) continue;
          this.damage(t, pr.damage, Math.sign(pr.vx) as Facing, false, null);
          if (pr.owner === 'player') this.registerHit(t);
          this.burst(pr.x, pr.y, pr.z, '#fef3c7', 8, 1);
          removed = true;
          break;
        }
      }
      if (removed) this.projectiles.splice(i, 1);
    }
  }

  private updatePickups(dt: number) {
    const p = this.player;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const it = this.pickups[i];
      it.life -= dt;
      if (!it.landed) {
        it.vz -= GRAVITY * dt;
        it.z += it.vz * dt;
        if (it.z <= 0) {
          it.z = 0;
          it.landed = true;
        }
      }
      if (p.state !== 'down' && Math.abs(p.x - it.x) < 34 && Math.abs(p.y - it.y) < 26 && it.z < 46) {
        this.collect(it.type);
        this.pickups.splice(i, 1);
        continue;
      }
      if (it.life <= 0) this.pickups.splice(i, 1);
    }
  }

  private collect(type: PickupType) {
    const p = this.player;
    playSfx('pickup');
    switch (type) {
      case 'food':
        p.hp = Math.min(p.maxHp, p.hp + 38);
        this.floaters.push({ x: p.x, y: p.y, z: 92, text: 'HP +38', life: 1, color: '#86efac', size: 16 });
        break;
      case 'pipe':
        p.weapon = { type: 'pipe', ammo: 0, hits: 12 };
        break;
      case 'bat':
        p.weapon = { type: 'bat', ammo: 0, hits: 14 };
        break;
      case 'gun':
        p.weapon = { type: 'gun', ammo: 8, hits: 0 };
        break;
      case 'gem':
        this.addScore(800);
        this.floaters.push({ x: p.x, y: p.y, z: 92, text: '+800', life: 1, color: '#67e8f9', size: 16 });
        break;
    }
  }

  private hitCrates(f: Fighter) {
    const reach = f.attackKind === 'weapon' ? 76 : 52;
    for (const c of this.crates) {
      if (c.hp <= 0) continue;
      if (Math.abs(c.y - f.y) > 30) continue;
      const dx = c.x - f.x;
      if (Math.sign(dx) !== f.facing && Math.abs(dx) > 12) continue;
      if (Math.abs(dx) > reach) continue;
      this.breakCrate(c);
    }
  }

  private breakCrate(c: Crate) {
    c.hp = 0;
    playSfx('break');
    this.burst(c.x, c.y - 20, 10, '#a9702f', 14, 1.3);
    this.shake = Math.max(this.shake, 4);
    if (c.drop) this.dropPickup(c.x, c.y, c.drop);
  }

  private dropPickup(x: number, y: number, type: PickupType) {
    this.pickups.push({
      id: nextId++,
      type,
      x,
      y: clamp(y, WALK_TOP + 10, WALK_BOTTOM),
      z: 30,
      vz: 240,
      life: 16,
      landed: false
    });
  }

  private burst(x: number, y: number, z: number, color: string, count: number, power: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (60 + Math.random() * 190) * power;
      this.particles.push({
        x,
        y,
        z,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.35,
        vz: 90 + Math.random() * 200,
        life: 0.35 + Math.random() * 0.3,
        maxLife: 0.65,
        color,
        size: 2 + Math.random() * 3
      });
    }
  }

  // ---------- 波次 ----------

  private updateWaves() {
    const stage = this.stage;
    const wave = stage.waves[this.waveIndex];
    if (!wave) return;

    // 清理已死亡敌人
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].dead) this.enemies.splice(i, 1);
    }
    for (let i = this.crates.length - 1; i >= 0; i--) {
      if (this.crates[i].hp <= 0) this.crates.splice(i, 1);
    }

    if (!this.waveSpawned) {
      const trigger = wave.gate - VIEW_W * 0.55;
      if (this.cameraX >= trigger || this.waveIndex === 0) {
        this.gate = wave.gate;
        this.spawnWave(wave);
        this.waveSpawned = true;
      }
      return;
    }

    if (this.enemies.length === 0) {
      this.waveIndex += 1;
      this.waveSpawned = false;
      if (this.waveIndex >= stage.waves.length) {
        this.stageClear();
        return;
      }
      this.gate = stage.waves[this.waveIndex].gate;
      this.banner = 'GO! →';
      this.bannerTime = 1.3;
      this.addScore(500);
      this.onEvent?.({ type: 'waveclear' });
      playSfx('clear');
    }
  }

  // ---------- HUD ----------

  getHud(): HudState {
    const boss = this.enemies.find((e) => ENEMIES[e.kind as EnemyKind]?.boss);
    return {
      status: this.status,
      score: this.score,
      hiScore: Math.max(this.hiScore, this.score),
      lives: this.lives,
      hp: Math.max(0, this.player.hp),
      maxHp: this.player.maxHp,
      stage: this.stageIndex + 1,
      stageName: this.stage.name,
      wave: Math.min(this.waveIndex + 1, this.stage.waves.length),
      totalWaves: this.stage.waves.length,
      combo: this.combo,
      weapon: this.player.weapon,
      bossName: boss ? boss.name : null,
      bossHp: boss ? Math.max(0, boss.hp) : null,
      bossMaxHp: boss ? boss.maxHp : null,
      enemiesLeft: this.enemies.length
    };
  }

  /** 渲染层需要的杂项 */
  get viewSize() {
    return { w: VIEW_W, h: VIEW_H };
  }

  get shakeOffset() {
    if (this.shake <= 0) return { x: 0, y: 0 };
    return {
      x: (Math.random() - 0.5) * this.shake,
      y: (Math.random() - 0.5) * this.shake * 0.6
    };
  }

}
