// installer/src/ui/renderer.js
//
// Vanilla wizard + manager controller. Talks to the main process exclusively through
// window.jroute (exposed by preload.js).
const api = window.jroute;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  step: "welcome",
  order: ["welcome", "location", "portpass", "version", "data", "installing", "done"],
};

function showStep(step) {
  state.step = step;
  $$(".panel").forEach((p) => p.classList.toggle("hidden", p.dataset.step !== step));
  $$("#steps li").forEach((li) => {
    const idx = state.order.indexOf(li.dataset.step);
    const cur = state.order.indexOf(step);
    li.classList.toggle("active", li.dataset.step === step);
    li.classList.toggle("done", idx < cur);
  });
}

function showView(view) {
  $("#wizard").classList.toggle("hidden", view !== "wizard");
  $("#manager").classList.toggle("hidden", view !== "manager");
}

function appendLog(text) {
  const el = $("#installLog");
  if (!el) return;
  el.textContent += text.endsWith("\n") ? text : text + "\n";
  el.scrollTop = el.scrollHeight;
}

function appendMgrLog(text) {
  const el = $("#mgrLog");
  if (!el) return;
  el.classList.remove("hidden");
  el.textContent += text.endsWith("\n") ? text : text + "\n";
  el.scrollTop = el.scrollHeight;
}

async function init() {
  // Register the event-style IPC listeners exactly once so retries/clicks don't
  // stack duplicate handlers (ipcRenderer.on accumulates across calls).
  registerIpcListeners();

  const def = await api.getOsDefaults();

  // Prefill sensible defaults.
  $("#installDir").value = def.defaultInstallDir;
  $("#dataDir").value = def.defaultDataDir;
  $("#port").value = def.defaultPort;

  if (def.initialView === "manager" && def.config) {
    showView("manager");
    renderManager(def.config, { running: false });
    return;
  }
  showView("wizard");
  showStep("welcome");
}

// ---- Event-style IPC listeners (registered ONCE in init) ----
function registerIpcListeners() {
  api.onInstallLog(({ msg }) => appendLog(msg));
  api.onInstallDone(({ ok, error, port }) => {
    if (ok) {
      $("#doneUrl").textContent = `http://localhost:${port || currentPort()}/`;
      showStep("done");
    } else {
      appendLog("\n✗ Installation failed: " + error);
      alert("Installation failed:\n" + error);
      showStep("data");
    }
  });
  api.onUpdateLog(({ msg }) => appendMgrLog(msg));
  api.onUpdateDone(({ ok, error }) => {
    $("#updateProgress").classList.add("hidden");
    if (!ok) appendMgrLog("\n✗ Update failed: " + error);
    else appendMgrLog("\n✓ Update complete.");
    refreshManager();
  });
}

// ---- Wizard navigation ----
$$("[data-next]").forEach((btn) => btn.addEventListener("click", () => next()));
$$("[data-prev]").forEach((btn) => btn.addEventListener("click", () => prev()));

function next() {
  const i = state.order.indexOf(state.step);
  if (i < state.order.length - 1) showStep(state.order[i + 1]);
}
function prev() {
  const i = state.order.indexOf(state.step);
  if (i > 0) showStep(state.order[i - 1]);
}

$("#checkPort").addEventListener("click", async () => {
  const requested = Number($("#port").value);
  const res = await api.checkPort(requested);
  // Persist the actually-usable port so the config + done URL reflect reality.
  if (Number(res.port) !== requested) $("#port").value = res.port;
  $("#portHint").textContent =
    res.port === Number($("#port").value)
      ? "Port is available."
      : `In use — will use ${res.port} instead.`;
});

// Directory pickers (best-effort via hidden input).
function pickDir(inputId) {
  const input = document.createElement("input");
  input.type = "file";
  input.webkitdirectory = true;
  input.addEventListener("change", () => {
    if (input.files && input.files[0]) $("#" + inputId).value = input.files[0].path;
  });
  input.click();
}
$("#pickInstall").addEventListener("click", () => pickDir("installDir"));
$("#pickData").addEventListener("click", () => pickDir("dataDir"));

// ---- Run install ----
//
// NOTE: the install/update IPC listeners are registered ONCE in init()
// (registerIpcListeners). Re-registering them here on every click would stack
// handlers and double-fire on retry. Just kick off the install.
$("#beginInstall").addEventListener("click", async () => {
  showStep("installing");
  $("#installLog").textContent = "";

  const config = {
    installDir: $("#installDir").value.trim(),
    dataDir: $("#dataDir").value.trim(),
    port: Number($("#port").value),
    channel: $("#channel").value,
    explicitRef: $("#explicitRef").value.trim() || undefined,
    adminPassword: $("#adminPassword").value || undefined,
    autoStart: $("#scAutoStart").checked,
    shortcuts: $("#scDesktop").checked || $("#scStartMenu").checked,
  };
  await api.runInstall(config);
});

function currentPort() {
  return Number($("#port").value) || 20128;
}

$("#openDashboard").addEventListener("click", () => api.openDashboard());
// The install log lives in the wizard's "installing" panel. Reveal it here
// (the manager's #mgrLog is in a hidden view and wouldn't be visible).
$("#doneLogs").addEventListener("click", () => {
  showStep("installing");
});

// ---- Manager ----
function renderManager(cfg, status) {
  $("#mStatus").textContent = status.running ? "Running" : "Stopped";
  $("#mUrl").textContent = `http://localhost:${cfg.port}/`;
  $("#mUrl").href = `http://localhost:${cfg.port}/`;
  $("#mChannel").textContent = cfg.channel;
  $("#mRef").textContent = cfg.ref;
  $("#mInstalled").textContent = cfg.installedAt
    ? new Date(cfg.installedAt).toLocaleString()
    : "—";
  $("#statusPill").textContent = status.running ? "Running" : "Stopped";
  $("#statusPill").className = "pill " + (status.running ? "on" : "off");
  $("#mToggle").textContent = status.running ? "Stop" : "Start";
}

async function refreshManager() {
  const status = await api.getStatus();
  renderManager(status, status);
}

$("#mOpen").addEventListener("click", () => api.openDashboard());
$("#mToggle").addEventListener("click", async () => {
  const s = await api.getStatus();
  if (s.running) await api.stop();
  else await api.start();
  await refreshManager();
});
$("#mLogs").addEventListener("click", async () => {
  const logs = await api.getLogs();
  $("#mgrLog").classList.remove("hidden");
  $("#mgrLog").textContent = logs;
});
$("#mReset").addEventListener("click", async () => {
  if (!confirm("Reset JRoute? This stops the server and forgets the install " +
    "(your data directory is kept). You can re-run the wizard afterwards.")) return;
  await api.resetInstall();
  location.reload();
});
// The update IPC listeners are registered ONCE in registerIpcListeners().
// Here we only reset the UI and kick off the update.
$("#mUpdate").addEventListener("click", async () => {
  $("#updateProgress").classList.remove("hidden");
  $("#mgrLog").classList.remove("hidden");
  $("#mgrLog").textContent = "";
  await api.update();
});

init();
