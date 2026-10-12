/** Demo panel sizing; the chart's ResizeObserver handles canvas resizing. */
export function createWorkspaceSplit(workspace: HTMLElement, divider: HTMLElement): () => void {
  const storageKey = 'liquidchart.workspace.chatWidth';
  const desktop = window.matchMedia('(min-width: 681px)');
  const listeners = new AbortController();
  let width = window.innerWidth > 1000 ? 320 : 280;
  try {
    const stored = localStorage.getItem(storageKey);
    const value = stored === null ? NaN : Number(stored);
    if (Number.isFinite(value) && value >= 240 && value <= 10_000) width = value;
  } catch { /* sizing works without storage */ }
  let gesture: { id: number; x: number; width: number } | undefined;
  let pending: number | undefined;
  let frame = 0;
  const bounds = () => ({ min: 240, max: Math.max(240, workspace.clientWidth - 6 - 320) });
  function apply(value: number) {
    if (!desktop.matches) return;
    const { min, max } = bounds();
    width = Math.min(max, Math.max(min, value));
    workspace.style.setProperty('--chat-width', `${width}px`);
    divider.setAttribute('aria-valuemin', String(min));
    divider.setAttribute('aria-valuemax', String(Math.round(max)));
    divider.setAttribute('aria-valuenow', String(Math.round(width)));
    divider.setAttribute('aria-valuetext', `Chat width ${Math.round(width)} pixels`);
  }
  function remember() {
    try { localStorage.setItem(storageKey, String(width)); } catch { /* keep the session preference */ }
  }
  function flush() {
    cancelAnimationFrame(frame); frame = 0;
    if (pending !== undefined) { apply(pending); pending = undefined; }
  }
  function finish(cancelled = false) {
    if (!gesture) return;
    const old = gesture; gesture = undefined;
    flush();
    if (cancelled) apply(old.width); else remember();
    workspace.classList.remove('is-resizing');
    if (divider.hasPointerCapture(old.id)) divider.releasePointerCapture(old.id);
  }
  divider.addEventListener('pointerdown', event => {
    if (!desktop.matches || event.button !== 0 || gesture) return;
    event.preventDefault();
    divider.focus();
    gesture = { id: event.pointerId, x: event.clientX, width };
    divider.setPointerCapture(event.pointerId);
    workspace.classList.add('is-resizing');
  }, { signal: listeners.signal });
  divider.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    pending = gesture.width + event.clientX - gesture.x;
    if (!frame) frame = requestAnimationFrame(flush);
  }, { signal: listeners.signal });
  divider.addEventListener('pointerup', event => {
    if (event.pointerId === gesture?.id) {
      pending = gesture.width + event.clientX - gesture.x;
      finish();
    }
  }, { signal: listeners.signal });
  for (const event of ['pointercancel', 'lostpointercapture'] as const) {
    divider.addEventListener(event, () => finish(true), { signal: listeners.signal });
  }
  divider.addEventListener('keydown', event => {
    if (!desktop.matches) return;
    if (event.key === 'Escape' && gesture) { event.preventDefault(); finish(true); return; }
    if (gesture) return;
    const { min, max } = bounds();
    const step = event.shiftKey ? 48 : 16;
    const target = event.key === 'ArrowLeft' ? width - step : event.key === 'ArrowRight' ? width + step
      : event.key === 'Home' ? min : event.key === 'End' ? max : undefined;
    if (target === undefined) return;
    event.preventDefault(); apply(target); remember();
  }, { signal: listeners.signal });
  divider.addEventListener('dblclick', () => {
    finish(true); apply(window.innerWidth > 1000 ? 320 : 280); remember();
  }, { signal: listeners.signal });
  window.addEventListener('blur', () => finish(true), { signal: listeners.signal });
  window.addEventListener('pagehide', () => finish(true), { signal: listeners.signal });
  const observer = new ResizeObserver(() => {
    if (gesture) finish(true);
    apply(width);
  });
  observer.observe(workspace);
  apply(width);
  return () => { finish(true); listeners.abort(); observer.disconnect(); cancelAnimationFrame(frame); };
}
