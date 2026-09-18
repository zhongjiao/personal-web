import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Gamepad2,
  Pause,
  Play,
  RotateCcw,
  Swords,
  Volume2,
  VolumeX
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CHARACTERS, VIEW_H, VIEW_W, WEAPON_LABEL } from '@/game/config';
import { Game } from '@/game/engine';
import { render } from '@/game/renderer';
import { setSfxEnabled, unlockAudio } from '@/game/sfx';
import type { Action } from '@/game/input';
import type { HudState } from '@/game/types';
import { cn } from '@/lib/utils';

const STEP = 1 / 60;

const hudKey = (h: HudState) =>
  [
    h.status,
    h.score,
    h.hiScore,
    h.lives,
    Math.ceil(h.hp),
    h.stage,
    h.wave,
    h.combo,
    h.weapon ? `${h.weapon.type}:${h.weapon.ammo}:${h.weapon.hits}` : '-',
    h.bossHp === null ? '-' : Math.ceil(h.bossHp)
  ].join('|');

const KEYS: { label: string; desc: string }[] = [
  { label: '← → ↑ ↓ / WASD', desc: '八方向移动' },
  { label: 'J / Z / 空格', desc: '攻击（连打触发三连击）' },
  { label: 'K / X', desc: '跳跃（空中攻击 = 飞踢）' },
  { label: '双击 ← / →', desc: '冲刺（冲刺中攻击 = 冲撞）' },
  { label: 'L / C / Shift', desc: '必杀技（消耗体力，全向击退）' },
  { label: 'P / Esc', desc: '暂停 / 继续' }
];

export default function DinoPage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const hudKeyRef = useRef('');

  const [hud, setHud] = useState<HudState | null>(null);
  const [charId, setCharId] = useState(CHARACTERS[0].id);
  const [soundOn, setSoundOn] = useState(true);
  const [touchMode, setTouchMode] = useState(false);

  const pushHud = useCallback((g: Game) => {
    const next = g.getHud();
    const key = hudKey(next);
    if (key !== hudKeyRef.current) {
      hudKeyRef.current = key;
      setHud(next);
    }
  }, []);

  // 游戏主循环
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const game = new Game();
    gameRef.current = game;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const scale = Math.min(rect.width / VIEW_W, rect.height / VIEW_H);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(VIEW_W * scale * dpr);
      canvas.height = Math.round(VIEW_H * scale * dpr);
      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    game.input.bind(window, () => {
      game.togglePause();
      pushHud(game);
    });

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.06, (now - last) / 1000);
      last = now;
      acc += dt;
      let guard = 0;
      while (acc >= STEP && guard < 5) {
        game.update(STEP);
        acc -= STEP;
        guard++;
      }
      if (acc > STEP * 5) acc = 0;
      render(ctx, game);
      pushHud(game);
    };
    raf = requestAnimationFrame(loop);
    setTouchMode(window.matchMedia('(pointer: coarse)').matches);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      game.input.unbind(window);
    };
  }, [pushHud]);

  // 回车 / 空格推进流程
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const g = gameRef.current;
      if (!g) return;
      if (e.code !== 'Enter' && e.code !== 'Space') return;
      if (document.activeElement instanceof HTMLButtonElement) return;
      if (g.status === 'menu' || g.status === 'gameover' || g.status === 'victory') {
        e.preventDefault();
        g.startRun(charId);
        unlockAudio();
        pushHud(g);
      } else if (g.status === 'stageclear') {
        e.preventDefault();
        g.nextStage();
        pushHud(g);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [charId, pushHud]);

  const startGame = (id: string) => {
    const g = gameRef.current;
    if (!g) return;
    unlockAudio();
    g.startRun(id);
    pushHud(g);
  };

  const togglePause = () => {
    const g = gameRef.current;
    if (!g) return;
    g.togglePause();
    pushHud(g);
  };

  const toggleSound = () => {
    setSoundOn((v) => {
      setSfxEnabled(!v);
      return !v;
    });
  };

  const status = hud?.status ?? 'menu';

  const virtualBtn = (action: Action, label: string, className?: string) => (
    <button
      key={action}
      type="button"
      className={cn(
        'select-none touch-none rounded-xl bg-white/15 text-white font-bold active:bg-white/35 ring-1 ring-white/25 backdrop-blur',
        className
      )}
      onPointerDown={(e) => {
        e.preventDefault();
        gameRef.current?.input.setVirtual(action, true);
      }}
      onPointerUp={() => gameRef.current?.input.setVirtual(action, false)}
      onPointerLeave={() => gameRef.current?.input.setVirtual(action, false)}
      onPointerCancel={() => gameRef.current?.input.setVirtual(action, false)}
    >
      {label}
    </button>
  );

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-[1180px] mx-auto px-4 py-5 flex flex-col gap-4">
        {/* 标题栏 */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 text-white flex items-center justify-center shadow">
              <Gamepad2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold leading-tight">恐龙快打</h2>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                经典横版清关街机 · Canvas 手绘 · 三关 + BOSS
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">最高分 {hud?.hiScore ?? 0}</Badge>
            <Button variant="outline" size="sm" onClick={toggleSound}>
              {soundOn ? <Volume2 /> : <VolumeX />}
              {soundOn ? '音效开' : '音效关'}
            </Button>
            <Button variant="outline" size="sm" onClick={togglePause} disabled={status === 'menu'}>
              {status === 'paused' ? <Play /> : <Pause />}
              {status === 'paused' ? '继续' : '暂停'}
            </Button>
            <Button size="sm" onClick={() => startGame(charId)}>
              <RotateCcw />
              重新开始
            </Button>
          </div>
        </div>

        {/* 游戏画面 */}
        <div
          ref={wrapRef}
          className="relative w-full aspect-video rounded-xl overflow-hidden border border-zinc-800 bg-zinc-950 shadow-xl"
        >
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full block"
            onPointerDown={unlockAudio}
          />

          {/* HUD */}
          {hud && status !== 'menu' && (
            <div className="absolute inset-0 pointer-events-none p-3 flex flex-col justify-between">
              <div className="flex items-start justify-between gap-3 text-white">
                <div className="space-y-1">
                  <div className="text-[11px] tracking-widest text-white/60">SCORE</div>
                  <div className="font-mono text-2xl font-bold leading-none drop-shadow">
                    {hud.score.toLocaleString()}
                  </div>
                  <div className="text-[11px] text-amber-300/90 font-mono">
                    HI {hud.hiScore.toLocaleString()}
                  </div>
                </div>

                <div className="text-center">
                  <div className="text-[11px] tracking-widest text-white/60">STAGE</div>
                  <div className="font-mono text-lg font-bold leading-none drop-shadow">
                    {hud.stage} / 3
                  </div>
                  <div className="text-[11px] text-white/70">
                    WAVE {hud.wave}/{hud.totalWaves}
                  </div>
                </div>

                <div className="text-right space-y-1">
                  <div className="text-[11px] tracking-widest text-white/60">LIVES</div>
                  <div className="font-mono text-xl font-bold leading-none drop-shadow">
                    × {Math.max(0, hud.lives)}
                  </div>
                  {hud.combo >= 2 && (
                    <div className="mt-1 inline-block rounded bg-rose-600/90 px-2 py-0.5 text-xs font-bold animate-[pulse_0.6s_ease-in-out_infinite]">
                      {hud.combo} COMBO
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                {hud.bossHp !== null && hud.bossMaxHp !== null && (
                  <div className="mx-auto w-2/3">
                    <div className="flex justify-between text-[11px] text-white/80 mb-1">
                      <span className="font-bold tracking-wide">{hud.bossName}</span>
                      <span className="font-mono">
                        {Math.ceil(hud.bossHp)} / {hud.bossMaxHp}
                      </span>
                    </div>
                    <div className="h-2.5 rounded-full bg-black/60 overflow-hidden ring-1 ring-white/20">
                      <div
                        className="h-full bg-gradient-to-r from-red-600 to-orange-400 transition-[width] duration-150"
                        style={{ width: `${(hud.bossHp / hud.bossMaxHp) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="flex items-end justify-between gap-4">
                  <div className="w-56">
                    <div className="flex items-center justify-between text-[11px] text-white/70 mb-1">
                      <span>{hud.stageName}</span>
                      {hud.weapon && (
                        <span className="text-amber-300">
                          {WEAPON_LABEL[hud.weapon.type]}
                          {hud.weapon.type === 'gun'
                            ? ` ${hud.weapon.ammo}发`
                            : ` ${hud.weapon.hits}次`}
                        </span>
                      )}
                    </div>
                    <div className="h-3.5 rounded-full bg-black/60 overflow-hidden ring-1 ring-white/20">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-lime-400 transition-[width] duration-150"
                        style={{ width: `${(hud.hp / hud.maxHp) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-[11px] text-white/50">
                    剩余敌人 {hud.enemiesLeft}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 菜单 */}
          {status === 'menu' && (
            <div className="absolute inset-0 bg-black/85 backdrop-blur-sm overflow-y-auto">
              <div className="min-h-full flex flex-col items-center justify-center gap-5 p-6 text-white">
                <div className="text-center">
                  <div className="text-[11px] tracking-[0.4em] text-amber-400">CADILLACS &amp; DINOSAURS</div>
                  <h1 className="text-4xl font-black tracking-tight mt-1 text-amber-300 drop-shadow">
                    恐 龙 快 打
                  </h1>
                  <p className="text-sm text-white/70 mt-2">
                    选择角色，打倒街头恶徒与史前巨兽，救出被囚禁的恐龙
                  </p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full max-w-3xl">
                  {CHARACTERS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setCharId(c.id);
                        const g = gameRef.current;
                        if (g) g.charId = c.id;
                      }}
                      className={cn(
                        'rounded-xl border p-3 text-left transition-all',
                        charId === c.id
                          ? 'border-amber-400 bg-amber-400/15 shadow-lg shadow-amber-500/20'
                          : 'border-white/15 bg-white/5 hover:bg-white/10'
                      )}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className="h-6 w-6 rounded-full ring-2 ring-black/40"
                          style={{ background: c.colors.shirt }}
                        />
                        <span className="text-sm font-bold">{c.name.split(' ')[0]}</span>
                      </div>
                      <p className="text-[11px] text-white/60 leading-snug min-h-[32px]">{c.desc}</p>
                      <div className="mt-2 space-y-1 text-[10px] text-white/70">
                        <StatBar label="体力" value={c.hp / 160} />
                        <StatBar label="速度" value={c.speed / 250} />
                        <StatBar label="力量" value={c.power / 1.3} />
                      </div>
                    </button>
                  ))}
                </div>

                <Button size="lg" className="px-10" onClick={() => startGame(charId)}>
                  <Swords />
                  开始游戏（Enter）
                </Button>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-[11px] text-white/70 max-w-2xl w-full">
                  {KEYS.map((k) => (
                    <div key={k.label} className="flex items-center justify-between gap-3 py-0.5">
                      <span className="font-mono text-amber-200/90">{k.label}</span>
                      <span>{k.desc}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-white/40">
                  打碎木箱可获得食物（回血）、铁管 / 球棒（近战）与手枪（8 发）
                </p>
              </div>
            </div>
          )}

          {/* 暂停 / 结算覆盖层 */}
          {status !== 'menu' && status !== 'playing' && (
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center text-white">
              <div className="text-center space-y-4 p-8">
                <div className="text-3xl font-black tracking-wide">
                  {status === 'paused' && '暂 停'}
                  {status === 'stageclear' && `${hud?.stageName ?? ''} 完成！`}
                  {status === 'gameover' && 'GAME OVER'}
                  {status === 'victory' && '通 关 成 功！'}
                </div>
                {(status === 'gameover' || status === 'victory') && (
                  <div className="space-y-1">
                    <div className="font-mono text-2xl text-amber-300">
                      {(hud?.score ?? 0).toLocaleString()}
                    </div>
                    <div className="text-xs text-white/60">最高分 {(hud?.hiScore ?? 0).toLocaleString()}</div>
                  </div>
                )}
                <div className="flex items-center justify-center gap-3 pt-2">
                  {status === 'paused' && (
                    <Button onClick={togglePause}>
                      <Play />
                      继续
                    </Button>
                  )}
                  {status === 'stageclear' && (
                    <Button
                      onClick={() => {
                        const g = gameRef.current;
                        if (!g) return;
                        g.nextStage();
                        pushHud(g);
                      }}
                    >
                      <Play />
                      进入下一关
                    </Button>
                  )}
                  {(status === 'gameover' || status === 'victory') && (
                    <Button onClick={() => startGame(charId)}>
                      <RotateCcw />
                      再来一局
                    </Button>
                  )}
                </div>
                <div className="text-[11px] text-white/50">
                  {status === 'stageclear' ? '按 Enter / J 继续' : '按 Enter 重新开始'}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 触屏控制 */}
        {touchMode && (
          <div className="grid grid-cols-2 gap-4 text-white">
            <div className="grid grid-cols-3 gap-2 w-40">
              <div />
              {virtualBtn('up', '↑')}
              <div />
              {virtualBtn('left', '←')}
              {virtualBtn('down', '↓')}
              {virtualBtn('right', '→')}
            </div>
            <div className="flex items-end justify-end gap-2">
              {virtualBtn('special', '必杀', 'h-12 px-3 text-xs')}
              {virtualBtn('jump', '跳', 'h-14 w-14')}
              {virtualBtn('attack', '攻击', 'h-16 w-16')}
            </div>
          </div>
        )}

        {/* 说明 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <InfoCard title="战斗要点">
            连续按攻击键触发三连击，第三段为终结技可将敌人击飞；击飞与冲撞伤害最高。被围攻时先用必杀技解围。
          </InfoCard>
          <InfoCard title="道具">
            木箱里藏着鸡腿（回血 38）、铁管、球棒与手枪。近战武器有挥击次数，手枪 8 发，用完自动丢弃。
          </InfoCard>
          <InfoCard title="敌人">
            打手与暴走族靠人数压制，持刀刺客会突进，巨汉血厚，迅猛龙会扑咬，BOSS 暴君恐龙会跺地与召唤援军。
          </InfoCard>
        </div>
      </div>
    </div>
  );
}

function StatBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-6 shrink-0">{label}</span>
      <span className="flex-1 h-1.5 rounded bg-white/15 overflow-hidden">
        <span
          className="block h-full bg-amber-400"
          style={{ width: `${Math.min(100, value * 100)}%` }}
        />
      </span>
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div className="text-sm font-semibold mb-1">{title}</div>
      <p className="text-xs text-[var(--color-muted-foreground)] leading-relaxed">{children}</p>
    </div>
  );
}
