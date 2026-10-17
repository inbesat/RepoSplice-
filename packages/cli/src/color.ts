// P-202 — terminal color primitives: capability detection, ANSI stripping,
// and the small code translators the token palette paints with. Pure and
// env-injectable, so the matrix tests need no process mutation.

/** The env a capability check reads: `NO_COLOR`, `TERM`, `FORCE_COLOR`. */
type Env = Record<string, string | undefined>;

/**
 * supportsColor: TTY + no NO_COLOR + not TERM=dumb, with FORCE_COLOR as the
 * explicit lever — any non-`0`/`false` value forces color even off-TTY, and
 * `NO_COLOR` wins over everything (the de-facto standard precedence).
 * `--no-color` is the CLI's own spelling and lands here as NO_COLOR.
 */
export function supportsColor(stream: { isTTY?: boolean }, env: Env): boolean {
  const noColor = env['NO_COLOR'];
  if (noColor !== undefined && noColor !== '0' && noColor !== 'false') return false;
  if (env['TERM'] === 'dumb') return false;
  const force = env['FORCE_COLOR'];
  if (force !== undefined) return force !== '0' && force !== 'false';
  return stream.isTTY === true;
}

/** Does the terminal do 24-bit color? (COLORTERM is the convention.) */
export function supportsTruecolor(env: Env): boolean {
  const colorterm = env['COLORTERM'];
  return colorterm === 'truecolor' || colorterm === '24bit';
}

// ESC built from a char code: the no-control-regex rule rightly flags a
// literal control character in a regex source.
const ANSI_CSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;:]*[A-Za-z]`, 'g');

/** Strip ANSI CSI sequences (incl. every SGR) — the piped/redacted boundary. */
export function stripColor(input: string): string {
  return input.replace(ANSI_CSI, '');
}

/** rgbToAnsi256: nearest color in the 6×6×6 cube, grayscale ramp at the edges. */
export function rgbToAnsi256(red: number, green: number, blue: number): number {
  // grayscale: the cube values 232-255 need near-equal channels
  if (Math.abs(red - green) < 8 && green - blue < 8 && green - blue > -8) {
    if (red < 8) return 16;
    if (red > 248) return 231;
    return Math.round(((red - 8) / 247) * 24) + 232;
  }
  return (
    16 +
    36 * Math.round((red / 255) * 5) +
    6 * Math.round((green / 255) * 5) +
    Math.round((blue / 255) * 5)
  );
}

/** Paint `text` foreground-256. */
export function ansi256(text: string, code: number): string {
  return `\x1B[38;5;${code}m${text}\x1B[39m`;
}

/** Paint `text` foreground-truecolor (16m). */
export function ansi16m(text: string, red: number, green: number, blue: number): string {
  return `\x1B[38;2;${red};${green};${blue}m${text}\x1B[39m`;
}
