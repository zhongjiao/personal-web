import { WALK_BOTTOM, WALK_TOP } from './config';
import type {
  AttackKind,
  BuildType,
  CharColors,
  Crate,
  Facing,
  Fighter,
  FighterState,
  Pickup,
  Weapon
} from './types';

const OUTLINE = '#14100c';

export interface Pose {
  x: number;
  y: number;
  facing: Facing;
  scale: number;
  build: BuildType;
  state: FighterState;
  stateTime: number;
  animTime: number;
  colors: CharColors;
  weapon: Weapon | null;
  attackKind: AttackKind;
  comboStep: number;
  flash: boolean;
  z: number;
  isBoss?: boolean;
}

function shade(hex: string, k: number) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(parseInt(m[1], 16) * k);
  const g = clamp(parseInt(m[2], 16) * k);
  const b = clamp(parseInt(m[3], 16) * k);
  return `rgb(${r},${g},${b})`;
}

function joint(x: number, y: number, len: number, angle: number) {
  return { x: x + Math.cos(angle) * len, y: y + Math.sin(angle) * len };
}

function limb(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  len: number,
  w: number,
  angle: number,
  color: string
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(1, w * 0.16);
  ctx.beginPath();
  ctx.roundRect(0, -w / 2, len, w, w * 0.35);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function torso(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  accent: string
) {
  ctx.fillStyle = color;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h, w, h, w * 0.3);
  ctx.fill();
  ctx.stroke();
  // 胸口 / 背心装饰
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(x - w / 2 + 2, y - h * 0.75, w - 4, h * 0.22);
  ctx.globalAlpha = 1;
}

export function drawShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  groundY: number,
  z: number,
  w: number
) {
  const k = Math.max(0.25, 1 - z / 220);
  ctx.save();
  ctx.globalAlpha = 0.32 * k;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(x, groundY + 2, w * 0.5 * k, w * 0.18 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 类人角色（玩家 / 人形敌人） */
export function drawHumanoid(ctx: CanvasRenderingContext2D, p: Pose) {
  const buildK = p.build === 'heavy' ? 1.16 : p.build === 'slim' ? 0.92 : 1;
  const s = p.scale * buildK;
  const col = (c: string) => (p.flash ? '#f8fafc' : c);

  const t = p.animTime;
  const st = p.stateTime;
  const walking = p.state === 'walk';
  const phase = walking ? t * 11 : 0;
  const breathe = Math.sin(t * 2.6) * 0.8 * s;

  // 姿态参数
  let thighA = Math.PI / 2;
  let shinA = Math.PI / 2;
  let thighB = Math.PI / 2;
  let shinB = Math.PI / 2;
  let frontArm = Math.PI / 2 + 0.15;
  let backArm = Math.PI / 2 - 0.15;
  let armBend = 0.45;
  let lean = 0;
  let crouch = 0;
  let bodyRot = 0;

  if (walking) {
    thighA = Math.PI / 2 + Math.sin(phase) * 0.55;
    shinA = thighA + Math.max(0, Math.sin(phase + 1.1)) * 0.6;
    thighB = Math.PI / 2 + Math.sin(phase + Math.PI) * 0.55;
    shinB = thighB + Math.max(0, Math.sin(phase + Math.PI + 1.1)) * 0.6;
    frontArm = Math.PI / 2 + Math.sin(phase + Math.PI) * 0.5;
    backArm = Math.PI / 2 + Math.sin(phase) * 0.5;
  }

  if (p.state === 'attack') {
    const dur = p.attackKind === 'dash' ? 0.36 : 0.34;
    const k = Math.min(1, st / dur);
    const ext = k < 0.32 ? k / 0.32 : 1 - (k - 0.32) / 0.68;
    const step = p.comboStep;
    if (p.attackKind === 'gun') {
      frontArm = -0.05;
      armBend = 0.05;
      lean = 0.05;
    } else if (p.attackKind === 'jump') {
      frontArm = 0.35;
      thighA = 0.16;
      shinA = 0.1;
      thighB = Math.PI / 2 + 0.5;
      shinB = thighB + 0.7;
    } else if (p.attackKind === 'dash') {
      frontArm = -0.1;
      backArm = Math.PI / 2 + 0.8;
      thighA = 0.5;
      shinA = 0.15;
      lean = 0.22;
    } else if (step === 1) {
      frontArm = Math.PI / 2 - 0.55 - ext * 1.2;
      lean = 0.12 * ext;
    } else if (step === 2) {
      frontArm = -0.1 - ext * 0.35;
      backArm = Math.PI / 2 + 0.9;
      lean = 0.28 * ext;
      thighA = Math.PI / 2 - 0.35 * ext;
    } else {
      frontArm = Math.PI / 2 - 0.35 - ext * 1.35;
      lean = 0.16 * ext;
    }
    armBend = Math.PI / 2 - frontArm > 1.2 ? 0.9 : 0.25;
  }

  if (p.state === 'jump') {
    thighA = Math.PI / 2 - 0.55;
    shinA = thighA + 0.9;
    thighB = Math.PI / 2 + 0.35;
    shinB = thighB + 0.5;
    frontArm = -0.7;
    backArm = -0.45;
  }

  if (p.state === 'dash') {
    lean = 0.3;
    thighA = Math.PI / 2 - 0.35;
    shinA = thighA + 0.55;
    thighB = Math.PI / 2 + 0.45;
    shinB = thighB + 0.35;
    frontArm = -0.2;
    backArm = Math.PI / 2 + 0.9;
  }

  if (p.state === 'hurt') {
    bodyRot = -0.28;
    frontArm = 0.9;
    backArm = 1.1;
    thighA = Math.PI / 2 - 0.2;
    thighB = Math.PI / 2 + 0.2;
  }

  if (p.state === 'special') {
    const k = Math.min(1, st / 0.7);
    bodyRot = k * Math.PI * 4;
    frontArm = -0.1;
    backArm = Math.PI + 0.1;
    thighA = 0.3;
    shinA = 0.2;
    thighB = 0.5;
    shinB = 0.4;
    crouch = -6 * s;
  }

  if (p.state === 'down') {
    bodyRot = -Math.PI / 2 * 0.92;
    crouch = 16 * s;
    frontArm = Math.PI / 2;
    backArm = Math.PI / 2 + 0.5;
    thighA = Math.PI / 2 + 0.2;
    shinA = thighA + 0.3;
  }

  const thighLen = 15 * s;
  const shinLen = 14 * s;
  const torsoH = 25 * s;
  const torsoW = (p.build === 'heavy' ? 20 : p.build === 'slim' ? 14 : 17) * s;
  const hipY = p.y - (thighLen + shinLen) + crouch;
  const shoulderY = hipY - torsoH - breathe;
  const headR = (p.build === 'heavy' ? 10 : 8.5) * s;

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(p.facing, 1);
  ctx.translate(-p.x, -p.y);
  ctx.translate(p.x, hipY);
  ctx.rotate(bodyRot + lean);
  ctx.translate(-p.x, -hipY);

  const legs = [
    { a: thighB, b: shinB, c: shade(col(p.colors.pants), 0.72), back: true },
    { a: thighA, b: shinA, c: col(p.colors.pants), back: false }
  ];

  for (const leg of legs) {
    const knee = joint(p.x, hipY, thighLen, leg.a);
    limb(ctx, p.x - 1.5 * s, hipY, thighLen, 7.5 * s, leg.a, leg.c);
    limb(ctx, knee.x - 1.5 * s, knee.y, shinLen, 6.5 * s, leg.b, leg.c);
    // 鞋
    ctx.fillStyle = leg.back ? shade(col(p.colors.boots), 0.75) : col(p.colors.boots);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.4;
    const foot = joint(knee.x - 1.5 * s, knee.y, shinLen, leg.b);
    ctx.beginPath();
    ctx.roundRect(foot.x - 2 * s, foot.y - 2.5 * s, 12 * s, 5 * s, 2 * s);
    ctx.fill();
    ctx.stroke();
  }

  // 后臂
  const backShoulder = { x: p.x - 2 * s, y: shoulderY + 2 * s };
  const upper = 12 * s;
  const fore = 12 * s;
  const elbowB = joint(backShoulder.x, backShoulder.y, upper, backArm);
  limb(ctx, backShoulder.x, backShoulder.y, upper, 6 * s, backArm, shade(col(p.colors.skin), 0.75));
  limb(
    ctx,
    elbowB.x,
    elbowB.y,
    fore,
    5.4 * s,
    backArm - (backArm > 1 ? 0.6 : -0.5),
    shade(col(p.colors.skin), 0.75)
  );

  // 躯干
  torso(ctx, p.x, hipY, torsoW, torsoH + breathe, col(p.colors.shirt), col(p.colors.accent));

  // 头
  const headY = shoulderY - headR * 0.9;
  ctx.fillStyle = col(p.colors.skin);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.roundRect(p.x - headR * 0.85, headY - headR * 1.7, headR * 1.9, headR * 1.9, headR * 0.6);
  ctx.fill();
  ctx.stroke();
  // 头发
  ctx.fillStyle = col(p.colors.hair);
  ctx.beginPath();
  ctx.roundRect(p.x - headR * 0.95, headY - headR * 1.85, headR * 2.05, headR * 0.85, headR * 0.4);
  ctx.fill();
  ctx.stroke();
  // 眼睛
  ctx.fillStyle = '#18181b';
  ctx.fillRect(p.x + headR * 0.28, headY - headR * 1.05, 2.4 * s, 2.4 * s);
  if (p.state === 'hurt' || p.state === 'down') {
    ctx.strokeStyle = '#18181b';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(p.x + headR * 0.2, headY - headR * 1.15);
    ctx.lineTo(p.x + headR * 0.95, headY - headR * 0.75);
    ctx.stroke();
  }

  // 前臂 + 武器
  const frontShoulder = { x: p.x + 1.5 * s, y: shoulderY + 1 * s };
  const elbowF = joint(frontShoulder.x, frontShoulder.y, upper, frontArm);
  const hand = joint(elbowF.x, elbowF.y, fore, frontArm - (frontArm > 1 ? armBend : -armBend * 0.4));
  limb(ctx, frontShoulder.x, frontShoulder.y, upper, 6.4 * s, frontArm, col(p.colors.skin));
  limb(
    ctx,
    elbowF.x,
    elbowF.y,
    fore,
    5.8 * s,
    frontArm - (frontArm > 1 ? armBend : -armBend * 0.4),
    col(p.colors.skin)
  );

  if (p.weapon) {
    ctx.save();
    ctx.translate(hand.x, hand.y);
    ctx.rotate(frontArm - (frontArm > 1 ? armBend : -armBend * 0.4));
    drawWeapon(ctx, p.weapon, s, p.flash);
    ctx.restore();
  }

  ctx.restore();
}

function drawWeapon(ctx: CanvasRenderingContext2D, w: Weapon, s: number, flash: boolean) {
  const c = (hex: string) => (flash ? '#f8fafc' : hex);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.4;
  if (w.type === 'pipe' || w.type === 'bat') {
    const len = (w.type === 'pipe' ? 34 : 30) * s;
    ctx.fillStyle = c(w.type === 'pipe' ? '#9ca3af' : '#b45309');
    ctx.beginPath();
    ctx.roundRect(0, -2.4 * s, len, 4.8 * s, 2 * s);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = c(w.type === 'pipe' ? '#6b7280' : '#7c2d12');
    ctx.fillRect(-3 * s, -3.2 * s, 5 * s, 6.4 * s);
  } else {
    ctx.fillStyle = c('#27272a');
    ctx.beginPath();
    ctx.roundRect(0, -3 * s, 16 * s, 6 * s, 1.5 * s);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = c('#3f3f46');
    ctx.beginPath();
    ctx.roundRect(-2 * s, 0.5 * s, 7 * s, 7 * s, 1.5 * s);
    ctx.fill();
    ctx.stroke();
  }
}

/** 恐龙（迅猛龙 / 暴君龙） */
export function drawDino(ctx: CanvasRenderingContext2D, p: Pose) {
  const s = p.scale;
  const col = (c: string) => (p.flash ? '#f8fafc' : c);
  const boss = p.isBoss ?? false;
  const t = p.animTime;
  const moving = p.state === 'walk' || p.state === 'dash';
  const phase = moving ? t * 9 : 0;
  const bob = moving ? Math.sin(phase * 2) * 2 * s : Math.sin(t * 2) * 1.2 * s;
  const bodyH = (boss ? 62 : 44) * s;
  const bodyL = (boss ? 76 : 60) * s;
  const hipY = p.y - (boss ? 74 : 52) * s + bob;

  let headA = -0.35;
  let jaw = 0;
  let lean = 0;
  let tailA = 0.25;

  if (p.state === 'attack') {
    const k = Math.min(1, p.stateTime / 0.36);
    const ext = k < 0.35 ? k / 0.35 : 1 - (k - 0.35) / 0.65;
    headA = -0.9 - ext * 0.5;
    jaw = ext * (boss ? 0.55 : 0.45);
    lean = 0.3 * ext;
    tailA = -0.1;
  }
  if (p.state === 'jump') {
    headA = -0.8;
    jaw = 0.35;
    tailA = 0.5;
  }
  if (p.state === 'hurt') {
    headA = 0.2;
    jaw = 0.1;
    lean = -0.25;
  }
  if (p.state === 'down') {
    headA = 0.7;
    jaw = 0.05;
  }

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(p.facing, 1);
  ctx.translate(-p.x, -p.y);

  const skin = col(p.colors.skin);
  const belly = col(p.colors.shirt);
  const dark = shade(p.colors.skin, 0.7);

  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  const legSwing = moving ? Math.sin(phase) * 0.5 : 0;

  // 尾巴
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(p.x - bodyL * 0.32, hipY - bodyH * 0.25);
  ctx.quadraticCurveTo(
    p.x - bodyL * 0.95,
    hipY - bodyH * (0.2 + tailA),
    p.x - bodyL * 1.5,
    hipY - bodyH * (0.55 + tailA)
  );
  ctx.quadraticCurveTo(
    p.x - bodyL * 0.95,
    hipY - bodyH * 0.02,
    p.x - bodyL * 0.28,
    hipY + bodyH * 0.12
  );
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 后腿
  const drawLeg = (back: boolean) => {
    const swing = back ? -legSwing : legSwing;
    const hipX = p.x - bodyL * (back ? 0.18 : 0.02);
    const hipYY = hipY + bodyH * 0.05;
    const knee = joint(hipX, hipYY, bodyH * 0.42, Math.PI / 2 + swing * 0.6 + 0.1);
    const foot = joint(knee.x, knee.y, bodyH * 0.42, Math.PI / 2 + swing * 0.3 + 0.25);
    limb(ctx, hipX, hipYY, bodyH * 0.42, (boss ? 14 : 10) * s, Math.PI / 2 + swing * 0.6 + 0.1, back ? shade(skin, 0.72) : skin);
    limb(ctx, knee.x, knee.y, bodyH * 0.42, (boss ? 9 : 7) * s, Math.PI / 2 + swing * 0.3 + 0.25, back ? shade(skin, 0.72) : skin);
    // 爪
    ctx.fillStyle = col(p.colors.accent);
    ctx.beginPath();
    ctx.roundRect(foot.x - 3 * s, foot.y - 2 * s, (boss ? 20 : 14) * s, 6 * s, 2 * s);
    ctx.fill();
    ctx.stroke();
  };
  drawLeg(true);
  drawLeg(false);

  // 躯干
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(p.x - bodyL * 0.12, hipY - bodyH * 0.22, bodyL * 0.5, bodyH * 0.42, -0.12 - lean, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = belly;
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.ellipse(p.x - bodyL * 0.08, hipY - bodyH * 0.05, bodyL * 0.36, bodyH * 0.2, -0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // 前肢
  ctx.fillStyle = shade(skin, 0.85);
  const armBase = { x: p.x + bodyL * 0.2, y: hipY - bodyH * 0.3 };
  limb(ctx, armBase.x, armBase.y, bodyH * 0.26, (boss ? 7 : 5) * s, 0.5 + (p.state === 'attack' ? -0.7 : 0), shade(skin, 0.85));

  // 颈 + 头
  const neck = joint(p.x + bodyL * 0.16, hipY - bodyH * 0.45, bodyH * 0.4, headA - 0.15 - lean);
  const headC = joint(neck.x, neck.y, bodyH * 0.5, headA - lean);
  const headR = (boss ? 26 : 16) * s;
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.roundRect(neck.x - headR * 0.34, neck.y - headR * 0.34, headR * 1.5, headR * 0.8, headR * 0.3);
  ctx.fill();
  ctx.stroke();

  ctx.save();
  ctx.translate(headC.x, headC.y);
  ctx.rotate(headA * 0.5);
  // 头
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.roundRect(-headR * 0.3, -headR * 0.72, headR * 1.5, headR * 0.95, headR * 0.32);
  ctx.fill();
  ctx.stroke();
  // 上颚 / 嘴
  ctx.fillStyle = shade(skin, 0.8);
  ctx.beginPath();
  ctx.moveTo(headR * 0.9, -headR * 0.55);
  ctx.lineTo(headR * 1.85, -headR * 0.1);
  ctx.lineTo(headR * 0.9, headR * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 下颚
  ctx.beginPath();
  ctx.moveTo(headR * 0.85, headR * 0.1 + jaw * headR * 0.35);
  ctx.lineTo(headR * 1.75, headR * 0.18 + jaw * headR * 0.6);
  ctx.lineTo(headR * 0.85, headR * 0.42 + jaw * headR * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 牙
  ctx.fillStyle = '#fffbeb';
  for (let i = 0; i < 4; i++) {
    const tx = headR * (1.0 + i * 0.2);
    ctx.beginPath();
    ctx.moveTo(tx, -headR * 0.05);
    ctx.lineTo(tx + headR * 0.08, -headR * 0.05);
    ctx.lineTo(tx + headR * 0.04, headR * 0.12 + jaw * headR * 0.2);
    ctx.closePath();
    ctx.fill();
  }
  // 眼
  ctx.fillStyle = col(p.colors.accent);
  ctx.beginPath();
  ctx.ellipse(headR * 0.35, -headR * 0.42, headR * 0.16, headR * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.ellipse(headR * 0.4, -headR * 0.42, headR * 0.07, headR * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

export function drawFighter(
  ctx: CanvasRenderingContext2D,
  f: Fighter,
  camX: number,
  isDino: boolean
) {
  const depth = 0.86 + ((f.y - WALK_TOP) / (WALK_BOTTOM - WALK_TOP)) * 0.14;
  const x = f.x - camX;
  const pose: Pose = {
    x,
    y: f.y - f.z,
    facing: f.facing,
    scale: f.scale * depth,
    build: f.build,
    state: f.state,
    stateTime: f.stateTime,
    animTime: f.animTime,
    colors: f.colors ?? ({} as CharColors),
    weapon: f.weapon,
    attackKind: f.attackKind,
    comboStep: f.comboStep,
    flash: f.flash > 0,
    z: f.z,
    isBoss: f.kind === 'trex'
  };
  drawShadow(ctx, x, f.y, f.z, (isDino ? 78 : 44) * f.scale * depth);
  if (isDino) drawDino(ctx, pose);
  else drawHumanoid(ctx, pose);
}

export function drawCrate(ctx: CanvasRenderingContext2D, c: Crate, camX: number, time: number) {
  const x = c.x - camX + (c.shake > 0 ? Math.sin(time * 60) * 3 * c.shake : 0);
  const w = 46;
  const h = 44;
  ctx.save();
  ctx.fillStyle = '#8a5a2b';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, c.y - h, w, h, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#a9702f';
  ctx.fillRect(x - w / 2 + 3, c.y - h + 3, w - 6, 6);
  ctx.strokeStyle = '#5c3a17';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x - w / 2 + 4, c.y - h + 8);
  ctx.lineTo(x + w / 2 - 4, c.y - 6);
  ctx.moveTo(x + w / 2 - 4, c.y - h + 8);
  ctx.lineTo(x - w / 2 + 4, c.y - 6);
  ctx.stroke();
  ctx.restore();
}

export function drawPickup(ctx: CanvasRenderingContext2D, p: Pickup, camX: number, time: number) {
  const x = p.x - camX;
  const y = p.y - p.z - 12 + Math.sin(time * 4 + p.id) * 2;
  ctx.save();
  drawShadow(ctx, x, p.y, p.z, 26);
  ctx.translate(x, y);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.6;
  switch (p.type) {
    case 'food': {
      ctx.fillStyle = '#f5deb3';
      ctx.beginPath();
      ctx.ellipse(0, 0, 11, 8, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e5e7eb';
      ctx.beginPath();
      ctx.roundRect(9, -2, 9, 4, 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'pipe': {
      ctx.rotate(-0.5);
      ctx.fillStyle = '#9ca3af';
      ctx.beginPath();
      ctx.roundRect(-16, -3, 32, 6, 3);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'bat': {
      ctx.rotate(-0.5);
      ctx.fillStyle = '#b45309';
      ctx.beginPath();
      ctx.roundRect(-6, -3, 24, 6, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#7c2d12';
      ctx.beginPath();
      ctx.roundRect(-14, -4.5, 9, 9, 3);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'gun': {
      ctx.fillStyle = '#27272a';
      ctx.beginPath();
      ctx.roundRect(-9, -4, 20, 8, 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#3f3f46';
      ctx.beginPath();
      ctx.roundRect(-6, 2, 7, 8, 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'gem': {
      ctx.fillStyle = '#22d3ee';
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(9, 0);
      ctx.lineTo(0, 10);
      ctx.lineTo(-9, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#a5f3fc';
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(4, 0);
      ctx.lineTo(0, 4);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}
