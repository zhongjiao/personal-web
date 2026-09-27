import {
  EFFECT_LABELS,
  EFFECT_ORDER,
  setEffectEnabled,
  setEffectPresence,
  type DropShadowEffect,
  type GlowEffect,
  type LayerEffects,
  type StrokeEffect
} from '../lib/effects';
import { CheckRow, ColorRow, Row, SliderRow } from './form-controls';

/**
 * 图层效果编辑表单。
 * 勾选框决定效果**存在与否**，挂上后的「启用」只临时停用、参数保留。
 */

interface Patch {
  (fn: (effects: LayerEffects) => void): void;
}

/** 从 effects 上取出某一种效果，供参数控件读写 */
type Pick<T> = (effects: LayerEffects) => T | null;

const percent = (v: number) => `${Math.round(v * 100)}%`;

function ShadowParams({
  effect,
  patch,
  pick
}: {
  effect: DropShadowEffect;
  patch: Patch;
  pick: Pick<DropShadowEffect>;
}) {
  const set = (fn: (target: DropShadowEffect) => void) =>
    patch((e) => {
      const target = pick(e);
      if (target) fn(target);
    });

  return (
    <>
      <SliderRow
        label="方向"
        min={0}
        max={360}
        value={Math.round(effect.angle)}
        display={`${Math.round(effect.angle)}°`}
        onChange={(v) => set((t) => void (t.angle = v))}
      />
      <SliderRow
        label="距离"
        min={0}
        max={150}
        value={Math.round(effect.distance)}
        display={String(Math.round(effect.distance))}
        onChange={(v) => set((t) => void (t.distance = v))}
      />
      <SliderRow
        label="模糊"
        min={0}
        max={100}
        value={Math.round(effect.blur)}
        display={String(Math.round(effect.blur))}
        onChange={(v) => set((t) => void (t.blur = v))}
      />
      <ColorRow label="颜色" value={effect.color} onChange={(c) => set((t) => void (t.color = c))} />
      <SliderRow
        label="不透明度"
        min={0}
        max={100}
        value={Math.round(effect.opacity * 100)}
        display={percent(effect.opacity)}
        onChange={(v) => set((t) => void (t.opacity = v / 100))}
      />
    </>
  );
}

function StrokeParams({
  effect,
  patch,
  pick
}: {
  effect: StrokeEffect;
  patch: Patch;
  pick: Pick<StrokeEffect>;
}) {
  const set = (fn: (target: StrokeEffect) => void) =>
    patch((e) => {
      const target = pick(e);
      if (target) fn(target);
    });

  return (
    <>
      <SliderRow
        label="大小"
        min={0}
        max={100}
        value={Math.round(effect.size)}
        display={String(Math.round(effect.size))}
        onChange={(v) => set((t) => void (t.size = v))}
      />
      <ColorRow label="颜色" value={effect.color} onChange={(c) => set((t) => void (t.color = c))} />
      <SliderRow
        label="不透明度"
        min={0}
        max={100}
        value={Math.round(effect.opacity * 100)}
        display={percent(effect.opacity)}
        onChange={(v) => set((t) => void (t.opacity = v / 100))}
      />
      <CheckRow
        label="内描边"
        checked={effect.inside}
        onChange={(inside) => set((t) => void (t.inside = inside))}
      />
    </>
  );
}

function GlowParams({
  effect,
  patch,
  pick
}: {
  effect: GlowEffect;
  patch: Patch;
  pick: Pick<GlowEffect>;
}) {
  const set = (fn: (target: GlowEffect) => void) =>
    patch((e) => {
      const target = pick(e);
      if (target) fn(target);
    });

  return (
    <>
      <SliderRow
        label="大小"
        min={0}
        max={100}
        value={Math.round(effect.size)}
        display={String(Math.round(effect.size))}
        onChange={(v) => set((t) => void (t.size = v))}
      />
      <ColorRow label="颜色" value={effect.color} onChange={(c) => set((t) => void (t.color = c))} />
      <SliderRow
        label="不透明度"
        min={0}
        max={100}
        value={Math.round(effect.opacity * 100)}
        display={percent(effect.opacity)}
        onChange={(v) => set((t) => void (t.opacity = v / 100))}
      />
    </>
  );
}

export function EffectsForm({ effects, patch }: { effects: LayerEffects; patch: Patch }) {
  const overlay = effects.colorOverlay;

  return (
    <div className="space-y-1 pb-1">
      {EFFECT_ORDER.map((id) => {
        const effect = effects[id];
        return (
          <div key={id} className="rounded border border-[var(--color-border)]">
            <div className="flex items-center gap-2 px-3 py-1">
              <input
                type="checkbox"
                checked={!!effect}
                aria-label={EFFECT_LABELS[id]}
                className="h-3.5 w-3.5 accent-[var(--color-primary)]"
                onChange={(e) => patch((target) => setEffectPresence(target, id, e.target.checked))}
              />
              <span className="flex-1 text-[10px]">{EFFECT_LABELS[id]}</span>
              {effect && (
                <label className="flex items-center gap-1 text-[10px] text-[var(--color-muted-foreground)]">
                  <input
                    type="checkbox"
                    checked={effect.enabled}
                    aria-label={`启用${EFFECT_LABELS[id]}`}
                    className="h-3 w-3 accent-[var(--color-primary)]"
                    onChange={(e) =>
                      patch((target) => setEffectEnabled(target, id, e.target.checked))
                    }
                  />
                  启用
                </label>
              )}
            </div>

            {effect && (
              <div className="pb-1">
                {id === 'stroke' && effects.stroke && (
                  <StrokeParams effect={effects.stroke} patch={patch} pick={(e) => e.stroke} />
                )}
                {id === 'shadow' && effects.shadow && (
                  <ShadowParams effect={effects.shadow} patch={patch} pick={(e) => e.shadow} />
                )}
                {id === 'innerShadow' && effects.innerShadow && (
                  <ShadowParams
                    effect={effects.innerShadow}
                    patch={patch}
                    pick={(e) => e.innerShadow}
                  />
                )}
                {id === 'colorOverlay' && overlay && (
                  <>
                    <ColorRow
                      label="颜色"
                      value={overlay.color}
                      onChange={(c) =>
                        patch((e) => {
                          if (e.colorOverlay) e.colorOverlay.color = c;
                        })
                      }
                    />
                    <SliderRow
                      label="不透明度"
                      min={0}
                      max={100}
                      value={Math.round(overlay.opacity * 100)}
                      display={percent(overlay.opacity)}
                      onChange={(v) =>
                        patch((e) => {
                          if (e.colorOverlay) e.colorOverlay.opacity = v / 100;
                        })
                      }
                    />
                  </>
                )}
                {id === 'outerGlow' && effects.outerGlow && (
                  <GlowParams effect={effects.outerGlow} patch={patch} pick={(e) => e.outerGlow} />
                )}
                {id === 'innerGlow' && effects.innerGlow && (
                  <GlowParams effect={effects.innerGlow} patch={patch} pick={(e) => e.innerGlow} />
                )}
              </div>
            )}
          </div>
        );
      })}
      <Row label="">
        <span className="text-[10px] text-[var(--color-muted-foreground)]">
          效果作用于图层自身像素，再参与混合模式
        </span>
      </Row>
    </div>
  );
}
