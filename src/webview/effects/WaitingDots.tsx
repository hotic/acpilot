// Shared, monochrome waiting indicator. Motion follows the shell's appearance
// axis and reduced-motion preference through tokens.css.
export function WaitingDots() {
  return <span className="waiting-dots" aria-hidden="true"><span /><span /><span /></span>;
}
