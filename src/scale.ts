import { formatKg } from "./format";

const RANGE_G = 20000;
const STEP_G = 500;
const PX_PER_STEP = 8;
const LABEL_EVERY_G = 2500;

export interface DragHooks {
  onStart(): void;
  onEnd(): void;
}

let current: HTMLElement | null = null;

export function closeScale(): void {
  current?.remove();
  current = null;
}

export function bindWeightDrag(target: HTMLElement, weight: { grams: number }, show: () => void, hooks: DragHooks): void {
  let pointerId: number | null = null;
  let drag: { startY: number; startG: number; update: (grams: number) => void } | null = null;

  const finish = () => {
    drag = null;
    pointerId = null;
    closeScale();
    hooks.onEnd();
  };

  target.addClass("gym-draggable");
  target.onpointerdown = (event) => {
    if (pointerId !== null) return;
    event.preventDefault();
    pointerId = event.pointerId;
    target.setPointerCapture(event.pointerId);
    hooks.onStart();
    const startG = weight.grams;
    drag = { startY: event.clientY, startG, update: openScale(event.clientX, event.clientY, startG) };
    vibrate();
  };
  target.onpointermove = (event) => {
    if (event.pointerId !== pointerId || !drag) return;
    event.preventDefault();
    const steps = Math.round((drag.startY - event.clientY) / PX_PER_STEP);
    const minG = Math.max(0, drag.startG - RANGE_G);
    const grams = Math.min(drag.startG + RANGE_G, Math.max(minG, drag.startG + steps * STEP_G));
    if (grams === weight.grams) return;
    weight.grams = grams;
    drag.update(grams);
    show();
    vibrate();
  };
  target.onpointerup = (event) => {
    if (event.pointerId === pointerId) finish();
  };
  target.onpointercancel = (event) => {
    if (event.pointerId === pointerId) finish();
  };
  target.oncontextmenu = (event) => event.preventDefault();
}

function openScale(x: number, y: number, startG: number): (grams: number) => void {
  closeScale();
  const minG = Math.max(0, startG - RANGE_G);
  const maxG = startG + RANGE_G;
  const top = (grams: number) => y - ((grams - startG) / STEP_G) * PX_PER_STEP;
  const scale = document.body.createDiv({ cls: "gym-scale" });
  if (x < 140) scale.addClass("gym-scale-right");
  scale.style.left = `${x}px`;
  const panel = scale.createDiv({ cls: "gym-scale-panel" });
  const panelTop = Math.max(8, top(maxG) - 16);
  panel.style.top = `${panelTop}px`;
  panel.style.height = `${Math.min(window.innerHeight - 8, top(minG) + 16) - panelTop}px`;
  const track = scale.createDiv({ cls: "gym-scale-track" });
  track.style.top = `${top(maxG)}px`;
  track.style.height = `${top(minG) - top(maxG)}px`;
  for (let grams = Math.ceil(minG / LABEL_EVERY_G) * LABEL_EVERY_G; grams <= maxG; grams += LABEL_EVERY_G) {
    const tick = scale.createDiv({ cls: "gym-scale-tick", text: formatKg(grams) });
    tick.style.top = `${top(grams)}px`;
  }
  const bubble = scale.createDiv({ cls: "gym-scale-bubble" });
  current = scale;
  const update = (grams: number) => {
    bubble.style.top = `${top(grams)}px`;
    bubble.setText(formatKg(grams));
  };
  update(startG);
  return update;
}

function vibrate(): void {
  if (typeof navigator.vibrate === "function") navigator.vibrate(8);
}
