import { CANVAS_HEIGHT, CANVAS_WIDTH, PALETTE, TRANSPORTS } from '../shared/protocol.ts';
import { LiveCanvas, percentile } from './live-canvas.ts';

const LABELS = {
  ws: 'WebSocket',
  sse: 'Server-Sent Events + POST',
  lp: 'Long polling + POST',
  poll: 'Short polling + POST',
} as const;
const EMPTY_RGB = [236, 236, 236];
const RGB = PALETTE.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
const MAX_LOG_LINES = 100;

const transport =
  TRANSPORTS.find((name) => name === new URLSearchParams(location.search).get('t')) ?? 'ws';
document.title = `${LABELS[transport]} · realtime prototype`;

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = byId<HTMLCanvasElement>('canvas');
const context = canvas.getContext('2d') as CanvasRenderingContext2D;
const image = context.createImageData(CANVAS_WIDTH, CANVAS_HEIGHT);
const statsView = byId<HTMLPreElement>('stats');
const serverView = byId<HTMLPreElement>('server');
const logView = byId<HTMLOListElement>('log');
let selectedColor = 2;
let renderQueued = false;

const live = new LiveCanvas({
  baseUrl: location.origin,
  transport,
  onChange: scheduleRender,
  onLog: addLogLine,
});

const select = byId<HTMLSelectElement>('transport');
for (const name of TRANSPORTS)
  select.add(new Option(LABELS[name], name, false, name === transport));
select.onchange = () => {
  location.search = `?t=${select.value}`;
};

const palette = byId<HTMLDivElement>('palette');
PALETTE.forEach((hex, color) => {
  const button = document.createElement('button');
  button.style.background = hex;
  button.title = hex;
  button.ariaPressed = String(color === selectedColor);
  button.onclick = () => {
    selectedColor = color;
    for (const other of palette.children) other.ariaPressed = String(other === button);
  };
  palette.append(button);
});

// Your own pixel is not drawn on click: it appears when it comes back through the transport,
// exactly like everyone else's.
canvas.onclick = async (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor(((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH);
  const y = Math.floor(((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT);
  const sentAt = performance.now();
  const result = await live.place(x, y, selectedColor);
  const ms = Math.round(performance.now() - sentAt);
  addLogLine(
    result.ok
      ? `placed #${result.id} at ${x},${y}, confirmed in ${ms} ms`
      : `rejected: ${result.error}`
  );
};

byId<HTMLButtonElement>('drop').onclick = () => live.drop();
byId<HTMLButtonElement>('drop-all').onclick = () => {
  void fetch('/api/debug/drop', { method: 'POST' });
};

function scheduleRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(render);
}

function render(): void {
  renderQueued = false;
  live.cells.forEach((color, i) => {
    image.data.set(RGB[color] ?? EMPTY_RGB, i * 4);
    image.data[i * 4 + 3] = 255;
  });
  context.putImageData(image, 0, 0);

  const { stats, latencies } = live;
  const ms = (p: number) => percentile(latencies, p) ?? '-';
  statsView.textContent = [
    `transport    ${LABELS[transport]}`,
    `state        ${live.state}`,
    `last event   ${live.lastEventId}`,
    `applied      ${stats.applied}`,
    `duplicates   ${stats.duplicates}`,
    `gaps         ${stats.gaps}`,
    `resyncs      ${stats.resyncs}`,
    `reconnects   ${stats.reconnects}`,
    `latency ms   p50 ${ms(50)}  p95 ${ms(95)}  max ${ms(100)}  (last ${latencies.length})`,
  ].join('\n');
}

function addLogLine(line: string): void {
  const item = document.createElement('li');
  item.textContent = `${new Date().toLocaleTimeString()}  ${line}`;
  logView.prepend(item);
  while (logView.children.length > MAX_LOG_LINES) logView.lastElementChild?.remove();
}

async function refreshServerStats(): Promise<void> {
  try {
    const response = await fetch('/api/stats');
    serverView.textContent = JSON.stringify(await response.json(), null, 2);
  } catch {
    serverView.textContent = 'server unreachable';
  }
}

setInterval(() => void refreshServerStats(), 2_000);
void refreshServerStats();
live.start().catch((error: unknown) => addLogLine(`start failed: ${String(error)}`));
