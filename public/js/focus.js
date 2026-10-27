"use strict";

(() => {
  const element = (id) => document.getElementById(id);
  const state = { mode: "pomodoro", session: null, clockOffset: 0, historyDays: 7, busy: false, finishing: false, nextFinishRetry: 0, breakUntil: null, breakDuration: 300 };
  const clock = element("focusTimer");
  const format = window.PatternFocus.prettySeconds;
  const formatTotal = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return hours ? `${hours}h ${String(minutes % 60).padStart(2, "0")}min` : `${minutes} min`;
  };
  const safe = (value = "") => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const failed = (error) => {
    element("focusError").textContent = error.message || "Não foi possível concluir a ação.";
    element("focusError").hidden = false;
  };
  const clearError = () => { element("focusError").hidden = true; };
  const readSession = (data) => {
    state.session = data.session;
    state.clockOffset = Date.parse(data.serverNow) - Date.now();
    if (state.session) state.mode = state.session.mode;
    updateControls();
    updateClock();
  };
  const currentSeconds = () => state.session ? window.PatternFocus.effectiveSeconds(state.session, new Date(Date.now() + state.clockOffset).toISOString()) : 0;
  const updateClock = () => {
    const session = state.session;
    const duration = Number(element("focusDuration").value) || 25;
    const seconds = session ? currentSeconds() : 0;
    const planned = session ? session.plannedSeconds : duration * 60;
    const remaining = Math.max(0, planned - seconds);
    clock.textContent = state.mode === "pomodoro" ? format(remaining) : format(seconds);
    element("focusTimerLabel").textContent = state.mode === "pomodoro" ? "TEMPO RESTANTE" : "TEMPO DECORRIDO";
    const progress = state.mode === "pomodoro" ? (session ? seconds / planned : 0) : Math.min(1, seconds / 3600);
    element("focusDial").style.setProperty("--focus-percent", `${Math.max(0, Math.min(100, progress * 100))}%`);
    if (session && session.status === "running" && session.mode === "pomodoro" && remaining <= 0 && !state.finishing && Date.now() >= state.nextFinishRetry) {
      finishSession(true);
    }
    if (state.breakUntil) {
      const secondsLeft = Math.max(0, Math.ceil((state.breakUntil - Date.now()) / 1000));
      element("focusBreakTime").textContent = format(secondsLeft);
      if (secondsLeft === 0) {
        state.breakUntil = null;
        element("focusBreakStart").hidden = false;
        element("focusBreakStart").textContent = "Recomeçar intervalo";
        toast("Intervalo concluído. Você pode iniciar outro foco.");
      }
    }
  };
  const show = (id, visible) => { element(id).hidden = !visible; };
  const updateControls = () => {
    const session = state.session;
    const active = !!session;
    document.querySelectorAll("[data-focus-mode]").forEach(button => {
      const selected = button.dataset.focusMode === state.mode;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
      button.disabled = active || state.busy;
    });
    show("focusDurationWrap", state.mode === "pomodoro");
    element("focusDuration").disabled = active || state.busy;
    element("focusTask").disabled = active || state.busy;
    document.querySelectorAll("[data-focus-minutes]").forEach(button => { button.disabled = active || state.busy; });
    show("focusStart", !active);
    show("focusPause", active && session.status === "running");
    show("focusResume", active && session.status === "paused");
    show("focusFinish", active);
    ["focusStart", "focusPause", "focusResume", "focusFinish"].forEach(id => element(id).disabled = state.busy);
    element("focusStatus").textContent = !active ? "Pronta para começar" : session.status === "running" ? "Sessão em andamento" : "Sessão pausada";
    element("focusCurrentTask").textContent = active ? (session.taskTitle || "Sessão de foco livre") : "Escolha uma tarefa ou comece livremente.";
    document.querySelectorAll("[data-focus-minutes]").forEach(button => {
      const selected = Number(button.dataset.focusMinutes) === Number(element("focusDuration").value);
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  };
  const call = async (operation, body = undefined) => {
    clearError();
    state.busy = true;
    updateControls();
    try {
      const response = await api(operation, { method: "POST", ...(body === undefined ? { body: {} } : { body }) });
      readSession(response);
      return response;
    } catch (error) {
      failed(error);
      if (error.message?.includes("sessão") || error.message?.includes("Sessão")) {
        try { readSession(await api("/api/focus/active")); } catch (_) {}
      }
      return null;
    } finally {
      state.busy = false;
      updateControls();
    }
  };
  const loadHistory = async () => {
    try {
      const data = await api(`/api/focus/history?days=${state.historyDays}`);
      element("focusTotal").textContent = formatTotal(data.summary.seconds);
      element("focusSessions").textContent = String(data.summary.sessions);
      element("focusDays").textContent = String(data.summary.activeDays);
      const largest = Math.max(1, ...data.days.map(day => day.seconds));
      element("focusBars").innerHTML = data.days.map(day => {
        const height = Math.max(day.seconds ? 8 : 3, Math.round(day.seconds * 100 / largest));
        const dayDate = new Date(`${day.date}T12:00:00`);
        const title = `${dayDate.toLocaleDateString("pt-BR")}: ${formatTotal(day.seconds)}`;
        return `<div class="focus-bar-col" title="${safe(title)}"><span>${day.seconds ? Math.round(day.seconds / 60) : ""}</span><div class="focus-bar-track"><div class="focus-bar" style="height:${height}%"></div></div><span>${dayDate.getDate()}</span></div>`;
      }).join("");
      element("focusHistory").innerHTML = data.sessions.length ? data.sessions.map(session => {
        const date = new Date(session.finishedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
        const name = session.taskTitle || "Foco sem tarefa";
        const label = session.mode === "pomodoro" ? "Pomodoro" : "Cronômetro livre";
        return `<div class="focus-history-row"><div class="focus-history-symbol">✳</div><div class="focus-history-detail"><strong>${safe(name)}</strong><span>${safe(date)} · ${label}</span></div><strong class="focus-history-duration">${formatTotal(session.elapsedSeconds)}</strong></div>`;
      }).join("") : `<div class="empty"><strong>Seu histórico começa aqui</strong>Inicie uma sessão e registre seu primeiro momento de foco.</div>`;
    } catch (error) {
      element("focusHistory").textContent = "Não foi possível carregar o histórico.";
      failed(error);
    }
  };
  const start = async () => {
    const duration = Number(element("focusDuration").value);
    if (state.mode === "pomodoro" && (!Number.isInteger(duration) || duration < 5 || duration > 180)) {
      failed(new Error("Escolha uma duração entre 5 e 180 minutos."));
      return;
    }
    state.breakUntil = null;
    show("focusBreakPanel", false);
    const response = await call("/api/focus/start", { mode: state.mode, durationMinutes: state.mode === "pomodoro" ? duration : null, taskId: element("focusTask").value || null });
    if (response) toast("Sessão de foco iniciada.");
  };
  const finishSession = async (automatic = false) => {
    const session = state.session;
    if (!session || state.finishing) return;
    state.finishing = true;
    const duration = session.plannedSeconds;
    const response = await call(`/api/focus/${session.id}/finish`);
    state.finishing = false;
    if (!response) state.nextFinishRetry = Date.now() + 15000;
    if (response) {
      state.nextFinishRetry = 0;
      state.session = null;
      updateControls();
      updateClock();
      if (automatic && session.mode === "pomodoro") {
        state.breakDuration = duration >= 3000 ? 600 : 300;
        element("focusBreakTime").textContent = format(state.breakDuration);
        element("focusBreakStart").hidden = false;
        element("focusBreakStart").textContent = "Começar intervalo";
        show("focusBreakPanel", true);
      }
      toast(automatic ? "Pomodoro concluído! Hora de descansar." : "Sessão salva no histórico.");
      await loadHistory();
    }
  };
  document.querySelectorAll("[data-focus-mode]").forEach(button => button.addEventListener("click", () => {
    if (state.session) return;
    state.mode = button.dataset.focusMode;
    updateControls();
    updateClock();
  }));
  document.querySelectorAll("[data-focus-minutes]").forEach(button => button.addEventListener("click", () => {
    element("focusDuration").value = button.dataset.focusMinutes;
    updateControls();
    updateClock();
  }));
  element("focusDuration").addEventListener("input", () => { updateControls(); updateClock(); });
  element("focusStart").addEventListener("click", start);
  element("focusPause").addEventListener("click", async () => { if (state.session) await call(`/api/focus/${state.session.id}/pause`); });
  element("focusResume").addEventListener("click", async () => { if (state.session) await call(`/api/focus/${state.session.id}/resume`); });
  element("focusFinish").addEventListener("click", () => finishSession(false));
  element("focusRange").addEventListener("change", () => { state.historyDays = Number(element("focusRange").value); loadHistory(); });
  element("focusBreakStart").addEventListener("click", () => {
    state.breakUntil = Date.now() + state.breakDuration * 1000;
    element("focusBreakStart").hidden = true;
    updateClock();
  });
  element("focusBreakSkip").addEventListener("click", () => {
    state.breakUntil = null;
    element("focusBreakStart").hidden = false;
    show("focusBreakPanel", false);
  });
  const refresh = async () => {
    try {
      const before = state.session;
      readSession(await api("/api/focus/active"));
      if (before && !state.session) {
        if (before.mode === "pomodoro") {
          state.breakDuration = before.plannedSeconds >= 3000 ? 600 : 300;
          element("focusBreakTime").textContent = format(state.breakDuration);
          element("focusBreakStart").hidden = false;
          show("focusBreakPanel", true);
        }
        await loadHistory();
      }
    } catch (error) { failed(error); }
  };
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.session) refresh(); });
  window.addEventListener("pageshow", (event) => { if (event.persisted) refresh(); });
  setInterval(updateClock, 500);
  Promise.all([api("/api/tasks?list=1"), api("/api/focus/active")]).then(([tasks, current]) => {
    const byId = new Map();
    tasks.forEach(task => {
      if (task.completed) return;
      const id = task.seriesId || task.id;
      if (!byId.has(id)) byId.set(id, task.title);
    });
    const items = [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
    element("focusTask").innerHTML = '<option value="">Sem tarefa vinculada</option>' + items.map(([id, name]) => `<option value="${safe(id)}">${safe(name)}</option>`).join("");
    readSession(current);
  }).catch(failed);
  loadHistory();
  updateControls();
  updateClock();
})();
