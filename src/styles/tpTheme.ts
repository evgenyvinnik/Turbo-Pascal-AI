import { C, attr, type Attr } from '@/tui/palette';

/**
 * Colour attributes sampled cell by cell from the Turbo Pascal 7.1 reference
 * screenshots. Keeping them in one table makes the painters read like the
 * original Turbo Vision palette arrays.
 */
export const TP = {
  desktop: attr(C.Blue, C.LightGray),

  menuBar: attr(C.Black, C.LightGray),
  menuBarHot: C.Red,
  menuBarSelected: attr(C.Black, C.Green),
  menuBarDisabled: attr(C.DarkGray, C.LightGray),

  menu: attr(C.Black, C.LightGray),
  menuHot: C.Red,
  menuSelected: attr(C.Black, C.Green),
  menuDisabled: attr(C.DarkGray, C.LightGray),
  menuDisabledSelected: attr(C.DarkGray, C.Green),

  status: attr(C.Black, C.LightGray),
  statusKey: C.Red,
  statusDisabled: attr(C.DarkGray, C.LightGray),
  statusDisabledKey: C.DarkGray,

  // Edit window
  editFrame: attr(C.White, C.Blue),
  editFrameInactive: attr(C.LightGray, C.Blue),
  editIcon: attr(C.LightGreen, C.Blue),
  editText: attr(C.Yellow, C.Blue),
  editKeyword: attr(C.White, C.Blue),
  editComment: attr(C.LightGray, C.Blue),
  editHighlight: attr(C.Black, C.Cyan),
  editError: attr(C.Yellow, C.Red),
  editScroll: attr(C.Blue, C.Cyan),
  editGrip: attr(C.LightGreen, C.Blue),

  // Cyan tool windows (Watches, Call stack, Messages)
  toolFrame: attr(C.White, C.Cyan),
  toolFrameInactive: attr(C.LightGray, C.Cyan),
  toolIcon: attr(C.LightGreen, C.Cyan),
  toolText: attr(C.Blue, C.Cyan),
  toolSelected: attr(C.White, C.Green),
  toolScroll: attr(C.Cyan, C.Blue),
  toolGrip: attr(C.LightGreen, C.Cyan),

  // Output window (program screen)
  outFrame: attr(C.White, C.Black),
  outFrameInactive: attr(C.LightGray, C.Black),
  outIcon: attr(C.LightGreen, C.Black),
  outText: attr(C.LightGray, C.Black),
  outScroll: attr(C.Blue, C.Cyan),
  outGrip: attr(C.LightGreen, C.Black),

  // Dialogs
  dlgFrame: attr(C.White, C.LightGray),
  dlgIcon: attr(C.LightGreen, C.LightGray),
  dlgLabel: attr(C.Black, C.LightGray),
  dlgLabelFocus: attr(C.White, C.LightGray),
  dlgLabelHot: C.Yellow,
  dlgStatic: attr(C.Black, C.LightGray),
  dlgCluster: attr(C.Black, C.Cyan),
  dlgClusterHot: C.Yellow,
  dlgClusterFocus: attr(C.White, C.Cyan),
  dlgInput: attr(C.White, C.Blue),
  dlgInputSel: attr(C.White, C.Green),
  dlgHistorySide: attr(C.Green, C.LightGray),
  dlgHistoryArrow: attr(C.Black, C.Green),
  dlgList: attr(C.Black, C.Cyan),
  dlgListFocus: attr(C.White, C.Green),
  dlgListSelected: attr(C.Yellow, C.Cyan),
  dlgListDivider: attr(C.Blue, C.Cyan),
  dlgListScroll: attr(C.Cyan, C.Blue),
  dlgInfo: attr(C.LightCyan, C.Blue),
  dlgButton: attr(C.Black, C.Green),
  dlgButtonHot: C.Yellow,
  dlgButtonDefault: attr(C.LightCyan, C.Green),
  dlgButtonFocus: attr(C.White, C.Green),
  dlgButtonDisabled: attr(C.DarkGray, C.LightGray),
  dlgBar: attr(C.White, C.Blue),
  dlgBarAccent: attr(C.White, C.LightBlue),

  // Help window
  helpText: attr(C.Yellow, C.Cyan),
  helpLine: attr(C.Black, C.Cyan),
  helpShadow: attr(C.Black, C.Black),
} satisfies Record<string, Attr | number>;

export type ThemeAttr = Attr;
