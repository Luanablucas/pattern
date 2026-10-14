"use strict";

const page = document.body.dataset.page;
const state = {
  tasks: [],
  habits: [],
  entries: [],
  events: [],
  filter: "all",
  weekOffset: 0,
};
const $ = (selector) => document.querySelector(selector);
const escapeHTML = (value = "") =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const todayISO = () => localISO(new Date());
function localISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fromISO(s) {
  return new Date(`${s}T12:00:00`);
}
function shortDate(s) {
  return s
    ? fromISO(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
    : "Sem prazo";
}
function empty(title, text) {
  return `<div class="empty"><strong>${escapeHTML(title)}</strong>${escapeHTML(text)}</div>`;
}
let toastTimer;
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("visible"), 3200);
}
async function api(url, { method = "GET", body } = {}) {
  const response = await fetch(url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 401) {
    window.location.assign("/login");
    throw new Error("Sua sessão terminou.");
  }
  let data;
  try {
    data = await response.json();
  } catch (_) {
    throw new Error("Resposta inesperada do servidor.");
  }
  if (!response.ok) throw new Error(data.error || "Algo deu errado.");
  return data;
}
function showError(error) {
  console.error(error);
  toast(error.message || "Não foi possível concluir a ação.");
}
function badgePriority(p) {
  const names = { low: "Baixa", medium: "Média", high: "Alta" };
  return `<span class="priority priority-${p}">${names[p] || "Média"}</span>`;
}
function taskRow(task, { compact = false } = {}) {
  const overdue = !task.completed && task.dueDate && task.dueDate < todayISO();
  const meta = `${task.dueDate ? shortDate(task.dueDate) : "Sem prazo"}${overdue ? " · Atrasada" : ""}`;
  return `<div class="item-row" data-id="${task.id}">
    <input class="check" type="checkbox" data-task-toggle="${task.id}" aria-label="Marcar ${escapeHTML(task.title)} como concluída" ${task.completed ? "checked" : ""}>
    <div class="item-info"><div class="item-title ${task.completed ? "done" : ""}">${escapeHTML(task.title)}</div><div class="item-meta">${escapeHTML(meta)}</div></div>
    ${badgePriority(task.priority)}
    ${compact ? "" : `<div class="row-actions"><button class="mini-button" type="button" data-task-edit="${task.id}" aria-label="Editar tarefa">✎</button><button class="mini-button" type="button" data-task-delete="${task.id}" aria-label="Excluir tarefa">×</button></div>`}
  </div>`;
}
function renderDashboard() {
  const pending = state.tasks.filter((x) => !x.completed);
  const completed = state.tasks.filter((x) => x.completed).length;
  const doneToday = state.entries.filter((x) => x.date === todayISO()).length;
  const stats = [
    {
      label: "Tarefas pendentes",
      number: pending.length,
      caption: "Para organizar no seu tempo",
      icon: "☑",
    },
    {
      label: "Tarefas concluídas",
      number: completed,
      caption: "Desde que você começou",
      icon: "✦",
    },
    {
      label: "Hábitos de hoje",
      number: `${doneToday}/${state.habits.length}`,
      caption: "Um dia de cada vez",
      icon: "◷",
    },
  ];
  $("#dashboardStats").innerHTML = stats
    .map(
      (s) =>
        `<article class="stat-card"><div class="stat-label">${s.label}<span class="stat-icon">${s.icon}</span></div><div class="stat-number">${s.number}</div><div class="stat-caption">${s.caption}</div></article>`,
    )
    .join("");
  $("#homeTasks").innerHTML = pending.length
    ? pending
        .slice(0, 5)
        .map((x) => taskRow(x, { compact: true }))
        .join("")
    : empty("Tudo em dia por aqui ✦", "Adicione uma tarefa para começar.");
  $("#homeHabits").innerHTML = state.habits.length
    ? state.habits
        .slice(0, 6)
        .map((h) => {
          const checked = state.entries.some(
            (e) => e.habitId === h.id && e.date === todayISO(),
          );
          return `<div class="item-row"><input class="check" type="checkbox" data-habit-check="${h.id}" data-date="${todayISO()}" aria-label="Marcar ${escapeHTML(h.name)}" ${checked ? "checked" : ""}><div class="item-info"><div class="item-title ${checked ? "done" : ""}">${escapeHTML(h.name)}</div><div class="item-meta">${checked ? "Feito hoje. Boa!" : "Ainda dá tempo ✧"}</div></div></div>`;
        })
        .join("")
    : empty("Sua rotina, suas regras", "Crie seu primeiro hábito.");
}
function renderTasks() {
  const filtered = state.tasks.filter(
    (x) =>
      state.filter === "all" ||
      (state.filter === "pending" ? !x.completed : x.completed),
  );
  $("#tasksCount").textContent =
    `${filtered.length} ${filtered.length === 1 ? "tarefa" : "tarefas"}`;
  $("#taskList").innerHTML = filtered.length
    ? filtered.map((t) => taskRow(t)).join("")
    : empty(
        "Nada por aqui",
        "Sua lista está pronta para receber novas ideias.",
      );
  document
    .querySelectorAll("[data-filter]")
    .forEach((tab) =>
      tab.classList.toggle("active", tab.dataset.filter === state.filter),
    );
}
function renderHabits() {
  const container = $("#habitList");
  if (!state.habits.length) {
    container.innerHTML = empty(
      "Comece com algo pequeno",
      "Crie um hábito que faça sentido para você.",
    );
    return;
  }
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - 6 + i);
    return localISO(d);
  });
  container.innerHTML = state.habits
    .map((h) => {
      const checkedDates = new Set(
        state.entries.filter((e) => e.habitId === h.id).map((e) => e.date),
      );
      const completed = dates.filter((d) => checkedDates.has(d)).length;
      const controls = dates
        .map((date) => {
          const checked = checkedDates.has(date);
          const short = fromISO(date)
            .toLocaleDateString("pt-BR", { weekday: "short" })
            .replace(".", "")
            .slice(0, 3);
          return `<div class="habit-day"><span>${escapeHTML(short)}</span><button class="${checked ? "checked" : ""}" type="button" data-habit-check="${h.id}" data-date="${date}" aria-pressed="${checked}" aria-label="${checked ? "Desmarcar" : "Marcar"} ${escapeHTML(h.name)} em ${date}">${checked ? "✓" : "·"}</button></div>`;
        })
        .join("");
      return `<article class="habit-row"><div><div class="habit-name">${escapeHTML(h.name)}</div><div class="habit-description">${completed} de 7 dias nesta semana</div></div><div class="habit-week">${controls}</div><button class="mini-button" data-habit-delete="${h.id}" aria-label="Excluir hábito">×</button></article>`;
    })
    .join("");
}
function renderCalendar() {
  const monday = new Date();
  monday.setHours(12, 0, 0, 0);
  monday.setDate(
    monday.getDate() - ((monday.getDay() + 6) % 7) + state.weekOffset * 7,
  );
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const fmt = (d) =>
    d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
  $("#calendarTitle").textContent = `${fmt(monday)} — ${fmt(sunday)}`;
  let markup = "";
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    const date = localISO(d);
    const scheduled = state.tasks.filter((t) => t.dueDate === date);
    const appts = state.events.filter(
      (e) => localISO(new Date(e.startsAt)) === date,
    );
    const cards = scheduled
      .map(
        (t) =>
          `<div class="cal-event" title="Tarefa">${t.completed ? "✓ " : ""}${escapeHTML(t.title)}</div>`,
      )
      .join("");
    const eventCards = appts
      .map(
        (e) =>
          `<div class="cal-event appointment"><small>${new Date(e.startsAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</small>${escapeHTML(e.title)}<button class="cal-remove" data-event-delete="${e.id}" aria-label="Excluir compromisso">×</button></div>`,
      )
      .join("");
    markup += `<div class="calendar-day ${date === todayISO() ? "today" : ""}"><div class="calendar-day-title">${d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")}</div><div class="calendar-day-num">${d.getDate()}</div>${cards}${eventCards}</div>`;
  }
  $("#calendarGrid").innerHTML = markup;
}
function renderInsights(data) {
  const max = Math.max(1, ...data.days.map((x) => x.completed));
  $("#insightsChart").innerHTML = data.days
    .map((entry) => {
      const day = fromISO(entry.date);
      return `<div class="bar-item" title="${escapeHTML(day.toLocaleDateString("pt-BR"))}: ${entry.completed} concluída(s)"><span class="bar-value">${entry.completed || ""}</span><div class="bar" style="height:${Math.max(3, (entry.completed / max) * 185)}px"></div><span class="bar-label">${day.getDate()}</span></div>`;
    })
    .join("");
  if (data.pythonOnline && data.analysis) {
    $("#analysisContent").textContent = data.analysis.insight;
    $("#insightsStatus").textContent = data.analysis.method;
  } else {
    const total = data.days.reduce((acc, x) => acc + x.completed, 0);
    $("#analysisContent").textContent =
      `Você concluiu ${total} tarefa(s) nos últimos 14 dias. Inicie o serviço Python para ativar a análise complementar.`;
    $("#insightsStatus").textContent =
      "Modo básico: o serviço Python não está conectado.";
  }
}
async function refreshTasks() {
  state.tasks = await api("/api/tasks");
  if (page === "tasks") renderTasks();
  if (page === "app") renderDashboard();
  if (page === "calendar") renderCalendar();
}
async function refreshHabits() {
  const data = await api("/api/habits");
  state.habits = data.habits;
  state.entries = data.entries;
  if (page === "habits") renderHabits();
  if (page === "app") renderDashboard();
}
function openTask(task = null) {
  const dialog = $("#taskDialog");
  const form = $("#taskForm");
  form.reset();
  form.elements.id.value = task?.id || "";
  form.elements.title.value = task?.title || "";
  form.elements.notes.value = task?.notes || "";
  form.elements.dueDate.value = task?.dueDate || "";
  form.elements.priority.value = task?.priority || "medium";
  $("#taskDialogTitle").textContent = task ? "Editar tarefa" : "Nova tarefa";
  $("#taskError").hidden = true;
  dialog.showModal();
  form.elements.title.focus();
}
function localDateTimeInput(date) {
  const d = new Date(date);
  return `${localISO(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function openEvent() {
  const form = $("#eventForm");
  form.reset();
  $("#eventError").hidden = true;
  const starts = new Date();
  starts.setMinutes(0, 0, 0);
  starts.setHours(starts.getHours() + 1);
  const ends = new Date(starts);
  ends.setHours(ends.getHours() + 1);
  form.elements.startsAt.value = localDateTimeInput(starts);
  form.elements.endsAt.value = localDateTimeInput(ends);
  $("#eventDialog").showModal();
}


document.addEventListener("click", async (e) => {
  const target = e.target.closest("button, a");
  if (!target) return;
  try {
    if (target.dataset.close) {
      $(`#${target.dataset.close}`).close();
      return;
    }
    if (target.matches("#quickTask, #newTask")) {
      openTask();
      return;
    }
    if (target.matches("#newEvent")) {
      openEvent();
      return;
    }
    if (target.dataset.filter) {
      state.filter = target.dataset.filter;
      renderTasks();
      return;
    }
    if (target.dataset.taskEdit) {
      openTask(state.tasks.find((t) => t.id === target.dataset.taskEdit));
      return;
    }
    if (target.dataset.taskDelete) {
      if (window.confirm("Excluir esta tarefa?")) {
        await api(`/api/tasks/${target.dataset.taskDelete}`, {
          method: "DELETE",
        });
        await refreshTasks();
        toast("Tarefa excluída.");
      }
      return;
    }
    if (target.dataset.habitDelete) {
      if (window.confirm("Excluir este hábito e seu histórico?")) {
        await api(`/api/habits/${target.dataset.habitDelete}`, {
          method: "DELETE",
        });
        await refreshHabits();
        toast("Hábito excluído.");
      }
      return;
    }
    if (target.dataset.habitCheck) {
      await api(`/api/habits/${target.dataset.habitCheck}/check`, {
        method: "POST",
        body: { date: target.dataset.date },
      });
      await refreshHabits();
      return;
    }
    if (target.dataset.eventDelete) {
      if (window.confirm("Excluir este compromisso?")) {
        await api(`/api/events/${target.dataset.eventDelete}`, {
          method: "DELETE",
        });
        state.events = await api("/api/events");
        renderCalendar();
        toast("Compromisso excluído.");
      }
      return;
    }
    if (target.id === "prevWeek") {
      state.weekOffset--;
      renderCalendar();
      return;
    }
    if (target.id === "nextWeek") {
      state.weekOffset++;
      renderCalendar();
      return;
    }
    if (target.id === "currentWeek") {
      state.weekOffset = 0;
      renderCalendar();
      return;
    }
    if (target.id === "logoutBtn") {
      await api("/api/auth/logout", { method: "POST", body: {} });
      window.location.assign("/login");
    }
  } catch (err) {
    showError(err);
  }
});
document.addEventListener("change", async (e) => {
  const target = e.target;
  if (target.matches("[data-task-toggle]")) {
    try {
      await api(`/api/tasks/${target.dataset.taskToggle}/toggle`, {
        method: "PATCH",
        body: {},
      });
      await refreshTasks();
      toast("Tarefa atualizada.");
    } catch (err) {
      target.checked = !target.checked;
      showError(err);
    }
  } else if (target.matches("input[data-habit-check]")) {
    try {
      await api(`/api/habits/${target.dataset.habitCheck}/check`, {
        method: "POST",
        body: { date: target.dataset.date },
      });
      await refreshHabits();
    } catch (err) {
      target.checked = !target.checked;
      showError(err);
    }
  }
});
$("#taskForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const id = form.elements.id.value;
  const body = {
    title: form.elements.title.value,
    notes: form.elements.notes.value,
    dueDate: form.elements.dueDate.value || null,
    priority: form.elements.priority.value,
  };
  const error = $("#taskError");
  error.hidden = true;
  try {
    await api(id ? `/api/tasks/${id}` : "/api/tasks", {
      method: id ? "PUT" : "POST",
      body,
    });
    $("#taskDialog").close();
    await refreshTasks();
    toast(id ? "Tarefa atualizada." : "Tarefa criada!");
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
});
$("#eventForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const error = $("#eventError");
  error.hidden = true;
  const startDate = new Date(form.elements.startsAt.value);
  const endDate = new Date(form.elements.endsAt.value);
  if (
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime()) ||
    startDate >= endDate
  ) {
    error.textContent = "Confira as datas de início e término.";
    error.hidden = false;
    return;
  }
  try {
    await api("/api/events", {
      method: "POST",
      body: {
        title: form.elements.title.value,
        startsAt: startDate.toISOString(),
        endsAt: endDate.toISOString(),
        notes: form.elements.notes.value,
      },
    });
    $("#eventDialog").close();
    state.events = await api("/api/events");
    renderCalendar();
    toast("Compromisso criado!");
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
});
$("#habitForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#habitName").value.trim();
  if (!name) return;
  try {
    await api("/api/habits", { method: "POST", body: { name } });
    $("#habitName").value = "";
    await refreshHabits();
    toast("Novo hábito criado!");
  } catch (err) {
    showError(err);
  }
});

async function init() {
  const date = new Date();
  $("#topbarDate").textContent = date.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  try {
    if (page === "app") await Promise.all([refreshTasks(), refreshHabits()]);
    if (page === "tasks") await refreshTasks();
    if (page === "habits") await refreshHabits();
    if (page === "calendar") {
      [state.tasks, state.events] = await Promise.all([
        api("/api/tasks"),
        api("/api/events"),
      ]);
      renderCalendar();
    }
    if (page === "insights") renderInsights(await api("/api/insights"));
  } catch (err) {
    showError(err);
  }
}
init();
