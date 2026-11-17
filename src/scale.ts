const RANGE_G = 20000;
const STEP_G = 500;
const PX_PER_STEP = 8;

export interface DragHooks {
  onStart(): void;
  onEnd(): void;
}

export function bindWeightDrag(target: HTMLElement, weight: { grams: number }, show: () => void, hooks: DragHooks): void {
  let pointerId: number | null = null;
  let drag: { startY: number; startG: number } | null = null;

  const finish = () => {
    drag = null;
    pointerId = null;
    target.removeClass("is-dragging");
    hooks.onEnd();
  };

  target.addClass("gym-draggable");
  target.onpointerdown = (event) => {
    if (pointerId !== null) return;
    event.preventDefault();
    pointerId = event.pointerId;
    target.setPointerCapture(event.pointerId);
    target.addClass("is-dragging");
    hooks.onStart();
    drag = { startY: event.clientY, startG: weight.grams };
  };
  target.onpointermove = (event) => {
    if (event.pointerId !== pointerId || !drag) return;
    event.preventDefault();
    const steps = Math.round((drag.startY - event.clientY) / PX_PER_STEP);
    const minG = Math.max(0, drag.startG - RANGE_G);
    const grams = Math.min(drag.startG + RANGE_G, Math.max(minG, drag.startG + steps * STEP_G));
    if (grams === weight.grams) return;
    weight.grams = grams;
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

function vibrate(): void {
  if (typeof navigator.vibrate === "function") navigator.vibrate(8);
}
