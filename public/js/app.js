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
  const today = todayISO();
  const now = new Date();
  const pending = state.tasks.filter((task) => !task.completed);
  const tasksForToday = state.tasks.filter((task) => task.dueDate === today);
  const todayCompleted = tasksForToday.filter((task) => task.completed).length;
  const overdue = pending.filter(
    (task) => task.dueDate && task.dueDate < today,
  );
  const dueToday = pending.filter((task) => task.dueDate === today);
  const habitsCompleted = state.habits.filter((habit) =>
    state.entries.some(
      (entry) => entry.habitId === habit.id && entry.date === today,
    ),
  ).length;
  const stats = [
    {
      label: "Com prazo para hoje",
      number: dueToday.length,
      caption: "Tarefas que ainda precisam de atenção",
      icon: "☷",
    },
    {
      label: "Atrasadas",
      number: overdue.length,
      caption: overdue.length
        ? "Você pode reorganizar com calma"
        : "Nenhuma tarefa atrasada",
      icon: "◷",
    },
    {
      label: "Hábitos realizados",
      number: `${habitsCompleted}/${state.habits.length}`,
      caption: "Pequenos passos contam",
      icon: "✦",
    },
  ];
  $("#dashboardStats").innerHTML = stats
    .map(
      (stat) =>
        `<article class="stat-card"><div class="stat-label">${stat.label}<span class="stat-icon" aria-hidden="true">${stat.icon}</span></div><div class="stat-number">${stat.number}</div><div class="stat-caption">${stat.caption}</div></article>`,
    )
    .join("");

  const hour = now.getHours();
  $("#heroSubtitle").textContent =
    hour < 12
      ? "Bom dia! Um plano simples pode deixar tudo mais leve."
      : hour < 18
        ? "Boa tarde! Ainda dá tempo de cuidar do que importa."
        : "Boa noite! Veja o que ficou para hoje, sem cobranças.";

  function progress(label, done, total, emptyLabel) {
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    return `<div class="progress-group"><div class="progress-head"><span>${label}</span><strong>${total ? `${done} de ${total}` : emptyLabel}</strong></div><div class="progress-track" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="width:${percent}%"></span></div></div>`;
  }
  $("#homeProgress").innerHTML = `
    <div class="progress-summary"><strong>${tasksForToday.length + state.habits.length ? "Seu dia está ganhando forma ✦" : "Comece no seu ritmo ✦"}</strong><span>Seu progresso é calculado apenas com tarefas com prazo para hoje e hábitos cadastrados.</span></div>
    ${progress("Tarefas de hoje", todayCompleted, tasksForToday.length, "Nenhuma agendada")}
    ${progress("Hábitos de hoje", habitsCompleted, state.habits.length, "Nenhum cadastrado")}`;

  const priorityRank = { high: 0, medium: 1, low: 2 };
  // Ordena primeiro tarefas vencidas, depois as de hoje, as futuras e por último as sem prazo.
  const ordered = [...pending].sort((a, b) => {
    const dateA = a.dueDate || "9999-12-31";
    const dateB = b.dueDate || "9999-12-31";
    return (
      dateA.localeCompare(dateB) ||
      (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1) ||
      a.title.localeCompare(b.title, "pt-BR")
    );
  });
  $("#homeTasks").innerHTML = ordered.length
    ? ordered
        .slice(0, 5)
        .map((task) => taskRow(task, { compact: true }))
        .join("")
    : empty("Tudo em dia por aqui ✦", "Adicione uma tarefa para começar.");
  $("#homeHabits").innerHTML = state.habits.length
    ? state.habits
        .slice(0, 6)
        .map((habit) => {
          const checked = state.entries.some(
            (entry) => entry.habitId === habit.id && entry.date === today,
          );
          return `<div class="item-row"><input class="check" type="checkbox" data-habit-check="${habit.id}" data-date="${today}" aria-label="${checked ? "Desmarcar" : "Marcar"} ${escapeHTML(habit.name)}" ${checked ? "checked" : ""}><div class="item-info"><div class="item-title ${checked ? "done" : ""}">${escapeHTML(habit.name)}</div><div class="item-meta">${checked ? "Feito hoje. Boa!" : "Ainda dá tempo ✧"}</div></div></div>`;
        })
        .join("")
    : empty("Sua rotina, suas regras", "Crie seu primeiro hábito.");

  const upcoming = state.events
    .filter((event) => {
      const starts = new Date(event.startsAt);
      const ends = new Date(event.endsAt);
      const limit = new Date(now);
      limit.setDate(limit.getDate() + 6);
      limit.setHours(23, 59, 59, 999);
      return !Number.isNaN(starts.getTime()) && ends >= now && starts <= limit;
    })
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  $("#homeEvents").innerHTML = upcoming.length
    ? upcoming
        .slice(0, 3)
        .map((event) => {
          const starts = new Date(event.startsAt);
          const ends = new Date(event.endsAt);
          const ongoing = starts <= now && ends >= now;
          const dayLabel =
            localISO(starts) === today
              ? "Hoje"
              : starts
                  .toLocaleDateString("pt-BR", {
                    weekday: "short",
                    day: "2-digit",
                    month: "short",
                  })
                  .replace(".", "");
          const timeLabel = ongoing
            ? "Em andamento"
            : starts.toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              });
          return `<article class="agenda-item"><div class="agenda-date"><strong>${escapeHTML(dayLabel)}</strong><span>${escapeHTML(timeLabel)}</span></div><div class="agenda-info"><strong>${escapeHTML(event.title)}</strong>${event.notes ? `<span>${escapeHTML(event.notes)}</span>` : ""}</div></article>`;
        })
        .join("")
    : `<div class="agenda-empty"><span aria-hidden="true">☼</span><strong>Agenda tranquila por enquanto</strong><p>Nenhum compromisso nos próximos sete dias.</p><a class="subtle-link" href="/calendar">Planejar um compromisso →</a></div>`;

  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date();
    day.setHours(12, 0, 0, 0);
    day.setDate(day.getDate() + index);
    const iso = localISO(day);
    const tasksCount = pending.filter((task) => task.dueDate === iso).length;
    const eventsCount = state.events.filter(
      (event) => localISO(new Date(event.startsAt)) === iso,
    ).length;
    const summary = `${tasksCount} tarefa(s) pendente(s), ${eventsCount} compromisso(s)`;
    return `<div class="week-day ${index === 0 ? "is-today" : ""}" aria-label="${escapeHTML(day.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }))}: ${summary}">
      <span class="week-day-name">${escapeHTML(day.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", ""))}</span>
      <strong class="week-day-number">${day.getDate()}</strong>
      <span class="week-day-dot ${tasksCount + eventsCount ? "has-plans" : ""}" aria-hidden="true"></span>
      <small>${tasksCount + eventsCount ? `${tasksCount + eventsCount} ${tasksCount + eventsCount === 1 ? "item" : "itens"}` : "Livre"}</small>
    </div>`;
  });
  $("#weekStrip").innerHTML = days.join("");
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
function openTask(task = null, { forToday = false } = {}) {
  const dialog = $("#taskDialog");
  const form = $("#taskForm");
  form.reset();
  form.elements.id.value = task?.id || "";
  form.elements.title.value = task?.title || "";
  form.elements.notes.value = task?.notes || "";
  form.elements.dueDate.value = forToday ? todayISO() : task?.dueDate || "";
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
    if (target.matches("#quickTask")) {
      openTask(null, { forToday: true });
      return;
    }
    if (target.matches("#newTask")) {
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
    if (page === "app") {
      const [tasks, habitsData, events] = await Promise.all([
        api("/api/tasks"),
        api("/api/habits"),
        api("/api/events"),
      ]);
      state.tasks = tasks;
      state.habits = habitsData.habits;
      state.entries = habitsData.entries;
      state.events = events;
      renderDashboard();
    }
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
