const native = () => window.go?.main?.App;
let smokeStarted = false;

async function request(path, body = {}) {
  const response = await fetch(`/api/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The request failed.");
  return result;
}

export const bridge = {
  initialize: () => native() ? native().Initialize() : request("demo").then(document => ({ document, preferences: {}, canRemember: false })),
  demo: () => native() ? native().LoadDemo() : request("demo"),
  remember: enabled => native().SetRemember(enabled),
  select: (generation, id) => native()?.SelectRule(generation, id),
  zoom: value => native() ? native().SetZoom(value) : Promise.resolve(),
  buildInfo: () => native()?.BuildInfo(),
  checkUpdate: () => native()?.CheckUpdate(),
  dismissUpdate: version => native()?.DismissUpdate(version),
  openRelease: url => native()?.OpenRelease(url),
  isDesktop: () => Boolean(native()),
  search: (query) => native() ? native().Search(query) : request("search", query),
  rule: (id) => native() ? native().GetRule(id) : request("rule", { id }),
  segments: query => native() ? native().Segments(query) : request("segments", query),
  ranges: query => native() ? native().Ranges(query) : request("ranges", query),
  open: () => native().OpenPolicy(),
  import: (name, text) => native() ? native().ImportXML(name, text) : request("import", { name, text }),
  copy: (text) => native() ? native().CopyText(text) : navigator.clipboard.writeText(text),
  ready: async restoreDemo => {
    const app = native();
    if (!app) return;
    if (await app.SmokeMode()) {
      if (smokeStarted) return;
      smokeStarted = true;
      try {
        const { verifyDetails, verifyZoom } = await import("./smoke.js");
        const { verifyWorkflow } = await import("./workflow-smoke.js");
        await verifyDetails();
        await verifyWorkflow(restoreDemo);
        await verifyZoom(() => app.GetZoom());
      } catch (cause) {
        await app.SmokeFailed(cause?.message || String(cause));
        return;
      }
    }
    app.Ready();
  },
};
