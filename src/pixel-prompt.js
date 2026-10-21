/**
 * An action prompt drawn in pixels, on the game's own pixel grid: the button
 * to hold (B on a red round pad button, J on a key cap), the word in a 5×7
 * pixel font with a hard drop shadow, and under it a gauge of segments that
 * fill while the button is held. Idle, the button's outline blinks in steps;
 * held, it sinks a pixel and the segments fill one by one; full, they flash
 * white. Drawn into a tiny canvas shown at the game's pixel size, never smoothed.
 *
 * draw({ device: 'pad' | 'keyboard', label, progress 0 → 1, time }).
 */
const GLYPHS = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  J: ['..###', '...#.', '...#.', '...#.', '#..#.', '#..#.', '.##..'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  ' ': ['...', '...', '...', '...', '...', '...', '...'],
};
// Accented capitals: the letter, and the accent's pixels in the two rows above it.
const ACCENTS = { 'É': ['E', [[3, -2], [2, -1]]] };
const BUTTON = 15, GAP = 5, SEGMENTS = 9;

/** How wide a word is in the pixel font (1 pixel between letters). */
export function textWidth(text) {
  return [...text].reduce((width, char, i) => width + glyphOf(char).glyph[0].length + (i ? 1 : 0), 0);
}
function glyphOf(char) {
  const [base, accent] = ACCENTS[char] ?? [char, null];
  return { glyph: GLYPHS[base] ?? GLYPHS[' '], accent };
}

export function createPixelPrompt(canvas) {
  const ctx = canvas.getContext('2d');
  let width = 0, height = 0;
  const px = (x, y, colour, w = 1, h = 1) => { ctx.fillStyle = colour; ctx.fillRect(x, y, w, h); };
  /** A word at (x, y) (top of the capitals), with a hard shadow a pixel down and right. */
  function word(text, x, y, colour) {
    for (const [dx, dy, tint] of [[1, 1, '#000000c0'], [0, 0, colour]]) {
      let at = x;
      for (const char of text) {
        const { glyph, accent } = glyphOf(char);
        glyph.forEach((row, r) => [...row].forEach((cell, c) => { if (cell === '#') px(at + c + dx, y + r + dy, tint); }));
        if (accent) for (const [c, r] of accent) px(at + c + dx, y + r + dy, tint);
        at += glyph[0].length + 1;
      }
    }
  }
  /** The red round B of a pad, or a key cap with J; pressed, it sinks a pixel. */
  function button(device, pressed, blink) {
    const y = pressed ? 1 : 0, r = (BUTTON - 1) / 2;
    if (device === 'pad') {
      for (let j = 0; j < BUTTON; j++) for (let i = 0; i < BUTTON; i++) {
        const dx = i - r, dy = j - r, d = Math.hypot(dx, dy);
        if (d > r + 0.35) continue;
        const rim = d > r - 1.1, light = dx + dy < -r * 0.9;
        px(i, j + y, rim ? (dx + dy > 0 ? '#5e100c' : '#8e1d16') : light ? (pressed ? '#c23a2e' : '#ff6f5c') : pressed ? '#9c2a21' : '#c9362c');
      }
      if (!pressed) for (let i = 2; i < BUTTON - 2; i++) px(i, BUTTON, '#000000a0');
      word('B', 5, 4 + y, '#ffffff');
    } else {
      px(0, y, '#9ad9ff', BUTTON, BUTTON);
      px(1, 1 + y, pressed ? '#141b26' : '#2b3546', BUTTON - 2, BUTTON - 2);
      px(2, 2 + y, pressed ? '#101620' : '#1b2330', BUTTON - 4, BUTTON - 5);
      if (!pressed) px(1, BUTTON, '#000000a0', BUTTON - 1, 1);
      word('J', 5, 4 + y, '#d8f0ff');
    }
    // Waiting: the outline blinks, in steps.
    if (blink) {
      const colour = '#fff4d0';
      if (device === 'pad') for (let j = -1; j <= BUTTON; j++) for (let i = -1; i <= BUTTON; i++) {
        const d = Math.hypot(i - r, j - r);
        if (d > r + 0.35 && d <= r + 1.35) px(i, j, colour);
      } else {
        px(-1, -1, colour, BUTTON + 2, 1); px(-1, BUTTON, colour, BUTTON + 2, 1);
        px(-1, 0, colour, 1, BUTTON); px(BUTTON, 0, colour, 1, BUTTON);
      }
    }
  }
  function draw({ device = 'pad', label = 'DÉTRUIRE', progress = 0, time = 0 }) {
    const textAt = BUTTON + GAP + 1, labelWidth = textWidth(label);
    const w = textAt + Math.max(labelWidth, SEGMENTS * 5 - 1) + 2, h = BUTTON + 3;
    if (w !== width || h !== height) { width = canvas.width = w; height = canvas.height = h; }
    ctx.clearRect(0, 0, w, h);
    const holding = progress > 0, full = progress >= 1;
    ctx.save();
    ctx.translate(1, 1);
    button(device, holding, !holding && Math.floor(time * 2.2) % 2 === 0);
    ctx.restore();
    word(label, textAt, 3, full ? '#ffffff' : '#f2e6d8');
    // The gauge: segments filling one by one; full, a white flash.
    const filled = Math.floor(progress * SEGMENTS + 1e-6), flash = full && Math.floor(time * 12) % 2 === 0;
    for (let i = 0; i < SEGMENTS; i++) {
      const x = textAt + i * 5;
      px(x + 1, 13, '#000000c0', 4, 3);
      px(x, 12, i < filled ? (flash ? '#ffffff' : '#ff5b4f') : '#3a2422', 4, 3);
      if (i < filled && !flash) px(x, 12, '#ffb3a8', 4, 1);
    }
    return { width: w, height: h };
  }
  return { draw };
}
