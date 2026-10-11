interface Color {
  id: number;
  // "#RRGGBB"
  rgb: string;
}

// Only painted cells, as two parallel arrays: position[i] is painted with color_id[i].
// position = y * width + x.
interface CanvasSnapshot {
  width: number;
  height: number;
  position: number[];
  color_id: number[];
}

const BACKGROUND_COLOR = '#FFFFFF';
// Screen pixels per canvas pixel.
const DEFAULT_SCALE = 5;
const SAVE_TIMEOUT_MS = 5000;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function draw(
  canvas: HTMLCanvasElement,
  palette: Color[],
  snap: CanvasSnapshot
): CanvasRenderingContext2D {
  // The canvas keeps the real resolution, CSS scales it up without smoothing (see setScale).
  canvas.width = snap.width;
  canvas.height = snap.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not supported');
  const image = ctx.createImageData(snap.width, snap.height);
  const background = hexToRgb(BACKGROUND_COLOR);
  const cellCount = snap.width * snap.height;
  for (let i = 0; i < cellCount; i++) {
    image.data.set([...background, 255], i * 4);
  }

  const colors = new Map(palette.map((c) => [c.id, c.rgb]));
  if (snap.position.length !== snap.color_id.length) {
    throw new Error('Canvas snapshot: position and color_id have different lengths');
  }
  for (let i = 0; i < snap.position.length; i++) {
    const position = snap.position[i];
    const color_id = snap.color_id[i];
    if (!Number.isInteger(position) || position < 0 || position >= cellCount) {
      console.warn(`Ignoring pixel outside the canvas: position ${position}, cells ${cellCount}`);
      continue;
    }
    const hex = colors.get(color_id);
    if (!hex) {
      console.warn(`Ignoring pixel with unknown color: position ${position}, color ${color_id}`);
      continue;
    }
    image.data.set([...hexToRgb(hex), 255], position * 4);
  }
  ctx.putImageData(image, 0, 0);
  return ctx;
}

function setScale(canvas: HTMLCanvasElement, scale: number): void {
  canvas.style.width = `${canvas.width * scale}px`;
  canvas.style.height = `${canvas.height * scale}px`;
}

// Cell under the mouse, or null outside the canvas. The scale is taken from the rendered size,
// so this stays correct for any scale. clientLeft/clientTop skip the border.
function cellAt(canvas: HTMLCanvasElement, event: MouseEvent): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  const scale = canvas.clientWidth / canvas.width;
  const x = Math.floor((event.clientX - rect.left - canvas.clientLeft) / scale);
  const y = Math.floor((event.clientY - rect.top - canvas.clientTop) / scale);
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
  return { x, y };
}

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`#${id} not found`);
  return element;
}

async function postPixel(position: number, colorId: number): Promise<void> {
  const response = await fetch('/api/pixel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ position, color_id: colorId }),
    signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`POST /api/pixel failed: ${response.status}`);
}

// Colour picker opened by a click on a cell.
// - choosing a colour previews it on the cell;
// - OK sends the pixel to the server and keeps it only if the server saved it;
// - a click outside the picker, Escape or a scale change puts the old colour back.
// While the pixel is being saved the picker is locked: a cancel at that moment would remove
// the pixel from the canvas that the server is about to store.
// Returns cancel() for the callers that change the layout under an open picker.
function setupPicker(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  palette: Color[]
): () => void {
  const picker = byId('picker', HTMLDivElement);
  const swatches = byId('swatches', HTMLDivElement);
  const ok = byId('ok', HTMLButtonElement);
  const status = byId('status', HTMLParagraphElement);

  // The cell with the pixel it had before the preview; null while the picker is closed.
  let selected: { x: number; y: number; original: ImageData } | null = null;
  let chosen: Color | null = null;
  let saving = false;

  for (const color of palette) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'swatch';
    button.style.backgroundColor = color.rgb;
    button.title = color.rgb;
    button.setAttribute('aria-label', color.rgb);
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      if (!selected || saving) return;
      chosen = color;
      ctx.fillStyle = color.rgb;
      ctx.fillRect(selected.x, selected.y, 1, 1);
      for (const other of swatches.children) {
        other.setAttribute('aria-pressed', String(other === button));
      }
      ok.disabled = false;
    });
    swatches.append(button);
  }

  const close = (): void => {
    selected = null;
    chosen = null;
    picker.hidden = true;
    ok.disabled = true;
    for (const swatch of swatches.children) swatch.setAttribute('aria-pressed', 'false');
  };

  const cancel = (): void => {
    if (saving) return;
    if (selected) ctx.putImageData(selected.original, selected.x, selected.y);
    close();
  };

  const open = (cell: { x: number; y: number }, event: MouseEvent): void => {
    selected = { ...cell, original: ctx.getImageData(cell.x, cell.y, 1, 1) };
    status.textContent = '';
    picker.hidden = false;
    // Next to the click, moved back inside the visible part of the page if it does not fit.
    const maxLeft = window.scrollX + document.documentElement.clientWidth - picker.offsetWidth - 8;
    const maxTop = window.scrollY + document.documentElement.clientHeight - picker.offsetHeight - 8;
    picker.style.left = `${Math.max(0, Math.min(event.pageX + 8, maxLeft))}px`;
    picker.style.top = `${Math.max(0, Math.min(event.pageY + 8, maxTop))}px`;
  };

  const setSaving = (value: boolean): void => {
    saving = value;
    ok.textContent = value ? 'Saving…' : 'OK';
    for (const swatch of swatches.children) (swatch as HTMLButtonElement).disabled = value;
    if (value) ok.disabled = true;
  };

  ok.addEventListener('click', async () => {
    if (!selected || !chosen || saving) return;
    const { x, y, original } = selected;
    setSaving(true);
    try {
      await postPixel(y * canvas.width + x, chosen.id);
    } catch (e) {
      // Not saved (server error, network, timeout): the pixel must not stay on the canvas.
      console.error(e);
      ctx.putImageData(original, x, y);
      status.textContent = 'Could not save the pixel, it was removed from the canvas.';
    }
    close();
    setSaving(false);
  });

  document.addEventListener('click', (event) => {
    if (saving) return;
    if (event.target instanceof Node && picker.contains(event.target)) return;
    cancel();
    if (event.target !== canvas) return;
    const cell = cellAt(canvas, event);
    if (cell) open(cell, event);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') cancel();
  });

  return cancel;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
  return (await response.json()) as T;
}

async function main(): Promise<void> {
  const canvas = byId('canvas', HTMLCanvasElement);
  const scaleInput = byId('scale', HTMLInputElement);

  const [palette, snapshot] = await Promise.all([
    fetchJson<Color[]>('/api/palette'),
    fetchJson<CanvasSnapshot>('/api/canvas'),
  ]);
  const ctx = draw(canvas, palette, snapshot);
  const cancelPicker = setupPicker(canvas, ctx, palette);

  scaleInput.value = String(DEFAULT_SCALE);
  setScale(canvas, DEFAULT_SCALE);
  scaleInput.addEventListener('input', () => {
    cancelPicker(); // the picker position is wrong after the resize
    setScale(canvas, Number(scaleInput.value));
  });
}

main().catch((e) => console.error(e));
