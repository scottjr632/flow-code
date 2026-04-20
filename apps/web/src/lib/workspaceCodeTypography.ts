export const WORKSPACE_CODE_FONT_SIZE_PX = 11;
export const WORKSPACE_CODE_LINE_HEIGHT_PX = 17;

export function buildPierreDiffTypographyCSSVars(): string {
  return `--diffs-font-size: ${WORKSPACE_CODE_FONT_SIZE_PX}px; --diffs-line-height: ${WORKSPACE_CODE_LINE_HEIGHT_PX}px;`;
}
