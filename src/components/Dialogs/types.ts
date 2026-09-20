import type { Rect } from '@/tui/Screen';
import type { Attr } from '@/tui/palette';

export interface ClusterItem {
  /** `~x~` marks the accelerator. */
  label: string;
  /** Status line text while this item is highlighted. */
  hint?: string;
}

interface At {
  x: number;
  y: number;
}

/** Plain black caption. */
export interface StaticControl extends At {
  kind: 'static';
  text: string;
}

/** Caption linked to a control: black normally, white while that control has focus. */
export interface LabelControl extends At {
  kind: 'label';
  text: string;
  for: string;
}

export interface InputControl extends At {
  kind: 'input';
  id: string;
  w: number;
  hint: string;
  /** The `▐↓▌` history button; on unless set to false. */
  history?: boolean;
  /** Display-only field, like the Result line of Evaluate and Modify. */
  readOnly?: boolean;
}

export interface ClusterControl extends At {
  kind: 'checks' | 'radios';
  id: string;
  w: number;
  items: ClusterItem[];
  hint: string;
  columns?: number;
  colWidth?: number;
}

export interface ListControl extends At {
  kind: 'list';
  id: string;
  w: number;
  h: number;
  items: string[];
  hint: string;
  /** `v` puts the scrollbar in the last column, `h` in the last row. */
  scroll?: 'v' | 'h' | 'none';
  /** Column of the blue divider of two-column file lists. */
  divider?: number;
}

/** `x` and `w` describe the green face; the shadow falls one cell right and down. */
export interface ButtonControl extends At {
  kind: 'button';
  id: string;
  w: number;
  label: string;
  result: string;
  hint: string;
  default?: boolean;
  disabled?: boolean;
}

export interface InfoControl extends At {
  kind: 'info';
  w: number;
  h: number;
  lines: string[];
  attr?: Attr;
}

export interface HelpControl extends At {
  kind: 'help';
  id: string;
  w: number;
  h: number;
  lines: string[];
  topic?: string;
  hint: string;
}

export interface BarControl extends At {
  kind: 'bar';
  w: number;
  text: string;
  accent?: string;
}

export interface SliderControl extends At {
  kind: 'slider';
  w: number;
  pos: number;
  max: number;
}

/** The framed colour picker of the Colors dialog. */
export interface SwatchControl extends At {
  kind: 'swatches';
  id: string;
  label: string;
  colors: number[];
  cols: number;
  hint: string;
}

export interface SampleControl extends At {
  kind: 'sample';
  w: number;
  h: number;
  text: string;
  attr: Attr;
}

export type Control =
  | StaticControl
  | LabelControl
  | InputControl
  | ClusterControl
  | ListControl
  | ButtonControl
  | InfoControl
  | HelpControl
  | BarControl
  | SliderControl
  | SwatchControl
  | SampleControl;

export interface DialogDef {
  id: string;
  title: string;
  rect: Rect;
  controls: Control[];
  /** Id of the control that takes focus first, when it is not the first one. */
  focus?: string;
  /** Dialogs without a frame close box (the Compiling progress box). */
  noClose?: boolean;
  /** Dismissed by any keypress, like the Compiling box. */
  anyKey?: boolean;
}

export const isFocusable = (c: Control): boolean => {
  switch (c.kind) {
    case 'input':
      return c.readOnly !== true;
    case 'checks':
    case 'radios':
    case 'list':
    case 'help':
    case 'swatches':
      return true;
    case 'button':
      return c.disabled !== true;
    default:
      return false;
  }
};

export const clusterRows = (c: ClusterControl): number =>
  Math.max(1, Math.ceil(c.items.length / (c.columns ?? 1)));
