export type Action = 'left' | 'right' | 'up' | 'down' | 'attack' | 'jump' | 'special';

const KEY_MAP: Record<string, Action> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  KeyA: 'left',
  KeyD: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyJ: 'attack',
  KeyZ: 'attack',
  Space: 'attack',
  KeyK: 'jump',
  KeyX: 'jump',
  KeyL: 'special',
  KeyC: 'special',
  ShiftLeft: 'special'
};

/** 键盘 + 虚拟按键统一输入源 */
export class Input {
  private down = new Set<Action>();
  private pressed = new Set<Action>();
  private virtual = new Set<Action>();
  private virtualPressed = new Set<Action>();
  private onPause?: () => void;
  private bound = false;

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      e.preventDefault();
      this.onPause?.();
      return;
    }
    const action = KEY_MAP[e.code];
    if (!action) return;
    // 避免方向键 / 空格滚动页面
    e.preventDefault();
    if (!this.down.has(action)) this.pressed.add(action);
    this.down.add(action);
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    const action = KEY_MAP[e.code];
    if (!action) return;
    e.preventDefault();
    this.down.delete(action);
  };

  private handleBlur = () => {
    this.down.clear();
    this.virtual.clear();
  };

  bind(target: Window, onPause: () => void) {
    if (this.bound) return;
    this.onPause = onPause;
    target.addEventListener('keydown', this.handleKeyDown);
    target.addEventListener('keyup', this.handleKeyUp);
    target.addEventListener('blur', this.handleBlur);
    this.bound = true;
  }

  unbind(target: Window) {
    if (!this.bound) return;
    target.removeEventListener('keydown', this.handleKeyDown);
    target.removeEventListener('keyup', this.handleKeyUp);
    target.removeEventListener('blur', this.handleBlur);
    this.bound = false;
  }

  /** 虚拟按键（触屏）按下 / 抬起 */
  setVirtual(action: Action, pressed: boolean) {
    if (pressed) {
      if (!this.virtual.has(action)) this.virtualPressed.add(action);
      this.virtual.add(action);
    } else {
      this.virtual.delete(action);
    }
  }

  isDown(action: Action) {
    return this.down.has(action) || this.virtual.has(action);
  }

  justPressed(action: Action) {
    return this.pressed.has(action) || this.virtualPressed.has(action);
  }

  /** 每帧末尾调用，清理「刚按下」状态 */
  endFrame() {
    this.pressed.clear();
    this.virtualPressed.clear();
  }

  clear() {
    this.down.clear();
    this.pressed.clear();
    this.virtual.clear();
    this.virtualPressed.clear();
  }
}
