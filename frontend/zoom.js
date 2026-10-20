const levels = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
export function normalizeZoom(value) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return 1;
  return levels.reduce((nearest, candidate) => Math.abs(candidate - Number(value)) < Math.abs(nearest - Number(value)) ? candidate : nearest);
}
export function nextZoom(value, direction) {
  return levels[Math.max(0, Math.min(levels.length - 1, levels.indexOf(normalizeZoom(value)) + Math.sign(direction)))];
}
export function initZoom({ documentRef = document, windowRef = window, initial = 1, save = async () => {}, onError = () => {} } = {}) {
  const out = documentRef.getElementById("zoom-out"), label = documentRef.getElementById("zoom-level"), into = documentRef.getElementById("zoom-in");
  let current = normalizeZoom(initial), queue = Promise.resolve();
  function paint() {
    // Viewport units already account for page zoom; keep the shell at 100vh.
    documentRef.documentElement.style.zoom = String(current);
    label.textContent = `${Math.round(current * 100)}%`;
    label.setAttribute("aria-label", `Reset zoom to 100%; current zoom ${Math.round(current * 100)}%`);
    out.disabled = current === levels[0]; into.disabled = current === levels.at(-1);
  }
  function apply(value) {
    current = normalizeZoom(value); paint();
    const snapshot = current;
    queue = queue.then(() => save(snapshot)).catch(onError);
  }
  paint();
  out.addEventListener("click", () => apply(nextZoom(current, -1)));
  into.addEventListener("click", () => apply(nextZoom(current, 1)));
  label.addEventListener("click", () => apply(1));
  windowRef.addEventListener("keydown", event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (["+", "=", "Add", "-", "_", "Subtract", "0"].includes(event.key)) {
      event.preventDefault();
      apply(event.key === "0" ? 1 : nextZoom(current, ["-", "_", "Subtract"].includes(event.key) ? -1 : 1));
    }
  });
  windowRef.addEventListener("wheel", event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || !event.deltaY) return;
    event.preventDefault(); apply(nextZoom(current, event.deltaY < 0 ? 1 : -1));
  }, { passive: false });
}
