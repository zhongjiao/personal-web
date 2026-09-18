import { VIEW_H, VIEW_W, WALK_TOP } from './config';
import { STAGES } from './levels';
import { isDino, type Game } from './engine';
import { drawCrate, drawFighter, drawPickup } from './art';

const HORIZON = WALK_TOP - 46;

function rnd(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function render(ctx: CanvasRenderingContext2D, game: Game) {
  const stage = STAGES[game.stageIndex];
  const pal = stage.palette;
  const camX = game.cameraX;
  const t = game.time;

  ctx.clearRect(0, 0, VIEW_W, VIEW_H);

  const shake = game.shakeOffset;
  ctx.save();
  ctx.translate(shake.x, shake.y);

  // ===== 天空 =====
  const sky = ctx.createLinearGradient(0, 0, 0, HORIZON + 40);
  sky.addColorStop(0, pal.skyTop);
  sky.addColorStop(1, pal.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(-20, -20, VIEW_W + 40, HORIZON + 60);

  // 远处装饰（月亮 / 太阳）
  ctx.fillStyle = pal.haze;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(VIEW_W * 0.78, 76, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  drawFarLayer(ctx, camX, pal.far, pal.farAlt, game.stageIndex);
  drawMidLayer(ctx, camX, pal.mid, game.stageIndex);
  drawGround(ctx, camX, pal, game.stageIndex);

  // ===== 实体（按纵深排序） =====
  type Item = { y: number; draw: () => void };
  const items: Item[] = [];

  for (const c of game.crates) items.push({ y: c.y, draw: () => drawCrate(ctx, c, camX, t) });
  for (const p of game.pickups) items.push({ y: p.y, draw: () => drawPickup(ctx, p, camX, t) });
  for (const f of game.enemies) {
    items.push({ y: f.y, draw: () => drawFighter(ctx, f, camX, isDino(f.kind)) });
  }
  items.push({
    y: game.player.y,
    draw: () => {
      // 无敌闪烁
      if (game.player.invuln > 0 && Math.floor(t * 20) % 2 === 0) return;
      drawFighter(ctx, game.player, camX, false);
    }
  });

  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.draw();

  // ===== 子弹 =====
  for (const pr of game.projectiles) {
    const x = pr.x - camX;
    ctx.save();
    ctx.strokeStyle = '#fde68a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x - 16, pr.y - pr.z);
    ctx.lineTo(x + 10, pr.y - pr.z);
    ctx.stroke();
    ctx.fillStyle = '#fff7ed';
    ctx.beginPath();
    ctx.arc(x + 10, pr.y - pr.z, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ===== 粒子 =====
  for (const p of game.particles) {
    const a = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - camX - p.size / 2, p.y - p.z - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  // ===== 飘字 =====
  ctx.textAlign = 'center';
  for (const f of game.floaters) {
    const a = Math.min(1, f.life * 1.6);
    ctx.globalAlpha = a;
    ctx.font = `700 ${f.size}px "Segoe UI", system-ui, sans-serif`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(f.text, f.x - camX, f.y - f.z);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x - camX, f.y - f.z);
  }
  ctx.globalAlpha = 1;

  // ===== 横幅 =====
  if (game.banner && game.bannerTime > 0) {
    const a = Math.min(1, game.bannerTime * 2);
    ctx.globalAlpha = a;
    ctx.font = '800 40px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(game.banner, VIEW_W / 2, 150);
    ctx.fillStyle = '#fde68a';
    ctx.fillText(game.banner, VIEW_W / 2, 150);
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  // ===== 屏幕特效 =====
  if (game.flashScreen > 0) {
    ctx.globalAlpha = Math.min(0.6, game.flashScreen);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.globalAlpha = 1;
  }

  // 扫描线
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = '#000';
  for (let y = 0; y < VIEW_H; y += 3) ctx.fillRect(0, y, VIEW_W, 1);
  ctx.globalAlpha = 1;

  // 暗角
  const vig = ctx.createRadialGradient(
    VIEW_W / 2,
    VIEW_H / 2,
    VIEW_H * 0.35,
    VIEW_W / 2,
    VIEW_H / 2,
    VIEW_H * 0.85
  );
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

function drawFarLayer(
  ctx: CanvasRenderingContext2D,
  camX: number,
  color: string,
  alt: string,
  stageIndex: number
) {
  const spacing = 118;
  const off = (camX * 0.22) % spacing;
  for (let i = -1; i < Math.ceil(VIEW_W / spacing) + 2; i++) {
    const idx = Math.floor((camX * 0.22) / spacing) + i;
    const x = i * spacing - off;
    const seed = idx * 7.3;
    if (stageIndex === 0) {
      // 废墟高楼
      const h = 90 + rnd(seed) * 150;
      const w = spacing * 0.72;
      ctx.fillStyle = rnd(seed + 1) > 0.5 ? color : alt;
      ctx.fillRect(x, HORIZON - h, w, h);
      ctx.fillStyle = 'rgba(255,214,140,0.10)';
      for (let wy = HORIZON - h + 12; wy < HORIZON - 10; wy += 18) {
        for (let wx = x + 8; wx < x + w - 10; wx += 16) {
          if (rnd(wx * 0.7 + wy * 1.3) > 0.55) ctx.fillRect(wx, wy, 6, 8);
        }
      }
    } else if (stageIndex === 1) {
      // 远山
      const h = 110 + rnd(seed) * 90;
      ctx.fillStyle = rnd(seed + 1) > 0.5 ? color : alt;
      ctx.beginPath();
      ctx.moveTo(x - 70, HORIZON);
      ctx.lineTo(x + 20, HORIZON - h);
      ctx.lineTo(x + 110, HORIZON);
      ctx.closePath();
      ctx.fill();
    } else {
      // 洞窟岩壁
      const h = 100 + rnd(seed) * 120;
      ctx.fillStyle = rnd(seed + 1) > 0.5 ? color : alt;
      ctx.beginPath();
      ctx.moveTo(x, HORIZON);
      ctx.lineTo(x + 16, HORIZON - h);
      ctx.lineTo(x + 40, HORIZON - h * 0.72);
      ctx.lineTo(x + 66, HORIZON - h * 1.02);
      ctx.lineTo(x + 96, HORIZON);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawMidLayer(
  ctx: CanvasRenderingContext2D,
  camX: number,
  color: string,
  stageIndex: number
) {
  const spacing = 190;
  const off = (camX * 0.52) % spacing;
  for (let i = -1; i < Math.ceil(VIEW_W / spacing) + 2; i++) {
    const idx = Math.floor((camX * 0.52) / spacing) + i;
    const x = i * spacing - off;
    const seed = idx * 3.1;
    ctx.fillStyle = color;
    if (stageIndex === 0) {
      // 电线杆 + 废墟矮墙
      const h = 84 + rnd(seed) * 26;
      ctx.fillRect(x + 20, HORIZON - h, 9, h);
      ctx.fillRect(x + 2, HORIZON - h + 8, 46, 7);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x + 60, HORIZON - 44, 74, 44);
    } else if (stageIndex === 1) {
      // 丛林大树
      ctx.fillStyle = '#3f2d1f';
      ctx.fillRect(x + 34, HORIZON - 70, 12, 70);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(x + 40, HORIZON - 92, 52, 34, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.beginPath();
      ctx.ellipse(x + 16, HORIZON - 74, 30, 20, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // 恐龙骨架 / 岩柱
      ctx.fillStyle = '#e7e5e4';
      ctx.beginPath();
      ctx.ellipse(x + 40, HORIZON - 30, 34, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x + 12, HORIZON);
      ctx.lineTo(x + 40, HORIZON - 104);
      ctx.lineTo(x + 68, HORIZON);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawGround(
  ctx: CanvasRenderingContext2D,
  camX: number,
  pal: (typeof STAGES)[number]['palette'],
  stageIndex: number
) {
  const g = ctx.createLinearGradient(0, HORIZON, 0, VIEW_H);
  g.addColorStop(0, pal.groundTop);
  g.addColorStop(1, pal.groundBottom);
  ctx.fillStyle = g;
  ctx.fillRect(-20, HORIZON, VIEW_W + 40, VIEW_H - HORIZON + 20);

  // 地平线高光
  ctx.fillStyle = pal.groundLine;
  ctx.fillRect(-20, HORIZON, VIEW_W + 40, 3);

  // 地面纹理（随镜头滚动）
  const off = camX % 120;
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#000';
  for (let i = -1; i < 12; i++) {
    const x = i * 120 - off;
    ctx.fillRect(x, HORIZON + 14 + (i % 3) * 52, 96, 4);
  }
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = pal.groundLine;
  for (let i = -1; i < 8; i++) {
    const x = i * 160 - ((camX * 1.0) % 160);
    ctx.beginPath();
    ctx.ellipse(x + 40, HORIZON + 60 + (i % 4) * 60, 60, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (stageIndex === 2) {
    // 岩浆裂缝
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#f97316';
    for (let i = -1; i < 6; i++) {
      const x = i * 220 - ((camX * 1.0) % 220);
      ctx.beginPath();
      ctx.ellipse(x + 60, HORIZON + 90 + (i % 3) * 70, 54, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
