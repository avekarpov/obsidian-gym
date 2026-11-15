export function horizontalScroll(parent: HTMLElement): HTMLElement {
  const wrapper = parent.createDiv({ cls: "gym-scroll" });
  const keepTouch = (event: TouchEvent) => {
    if (wrapper.scrollWidth > wrapper.clientWidth) event.stopPropagation();
  };
  wrapper.addEventListener("touchstart", keepTouch, { passive: true });
  wrapper.addEventListener("touchmove", keepTouch, { passive: true });
  return wrapper;
}
