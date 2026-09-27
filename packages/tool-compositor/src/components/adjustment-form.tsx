import { useState } from 'react';
import { Select } from '@pmp/ui';
import { curveLookup, type Adjustment } from '../lib/adjustments';
import { CheckRow, NumInput, Row, SliderRow } from './form-controls';
import { CurveEditor, type CurvePoint } from './curve-editor';

/** 调整图层的参数表单；按 kind 分支，参数名与 `.comp` 记录一一对应 */

const CHANNELS = ['RGB', '红', '绿', '蓝'];

interface Patch {
  (fn: (adjustment: Adjustment) => void): void;
}

function ChannelSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <Row label="通道">
      <Select
        className="h-6 w-full text-xs"
        value={String(value)}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {CHANNELS.map((name, index) => (
          <option key={name} value={String(index)}>
            {name}
          </option>
        ))}
      </Select>
    </Row>
  );
}

const CURVE_PRESETS: { label: string; points: CurvePoint[] }[] = [
  { label: '线性', points: [{ x: 0, y: 0 }, { x: 255, y: 255 }] },
  {
    label: '提亮',
    points: [{ x: 0, y: 0 }, { x: 128, y: 160 }, { x: 255, y: 255 }]
  },
  {
    label: '压暗',
    points: [{ x: 0, y: 0 }, { x: 128, y: 96 }, { x: 255, y: 255 }]
  },
  {
    label: 'S 曲线',
    points: [{ x: 0, y: 0 }, { x: 64, y: 40 }, { x: 192, y: 215 }, { x: 255, y: 255 }]
  }
];

function LevelsParams({ adjustment, patch }: { adjustment: Adjustment; patch: Patch }) {
  const [channel, setChannel] = useState(0);
  const range = adjustment.levels.ranges[channel];

  return (
    <>
      <ChannelSelect value={channel} onChange={setChannel} />
      <SliderRow
        label="黑场"
        min={0}
        max={254}
        value={Math.round(range.black)}
        display={String(Math.round(range.black))}
        onChange={(v) => patch((a) => void (a.levels.ranges[channel].black = v))}
      />
      <SliderRow
        label="灰点"
        min={10}
        max={300}
        value={Math.round(range.gamma * 100)}
        display={range.gamma.toFixed(2)}
        onChange={(v) => patch((a) => void (a.levels.ranges[channel].gamma = v / 100))}
      />
      <SliderRow
        label="白场"
        min={1}
        max={255}
        value={Math.round(range.white)}
        display={String(Math.round(range.white))}
        onChange={(v) => patch((a) => void (a.levels.ranges[channel].white = v))}
      />
      <SliderRow
        label="输出黑"
        min={0}
        max={255}
        value={Math.round(range.outputBlack)}
        display={String(Math.round(range.outputBlack))}
        onChange={(v) => patch((a) => void (a.levels.ranges[channel].outputBlack = v))}
      />
      <SliderRow
        label="输出白"
        min={0}
        max={255}
        value={Math.round(range.outputWhite)}
        display={String(Math.round(range.outputWhite))}
        onChange={(v) => patch((a) => void (a.levels.ranges[channel].outputWhite = v))}
      />
    </>
  );
}

function CurvesParams({ adjustment, patch }: { adjustment: Adjustment; patch: Patch }) {
  const [channel, setChannel] = useState(0);
  const points = adjustment.curves.channels[channel] as CurvePoint[];

  return (
    <>
      <ChannelSelect value={channel} onChange={setChannel} />
      <div className="px-3 py-1">
        <CurveEditor
          points={points}
          lookup={curveLookup}
          onChange={(next) => patch((a) => void (a.curves.channels[channel] = next))}
        />
      </div>
      <Row label="预设">
        <div className="flex flex-wrap gap-1">
          {CURVE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] hover:bg-[var(--color-accent)]"
              onClick={() =>
                patch((a) => void (a.curves.channels[channel] = preset.points.map((p) => ({ ...p }))))
              }
            >
              {preset.label}
            </button>
          ))}
        </div>
      </Row>
    </>
  );
}

const TONES = ['shadow', 'midtone', 'highlight'] as const;
const AXES = ['CyanRed', 'MagentaGreen', 'YellowBlue'] as const;
/** `${色调}${轴}` 恰好就是那 9 个数值字段，交给 TS 静态校验 */
type BalanceKey = `${(typeof TONES)[number]}${(typeof AXES)[number]}`;

const TONE_LABELS: Record<(typeof TONES)[number], string> = {
  shadow: '阴影',
  midtone: '中间调',
  highlight: '高光'
};
const AXIS_LABELS: Record<(typeof AXES)[number], string> = {
  CyanRed: '青—红',
  MagentaGreen: '洋红—绿',
  YellowBlue: '黄—蓝'
};

function ColorBalanceParams({ adjustment, patch }: { adjustment: Adjustment; patch: Patch }) {
  const cb = adjustment.colorBalanceSettings;

  return (
    <>
      {TONES.map((tone) => (
        <div key={tone}>
          <div className="px-3 pt-2 pb-0.5 text-[10px] text-[var(--color-muted-foreground)]">
            {TONE_LABELS[tone]}
          </div>
          {AXES.map((axis) => {
            const key: BalanceKey = `${tone}${axis}`;
            const value = cb[key];
            return (
              <SliderRow
                key={key}
                label={AXIS_LABELS[axis]}
                min={-100}
                max={100}
                value={Math.round(value)}
                display={String(Math.round(value))}
                onChange={(v) => patch((a) => void (a.colorBalanceSettings[key] = v))}
              />
            );
          })}
        </div>
      ))}
      <CheckRow
        label="保留明度"
        checked={cb.preserveLuminosity}
        onChange={(on) => patch((a) => void (a.colorBalanceSettings.preserveLuminosity = on))}
      />
    </>
  );
}

function NoiseParams({ adjustment, patch }: { adjustment: Adjustment; patch: Patch }) {
  return (
    <>
      <SliderRow
        label="数量"
        min={0.1}
        max={400}
        step={0.1}
        value={adjustment.noiseAmount}
        display={adjustment.noiseAmount.toFixed(1)}
        onChange={(v) => patch((a) => void (a.noiseAmount = v))}
      />
      <CheckRow
        label="高斯分布"
        checked={adjustment.noiseGaussian}
        onChange={(on) => patch((a) => void (a.noiseGaussian = on))}
      />
      <CheckRow
        label="单色"
        checked={adjustment.noiseMonochromatic}
        onChange={(on) => patch((a) => void (a.noiseMonochromatic = on))}
      />
      <Row label="种子">
        <div className="flex items-center gap-1">
          <NumInput
            value={adjustment.noiseSeed}
            onCommit={(v) => patch((a) => void (a.noiseSeed = Math.round(v)))}
          />
          <button
            type="button"
            className="shrink-0 rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] hover:bg-[var(--color-accent)]"
            onClick={() => patch((a) => void (a.noiseSeed = Math.floor(Math.random() * 100000)))}
          >
            随机
          </button>
        </div>
      </Row>
    </>
  );
}

export function AdjustmentForm({
  adjustment,
  patch
}: {
  adjustment: Adjustment;
  patch: Patch;
}) {
  switch (adjustment.kind) {
    case 'Invert':
      return (
        <Row label="参数">
          <span className="text-[10px] text-[var(--color-muted-foreground)]">反相没有参数</span>
        </Row>
      );
    case 'Hue/Saturation':
      return (
        <>
          <SliderRow
            label="色相"
            min={-180}
            max={180}
            value={Math.round(adjustment.hue)}
            display={`${Math.round(adjustment.hue)}°`}
            onChange={(v) => patch((a) => void (a.hue = v))}
          />
          <SliderRow
            label="饱和度"
            min={-100}
            max={100}
            value={Math.round(adjustment.saturation)}
            display={String(Math.round(adjustment.saturation))}
            onChange={(v) => patch((a) => void (a.saturation = v))}
          />
          <SliderRow
            label="明度"
            min={-100}
            max={100}
            value={Math.round(adjustment.lightness)}
            display={String(Math.round(adjustment.lightness))}
            onChange={(v) => patch((a) => void (a.lightness = v))}
          />
          <CheckRow
            label="着色"
            checked={adjustment.colorize}
            onChange={(on) => patch((a) => void (a.colorize = on))}
          />
        </>
      );
    case 'Levels':
      return <LevelsParams adjustment={adjustment} patch={patch} />;
    case 'Curves':
      return <CurvesParams adjustment={adjustment} patch={patch} />;
    case 'Color Balance':
      return <ColorBalanceParams adjustment={adjustment} patch={patch} />;
    case 'Add Noise':
      return <NoiseParams adjustment={adjustment} patch={patch} />;
    default:
      return null;
  }
}
