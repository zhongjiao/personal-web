import { Select } from '@pmp/ui';
import {
  FONT_OPTIONS,
  SHAPE_LABELS,
  type ShapeKind,
  type ShapeState,
  type TextState
} from '../lib/text-shape';
import { ColorRow, Row, SliderRow } from './form-controls';

/** 文字 / 形状图层的参数表单：改完元数据后由调用方负责重渲染 PNG */

const percent = (v: number) => `${Math.round(v * 100)}%`;

export function TextForm({
  text,
  patch
}: {
  text: TextState;
  patch: (fn: (state: TextState) => void) => void;
}) {
  return (
    <>
      <Row label="内容">
        <textarea
          value={text.content}
          rows={3}
          className="w-full min-w-0 resize-y rounded border border-[var(--color-input)] bg-[var(--color-background)] px-1.5 py-1 text-xs outline-none focus:ring-1 focus:ring-[var(--color-ring)]"
          onChange={(e) => patch((state) => void (state.content = e.target.value))}
        />
      </Row>
      <Row label="字体">
        <Select
          className="h-6 w-full text-xs"
          value={text.font}
          onChange={(e) => patch((state) => void (state.font = e.target.value))}
        >
          {FONT_OPTIONS.map((option) => (
            <option key={option.name} value={option.name}>
              {option.label}（{option.name}）
            </option>
          ))}
        </Select>
      </Row>
      <SliderRow
        label="字号"
        min={8}
        max={400}
        value={Math.round(text.size)}
        display={String(Math.round(text.size))}
        onChange={(v) => patch((state) => void (state.size = v))}
      />
      <ColorRow
        label="颜色"
        value={text.color}
        onChange={(color) => patch((state) => void (state.color = color))}
      />
      <Row label="对齐">
        <Select
          className="h-6 w-full text-xs"
          value={text.alignment}
          onChange={(e) =>
            patch((state) => void (state.alignment = e.target.value as TextState['alignment']))
          }
        >
          <option value="left">左</option>
          <option value="center">居中</option>
          <option value="right">右</option>
        </Select>
      </Row>
      <SliderRow
        label="字距"
        min={-20}
        max={40}
        value={Math.round(text.tracking)}
        display={String(Math.round(text.tracking))}
        onChange={(v) => patch((state) => void (state.tracking = v))}
      />
      <SliderRow
        label="行距"
        min={80}
        max={250}
        value={Math.round(text.lineHeight * 100)}
        display={text.lineHeight.toFixed(2)}
        onChange={(v) => patch((state) => void (state.lineHeight = v / 100))}
      />
      <SliderRow
        label="段落宽"
        min={0}
        max={2000}
        value={Math.round(text.boxWidth ?? 0)}
        display={text.boxWidth ? String(Math.round(text.boxWidth)) : '自适应'}
        onChange={(v) => patch((state) => void (state.boxWidth = v > 0 ? v : null))}
      />
      <Row label="">
        <span className="text-[10px] text-[var(--color-muted-foreground)]">
          改元数据会重渲染 PNG；再做强破坏性操作就会丢可编辑性
        </span>
      </Row>
    </>
  );
}

const SHAPE_KINDS: ShapeKind[] = ['rect', 'roundedRect', 'ellipse', 'line'];

export function ShapeForm({
  shape,
  patch
}: {
  shape: ShapeState;
  patch: (fn: (state: ShapeState) => void) => void;
}) {
  return (
    <>
      <Row label="类型">
        <Select
          className="h-6 w-full text-xs"
          value={shape.kind}
          onChange={(e) => patch((state) => void (state.kind = e.target.value as ShapeKind))}
        >
          {SHAPE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {SHAPE_LABELS[kind]}
            </option>
          ))}
        </Select>
      </Row>
      <ColorRow
        label="颜色"
        value={shape.color}
        onChange={(color) => patch((state) => void (state.color = color))}
      />
      {shape.kind === 'roundedRect' && (
        <SliderRow
          label="圆角"
          min={0}
          max={200}
          value={Math.round(shape.cornerRadius)}
          display={String(Math.round(shape.cornerRadius))}
          onChange={(v) => patch((state) => void (state.cornerRadius = v))}
        />
      )}
      {shape.kind === 'line' && (
        <>
          <SliderRow
            label="线宽"
            min={1}
            max={80}
            value={Math.round(shape.lineWidth)}
            display={String(Math.round(shape.lineWidth))}
            onChange={(v) => patch((state) => void (state.lineWidth = v))}
          />
          <SliderRow
            label="起点 X"
            min={0}
            max={100}
            value={Math.round(shape.start[0] * 100)}
            display={percent(shape.start[0])}
            onChange={(v) => patch((state) => void (state.start = [v / 100, state.start[1]]))}
          />
          <SliderRow
            label="起点 Y"
            min={0}
            max={100}
            value={Math.round(shape.start[1] * 100)}
            display={percent(shape.start[1])}
            onChange={(v) => patch((state) => void (state.start = [state.start[0], v / 100]))}
          />
          <SliderRow
            label="终点 X"
            min={0}
            max={100}
            value={Math.round(shape.end[0] * 100)}
            display={percent(shape.end[0])}
            onChange={(v) => patch((state) => void (state.end = [v / 100, state.end[1]]))}
          />
          <SliderRow
            label="终点 Y"
            min={0}
            max={100}
            value={Math.round(shape.end[1] * 100)}
            display={percent(shape.end[1])}
            onChange={(v) => patch((state) => void (state.end = [state.end[0], v / 100]))}
          />
        </>
      )}
      <Row label="">
        <span className="text-[10px] text-[var(--color-muted-foreground)]">
          形状按图层框重新渲染，缩放不会糊
        </span>
      </Row>
    </>
  );
}
