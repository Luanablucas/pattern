"use strict";

const page = document.body.dataset.page;
const state = {
  tasks: [],
  habits: [],
  routines: [],
  entries: [],
  events: [],
  categories: [],
  filter: "all",
  calendarView: "month",
  calendarCursor: new Date(),
  calendarRequest: 0,
};
const $ = (selector) => document.querySelector(selector);
const HabitRules = window.PatternHabits;
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
  const meta = `${task.dueDate ? shortDate(task.dueDate) : "Sem prazo"}${overdue ? " · Atrasada" : ""}${task.isRecurring ? " · ↻ Repetida" : ""}`;
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
  const scheduledHabits = state.habits.filter((habit) =>
    HabitRules.isScheduled(habit, today),
  );
  const habitsCompleted = scheduledHabits.filter((habit) =>
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
      number: `${habitsCompleted}/${scheduledHabits.length}`,
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
    <div class="progress-summary"><strong>${tasksForToday.length + scheduledHabits.length ? "Seu dia está ganhando forma ✦" : "Comece no seu ritmo ✦"}</strong><span>Seu progresso é calculado apenas com tarefas com prazo para hoje e hábitos cadastrados.</span></div>
    ${progress("Tarefas de hoje", todayCompleted, tasksForToday.length, "Nenhuma agendada")}
    ${progress("Hábitos de hoje", habitsCompleted, scheduledHabits.length, "Nenhum planejado")}`;

  const priorityRank = { high: 0, medium: 1, low: 2 };
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
  $("#homeHabits").innerHTML = scheduledHabits.length
    ? scheduledHabits
        .slice(0, 6)
        .map((habit) => {
          const checked = state.entries.some(
            (entry) => entry.habitId === habit.id && entry.date === today,
          );
          return `<div class="item-row"><input class="check" type="checkbox" data-habit-check="${habit.id}" data-date="${today}" aria-label="${checked ? "Desmarcar" : "Marcar"} ${escapeHTML(habit.name)}" ${checked ? "checked" : ""}><div class="item-info"><div class="item-title ${checked ? "done" : ""}">${escapeHTML(habit.name)}</div><div class="item-meta">${checked ? "Feito hoje. Boa!" : "Ainda dá tempo ✧"}</div></div></div>`;
        })
        .join("")
    : empty(
        "Hoje sem hábitos agendados",
        "Organize sua semana na página Hábitos.",
      );

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
          const timeLabel = event.timeMode && event.timeMode!=='exact'
            ? eventTimeLabel(event)
            : ongoing ? "Em andamento" : eventTimeLabel(event);
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
const routinePeriods = {
  morning: "Manhã",
  evening: "Noite",
  flexible: "Flexível",
};
function markedForHabit(habitId) {
  return new Set(
    state.entries.filter((e) => e.habitId === habitId).map((e) => e.date),
  );
}
function habitCard(h) {
  const today = todayISO();
  const checkedDates = markedForHabit(h.id);
  const dates = HabitRules.weekDates(today);
  const weekly = HabitRules.weekSummary(h, checkedDates, today);
  const chain = HabitRules.streak(h, checkedDates, today);
  const schedule = h.scheduleDays || [0, 1, 2, 3, 4, 5, 6];
  const controls = dates
    .map((date) => {
      const planned = HabitRules.isScheduled(h, date);
      const checked = checkedDates.has(date);
      const future = date > today;
      const disabled = !planned || future;
      const label = HabitRules.labels[HabitRules.weekday(date)];
      return `<div class="habit-day ${disabled ? "is-off" : ""}"><span>${label}</span><button type="button" class="${checked ? "checked" : ""}" data-habit-check="${h.id}" data-date="${date}" ${disabled ? "disabled" : ""} aria-pressed="${checked}" aria-label="${checked ? "Desmarcar" : "Marcar"} ${escapeHTML(h.name)} em ${date}${!planned ? " (não planejado)" : ""}">${checked ? "✓" : planned ? "·" : "−"}</button></div>`;
    })
    .join("");
  const goalDone = weekly.checked >= weekly.goal;
  const history = Array.from({ length: 28 }, (_, i) =>
    HabitRules.shifted(today, i - 27),
  )
    .map((date) => {
      const planned = HabitRules.isScheduled(h, date),
        checked = checkedDates.has(date);
      const className = checked ? "done" : planned ? "missed" : "rest";
      return `<span class="history-day ${className}" title="${date}: ${checked ? "Realizado" : planned ? "Não registrado" : "Descanso"}" aria-label="${date}: ${checked ? "Realizado" : planned ? "Não registrado" : "Não programado"}"></span>`;
    })
    .join("");
  return `<article class="habit-card">
    <div class="habit-card-header"><div class="habit-card-title"><div class="habit-name">${escapeHTML(h.name)}</div><p class="habit-description">${h.preferredTime ? `${escapeHTML(h.preferredTime)} · ` : ""}${schedule.length === 7 ? "Todos os dias" : schedule.map((d) => HabitRules.labels[d]).join(", ")}</p></div>
    <div class="row-actions"><button class="mini-button" type="button" data-habit-edit="${h.id}" aria-label="Editar hábito ${escapeHTML(h.name)}">✎</button><button class="mini-button" type="button" data-habit-delete="${h.id}" aria-label="Excluir hábito ${escapeHTML(h.name)}">×</button></div></div>
    <div class="habit-metrics"><span class="habit-metric ${goalDone ? "goal-done" : ""}">✧ Meta semanal: ${weekly.checked}/${weekly.goal}</span><span class="habit-metric">↗ Sequência: ${chain} ${chain === 1 ? "realização" : "realizações"}</span></div>
    <div class="habit-week" role="group" aria-label="Dias da semana para ${escapeHTML(h.name)}">${controls}</div>
    <div class="habit-history"><div class="habit-history-label">Últimos 28 dias <span>■ realizado · □ planejado</span></div><div class="history-grid" aria-label="Histórico de 28 dias de ${escapeHTML(h.name)}">${history}</div></div>
  </article>`;
}
function renderHabits() {
  const today = todayISO();
  const scheduled = state.habits.filter((h) =>
    HabitRules.isScheduled(h, today),
  );
  const completed = scheduled.filter((h) => markedForHabit(h.id).has(today));
  const tracked = state.habits.map((h) =>
    HabitRules.weekSummary(h, markedForHabit(h.id), today),
  );
  const thisWeekDone = tracked.reduce((sum, x) => sum + x.checked, 0);
  const thisWeekPlanned = tracked.reduce((sum, x) => sum + x.planned, 0);
  $("#habitOverview").innerHTML =
    `<article class="habit-overview-card"><span class="eyebrow">HOJE</span><strong>${completed.length}<small> / ${scheduled.length}</small></strong><p>Hábitos realizados</p></article><article class="habit-overview-card"><span class="eyebrow">NESTA SEMANA</span><strong>${thisWeekPlanned ? Math.round((thisWeekDone / thisWeekPlanned) * 100) : 0}%</strong><p>Ocorrências concluídas até hoje</p></article><article class="habit-overview-card"><span class="eyebrow">SEU ESPAÇO</span><strong>${state.routines.length}</strong><p>Rotinas organizadas</p></article>`;

  const grouped = state.routines
    .map((r) => {
      const related = state.habits.filter((h) => h.routineId === r.id);
      return `<article class="routine-card"><div class="routine-card-top"><div><span class="routine-period">${escapeHTML(routinePeriods[r.period] || "Flexível")}</span><h3>${escapeHTML(r.name)}</h3>${r.description ? `<p class="muted small">${escapeHTML(r.description)}</p>` : ""}</div><div class="row-actions"><button type="button" class="mini-button" data-routine-edit="${r.id}" aria-label="Editar rotina">✎</button><button type="button" class="mini-button" data-routine-delete="${r.id}" aria-label="Excluir rotina">×</button></div></div>
    <div class="routine-items">${
      related.length
        ? related
            .map((h) => {
              const planned = HabitRules.isScheduled(h, today),
                done = markedForHabit(h.id).has(today);
              return `<div class="routine-step"><span class="routine-step-mark">${planned ? (done ? "✓" : "○") : "·"}</span><span class="routine-step-name">${escapeHTML(h.name)}</span><span class="routine-step-time">${h.preferredTime ? escapeHTML(h.preferredTime) : planned ? "Hoje" : "Outro dia"}</span></div>`;
            })
            .join("")
        : '<p class="muted small">Adicione um hábito a esta rotina usando o botão Novo hábito.</p>'
    }</div></article>`;
    })
    .join("");
  $("#routineList").innerHTML =
    grouped ||
    empty(
      "Comece por uma rotina",
      "Crie uma rotina matinal, noturna ou flexível para agrupar hábitos.",
    );
  $("#habitList").innerHTML = state.habits.length
    ? state.habits.map(habitCard).join("")
    : empty(
        "Seu primeiro passo",
        "Crie um hábito e escolha os dias em que deseja praticá-lo.",
      );
}
function populateRoutineSelect(selected = "") {
  const select = $("#habitEditForm").elements.routineId;
  select.innerHTML =
    '<option value="">Sem rotina</option>' +
    state.routines
      .map((r) => `<option value="${r.id}">${escapeHTML(r.name)}</option>`)
      .join("");
  select.value = selected || "";
}
function openHabit(habit = null) {
  const f = $("#habitEditForm");
  f.reset();
  f.elements.id.value = habit?.id || "";
  f.elements.name.value = habit?.name || "";
  f.elements.preferredTime.value = habit?.preferredTime || "";
  const days = habit?.scheduleDays || [0, 1, 2, 3, 4, 5, 6];
  f.querySelectorAll('input[name="day"]').forEach((input) => {
    input.checked = days.includes(Number(input.value));
  });
  f.elements.goalPerWeek.value = habit?.goalPerWeek || 7;
  f.elements.goalPerWeek.max = days.length;
  populateRoutineSelect(habit?.routineId);
  $("#habitDialogTitle").textContent = habit ? "Editar hábito" : "Novo hábito";
  $("#habitError").hidden = true;
  $("#habitDialog").showModal();
  f.elements.name.focus();
}
function openRoutine(routine = null) {
  const f = $("#routineForm");
  f.reset();
  f.elements.id.value = routine?.id || "";
  f.elements.name.value = routine?.name || "";
  f.elements.period.value = routine?.period || "morning";
  f.elements.description.value = routine?.description || "";
  $("#routineDialogTitle").textContent = routine
    ? "Editar rotina"
    : "Nova rotina";
  $("#routineError").hidden = true;
  $("#routineDialog").showModal();
  f.elements.name.focus();
}

function displayColor(color){return /^#[0-9a-fA-F]{6}$/.test(color||'') ? color : '#9984a8';}
function repeatDescription(repeat){return ({daily:'Diária',weekly:'Semanal',monthly:'Mensal'})[repeat]||'';}
function calendarLegend(){
  const el=$('#calendarLegend');if(!el)return;
  el.innerHTML=state.categories.map(c=>`<span class="cal-legend-item" style="--event-accent:${displayColor(c.color)}"><i class="legend-dot"></i>${escapeHTML(c.name)}</span>`).join('')+'<span class="cal-legend-item" style="--event-accent:#9984a8"><i class="legend-dot"></i>Tarefas</span>';
}
function fillCategorySelect(selected){
  const sel=$('#eventForm').elements.categoryId;
  sel.innerHTML=state.categories.map(c=>`<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');
  sel.value=selected&&state.categories.some(c=>c.id===selected)?selected:(state.categories.find(c=>c.legacyKey==='personal')||state.categories[0])?.id||'';
}
function renderCategoryManager(){
 const el=$('#categoryList');
 el.innerHTML=state.categories.length?state.categories.map(c=>`<div class="category-list-row" style="--event-accent:${displayColor(c.color)}"><span class="category-dot"></span><strong>${escapeHTML(c.name)}</strong><button type="button" class="mini-button" data-category-edit="${c.id}" aria-label="Editar ${escapeHTML(c.name)}">✎</button><button type="button" class="mini-button" data-category-delete="${c.id}" aria-label="Excluir ${escapeHTML(c.name)}">×</button></div>`).join(''):empty('Sem blocos','Crie um bloco para classificar seus compromissos.');
}
async function refreshCategories(){
 state.categories=await api('/api/event-categories');
 if(page==='calendar'){calendarLegend();renderCategoryManager();fillCategorySelect();renderCalendar();}
}

function calendarDays() {
  const first = new Date(state.calendarCursor);
  first.setHours(12, 0, 0, 0);
  if (state.calendarView === "month") first.setDate(1);
  first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const count = state.calendarView === "month" ? 42 : 7;
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(first);
    d.setDate(first.getDate() + i);
    return d;
  });
}
function overlapsDay(event, date) {
  const start = fromISO(date);
  start.setHours(0, 0, 0, 0);
  const next = new Date(start);
  next.setDate(next.getDate() + 1);
  return new Date(event.startsAt) < next && new Date(event.endsAt) > start;
}
function calendarTitle(days) {
  if (state.calendarView === "month")
    return state.calendarCursor.toLocaleDateString("pt-BR", {
      month: "long",
      year: "numeric",
    });
  const first = days[0];
  const last = days[days.length - 1];
  const start = first.toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "short",
  });
  const end = last.toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${start} – ${end}`;
}
function renderCalendar() {
  if (page !== "calendar") return;
  const days = calendarDays();
  const today = todayISO();
  $("#calendarTitle").textContent = calendarTitle(days);
  $("#calendarGrid").classList.toggle(
    "calendar-month",
    state.calendarView === "month",
  );
  $("#calendarGrid").classList.toggle(
    "calendar-week",
    state.calendarView === "week",
  );
  document.querySelectorAll("[data-calendar-view]").forEach((button) => {
    const selected = button.dataset.calendarView === state.calendarView;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  $("#calendarGrid").innerHTML = days
    .map((d) => {
      const date = localISO(d);
      const tasks = state.tasks.filter((task) => task.dueDate === date);
      const events = state.events.filter((event) => overlapsDay(event, date));
      const hasPlans = tasks.length + events.length > 0;
      const eventCards = events
        .map((event) => {
          const categoryColor=displayColor(event.categoryColor);
          const startingHere = localISO(new Date(event.startsAt)) === date;
          const time = startingHere ? eventTimeLabel(event) : "Continua";
          return `<button class="cal-entry cal-appointment" style="--event-accent:${categoryColor}" type="button" data-event-edit="${event.id}" title="Editar compromisso: ${escapeHTML(event.title)}">
        <span class="cal-entry-time">${escapeHTML(time)}</span><span class="cal-entry-title">${escapeHTML(event.title)}</span>${event.isRecurring ? `<span class="cal-entry-time">↻</span>` : ""}</button>`;
        })
        .join("");
      const taskCards = tasks
        .map(
          (
            task,
          ) => `<button class="cal-entry cal-task ${task.completed ? "is-complete" : ""}" draggable="${!task.isRecurring}" type="button" ${task.isRecurring ? "" : `data-task-drag="${task.id}"`} data-task-edit="${task.id}" title="${task.isRecurring?"Clique para editar a série":"Arraste para reagendar ou clique para editar"}: ${escapeHTML(task.title)}">
      <span class="cal-entry-symbol" aria-hidden="true">${task.completed ? "✓" : "☐"}</span><span class="cal-entry-title">${escapeHTML(task.title)}</span>${task.isRecurring?`<span class="cal-entry-time">↻</span>`:""}</button>`,
        )
        .join("");
      const label = d.toLocaleDateString("pt-BR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      return `<div class="calendar-day ${date === today ? "today" : ""} ${state.calendarView === "month" && d.getMonth() !== state.calendarCursor.getMonth() ? "outside-month" : ""}" data-drop-date="${date}" aria-label="${escapeHTML(label)}">
      <div class="calendar-day-head"><span class="calendar-day-num" ${date === today ? 'aria-current="date"' : ""}>${d.getDate()}</span><button type="button" class="calendar-add" data-day-create="${date}" aria-label="Novo compromisso em ${escapeHTML(label)}" title="Novo compromisso neste dia">+</button></div>
      <div class="calendar-day-body">${eventCards}${taskCards}${!hasPlans ? '<span class="calendar-day-free">Dia livre</span>' : ""}</div>
    </div>`;
    })
    .join("");

  const unscheduled = state.tasks.filter(
    (task) => !task.dueDate && !task.completed,
  );
  $("#unscheduledCount").textContent =
    `${unscheduled.length} ${unscheduled.length === 1 ? "tarefa" : "tarefas"}`;
  $("#unscheduledTasks").innerHTML = unscheduled.length
    ? unscheduled
        .map(
          (task) =>
            `<button type="button" class="unscheduled-chip" draggable="true" data-task-drag="${task.id}" data-task-edit="${task.id}" title="Arraste para o calendário ou clique para editar"><span aria-hidden="true">☰</span> ${escapeHTML(task.title)}</button>`,
        )
        .join("")
    : '<p class="muted small">Tudo planejado! Suas tarefas pendentes já têm uma data. ✦</p>';
}
async function loadCalendarEvents() {
  if (page !== "calendar") return;
  const request = ++state.calendarRequest;
  const days = calendarDays();
  const from = new Date(days[0]);
  from.setHours(0, 0, 0, 0);
  const to = new Date(days[days.length - 1]);
  to.setDate(to.getDate() + 1);
  to.setHours(0, 0, 0, 0);
  $("#calendarFeedback").textContent = "Atualizando compromissos...";
  try {
    const [events,tasks] = await Promise.all([
      api(`/api/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),
      api(`/api/tasks?from=${localISO(from)}&to=${localISO(new Date(to.getTime()-86400000))}`)
    ]);
    if (request !== state.calendarRequest) return;
    state.events = events;
    state.tasks=tasks;
    renderCalendar();
    $("#calendarFeedback").textContent = "";
  } catch (error) {
    if (request !== state.calendarRequest) return;
    $("#calendarFeedback").textContent =
      "Não foi possível carregar os compromissos deste período.";
    showError(error);
  }
}
async function moveTaskToDate(taskId, date) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task || !/^\d{4}-\d{2}-\d{2}$/.test(date) || task.dueDate === date)
    return;
  await api(`/api/tasks/${taskId}/date`, {
    method: "PATCH",
    body: { dueDate: date },
  });
  await refreshTasks();
  toast(`Tarefa movida para ${shortDate(date)}.`);
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
  const habitPanel = $("#habitInsights");
  if (habitPanel) {
    const a = data.habitAnalysis;
    if (data.habitPythonOnline && a) {
      const percent = a.completionRate === null ? "—" : `${a.completionRate}%`;
      habitPanel.innerHTML = `<div class="habit-insight-number">${percent}</div><p class="muted">${a.completed} de ${a.planned} realizações planejadas</p><div class="progress-track"><span style="width:${a.completionRate || 0}%"></span></div><p class="habit-insight-text">${escapeHTML(a.insight)}</p><p class="muted small">${escapeHTML(a.method)}</p>`;
    } else {
      habitPanel.innerHTML = empty(
        "Análise indisponível",
        "Inicie o serviço Python para visualizar a consistência dos hábitos.",
      );
    }
  }
}
async function refreshTasks() {
  state.tasks = await api(page==='tasks'?'/api/tasks?list=1':'/api/tasks');
  if (page === "tasks") renderTasks();
  if (page === "app") renderDashboard();
  if (page === "calendar") renderCalendar();
}
async function refreshHabits() {
  const [data, routines] = await Promise.all([
    api("/api/habits"),
    page === "habits" ? api("/api/routines") : Promise.resolve(null),
  ]);
  state.habits = data.habits;
  if (routines) state.routines = routines;
  state.entries = data.entries;
  if (page === "habits") renderHabits();
  if (page === "app") renderDashboard();
}
function openTask(task = null, { forToday = false } = {}) {
  const dialog = $("#taskDialog");
  const form = $("#taskForm");
  form.reset();
  form.elements.id.value = task?.seriesId || task?.id || "";
  form.elements.title.value = task?.title || "";
  form.elements.notes.value = task?.notes || "";
  form.elements.dueDate.value = forToday ? todayISO() : task?.seriesDueDate || task?.dueDate || "";
  form.elements.priority.value = task?.priority || "medium";
  setRepeatFields(form,'task',task);
  $("#taskDialogTitle").textContent = task ? (task.isRecurring?'Editar série de tarefas':'Editar tarefa') : "Nova tarefa";
  $("#taskError").hidden = true;
  dialog.showModal();
  form.elements.title.focus();
}
function formElementsStartDate(){return $('#eventForm').elements.startsAt.value.slice(0,10);}
function eventTimeLabel(event) {
  const labels={all_day:'Dia inteiro',morning:'Manhã',afternoon:'Tarde',night:'Noite'};
  return labels[event.timeMode] || new Date(event.startsAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
}
function setEventTimeVisibility(){
  const form=$('#eventForm');
  const exact=form.elements.timeMode.value==='exact';
  $('#eventExactFields').hidden=!exact;
  $('#eventDateField').hidden=exact;
  form.elements.startsAt.required=exact;
  form.elements.endsAt.required=exact;
  form.elements.eventDate.required=!exact;
  const note={all_day:'O compromisso ocupa o dia inteiro, sem horário de término.',morning:'Das 06:00 às 12:00.',afternoon:'Das 12:00 às 18:00.',night:'Das 18:00 até a meia-noite.'};
  $('#eventTimeHelp').hidden=exact;
  $('#eventTimeHelp').textContent=note[form.elements.timeMode.value]||'';
}
function eventDateRange(iso, mode){
  const [hour,endHour,nextDay]={all_day:[0,0,true],morning:[6,12,false],afternoon:[12,18,false],night:[18,0,true]}[mode];
  const start=new Date(`${iso}T00:00:00`);
  const end=new Date(`${iso}T00:00:00`);
  start.setHours(hour,0,0,0);
  if(nextDay)end.setDate(end.getDate()+1);
  end.setHours(endHour,0,0,0);
  return {start,end};
}
function localDateTimeInput(date) {
  const d = new Date(date);
  return `${localISO(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function openEvent(event = null, forDate = null) {
  const form = $("#eventForm");
  form.reset();
  $("#eventError").hidden = true;
  const starts = event
    ? new Date(event.seriesStartsAt || event.startsAt)
    : forDate
      ? fromISO(forDate)
      : new Date();
  if (!event && forDate) starts.setHours(9, 0, 0, 0);
  if (!event && !forDate) {
    starts.setMinutes(0, 0, 0);
    starts.setHours(starts.getHours() + 1);
  }
  const ends = event
    ? new Date(event.seriesEndsAt || event.endsAt)
    : new Date(starts.getTime() + 60 * 60 * 1000);
  form.elements.id.value = event?.seriesId || event?.id || "";
  form.elements.title.value = event?.title || "";
  form.elements.startsAt.value = localDateTimeInput(starts);
  form.elements.endsAt.value = localDateTimeInput(ends);
  form.elements.eventDate.value = localISO(starts);
  form.elements.timeMode.value = event?.timeMode || 'exact';
  setEventTimeVisibility();
  fillCategorySelect(event?.categoryId);setRepeatFields(form,'event',event);
  form.elements.notes.value = event?.notes || "";
  $("#eventDialogTitle").textContent = event
    ? (event.isRecurring?'Editar série de compromissos':'Editar compromisso')
    : "Novo compromisso";
  $("#deleteEvent").hidden = !event;
  $('#deleteEvent').dataset.instanceId=event?.id||'';
  $("#eventDialog").showModal();
  form.elements.title.focus();
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
    if (target.dataset.dayCreate) {
      openEvent(null, target.dataset.dayCreate);
      return;
    }
    if (target.dataset.eventEdit) {
      const event = state.events.find(
        (item) => item.id === target.dataset.eventEdit,
      );
      if (event) openEvent(event);
      return;
    }
    if (target.dataset.calendarView) {
      state.calendarView = target.dataset.calendarView;
      await loadCalendarEvents();
      return;
    }
    if (target.id === "prevPeriod" || target.id === "nextPeriod") {
      const direction = target.id === "prevPeriod" ? -1 : 1;
      const d = new Date(state.calendarCursor);
      if (state.calendarView === "month") {
        d.setDate(1);
        d.setMonth(d.getMonth() + direction);
      } else d.setDate(d.getDate() + direction * 7);
      state.calendarCursor = d;
      await loadCalendarEvents();
      return;
    }
    if (target.id === "currentPeriod") {
      state.calendarCursor = new Date();
      await loadCalendarEvents();
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
      const task=state.tasks.find(t=>t.id===target.dataset.taskDelete);
      if(task?.isRecurring){askDelete({kind:'task',id:task.seriesId,instance:task.occurrenceDate,title:task.title,recurring:true});}
      else if(window.confirm('Excluir esta tarefa?')){await api(`/api/tasks/${target.dataset.taskDelete}`,{method:'DELETE'});await refreshTasks();toast('Tarefa excluída.');}
      return;
    }
    if (target.matches("#newHabit")) {
      openHabit();
      return;
    }
    if (target.matches("#newRoutine")) {
      openRoutine();
      return;
    }
    if (target.dataset.habitEdit) {
      const h = state.habits.find((h) => h.id === target.dataset.habitEdit);
      if (h) openHabit(h);
      return;
    }
    if (target.dataset.routineEdit) {
      const r = state.routines.find((r) => r.id === target.dataset.routineEdit);
      if (r) openRoutine(r);
      return;
    }
    if (target.dataset.routineDelete) {
      if (
        window.confirm(
          "Excluir esta rotina? Os hábitos associados serão mantidos, sem rotina.",
        )
      ) {
        await api(`/api/routines/${target.dataset.routineDelete}`, {
          method: "DELETE",
        });
        await refreshHabits();
        toast("Rotina excluída; hábitos preservados.");
      }
      return;
    }
    if (target.dataset.habitDelete) {
      const habit=state.habits.find(h=>h.id===target.dataset.habitDelete);
      askDelete({kind:'habit',id:habit?.id,title:habit?.name||'este hábito'});
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
    if (target.id === "deleteEvent") {
      const event=state.events.find(ev=>ev.id===target.dataset.instanceId);
      if(event)askDelete({kind:'event',id:event.seriesId||event.id,instance: event.occurrenceDate,title:event.title,recurring:event.isRecurring});
      return;
    }
    if(target.id==='manageCategories') {renderCategoryManager();resetCategoryForm();$('#categoryDialog').showModal();return;}
    if(target.id==='resetCategory') {resetCategoryForm();return;}
    if(target.dataset.categoryEdit) {const c=state.categories.find(c=>c.id===target.dataset.categoryEdit);if(c){const f=$('#categoryForm');f.elements.id.value=c.id;f.elements.name.value=c.name;f.elements.color.value=c.color;}return;}
    if(target.dataset.categoryDelete) {const c=state.categories.find(c=>c.id===target.dataset.categoryDelete);if(c)askDelete({kind:'category',id:c.id,title:c.name});return;}
    if(target.id==='confirmDelete'){await performDeletion();return;}
    if (target.id === "logoutBtn") {
      await api("/api/auth/logout", { method: "POST", body: {} });
      window.location.assign("/login");
    }
  } catch (err) {
    showError(err);
  }
});
$("#habitDaysPicker")?.addEventListener("change", () => {
  const f = $("#habitEditForm");
  const count = f.querySelectorAll('input[name="day"]:checked').length;
  f.elements.goalPerWeek.max = Math.max(1, count);
  if (Number(f.elements.goalPerWeek.value) > count)
    f.elements.goalPerWeek.value = Math.max(1, count);
});

document.addEventListener("change", async (e) => {
  const target = e.target;
  if(target.matches('.repeat-select')){
    const form=target.form;
    const kind=form.matches('#taskForm')?'task':'event';
    if(form.elements.repeat.value==='weekly' && !form.dataset.repeatDaysTouched){
      const iso=kind==='task'?(form.elements.dueDate.value||todayISO()):(form.elements.timeMode.value==='exact'?form.elements.startsAt.value.slice(0,10):form.elements.eventDate.value);
      const day=fromISO(iso||todayISO()).getDay();
      form.querySelectorAll(`[data-repeat-days="${kind}"] input`).forEach(input=>input.checked=Number(input.value)===day);
    }
    if(kind==='task' && form.elements.repeat.value!=='none' && !form.elements.dueDate.value)form.elements.dueDate.value=todayISO();
    setRepeatVisibility(form,kind);return;
  }
  if(target.matches('#eventTimeMode')){
    if(target.value!=='exact'&&$('#eventDateField').hidden&&formElementsStartDate())$('#eventForm').elements.eventDate.value=formElementsStartDate();
    setEventTimeVisibility();return;
  }
  if(target.matches('input[name="repeatDay"]')){target.form.dataset.repeatDaysTouched='1';return;}
  if (target.matches("[data-task-toggle]")) {
    try {
      const t=state.tasks.find(t=>t.id===target.dataset.taskToggle);
      if(t?.isRecurring)await api(`/api/recurring-tasks/${t.seriesId}/${t.occurrenceDate}/toggle`,{method:'PATCH',body:{}});
      else await api(`/api/tasks/${target.dataset.taskToggle}/toggle`, {method:'PATCH',body:{}});
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
    ...getRepeatBody(form,'task'),
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
  const id = form.elements.id.value;
  const error = $("#eventError");
  error.hidden = true;
  const mode=form.elements.timeMode.value;
  const range=mode==='exact'
    ? {start:new Date(form.elements.startsAt.value),end:new Date(form.elements.endsAt.value)}
    : form.elements.eventDate.value ? eventDateRange(form.elements.eventDate.value,mode) : {start:new Date(NaN),end:new Date(NaN)};
  const startDate=range.start;
  const endDate=range.end;
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate >= endDate) {
    error.textContent = "Confira a data e os horários do compromisso.";
    error.hidden = false;
    return;
  }
  const body = {
    title: form.elements.title.value,
    startsAt: startDate.toISOString(),
    endsAt: endDate.toISOString(),
    timeMode:mode,
    categoryId:form.elements.categoryId.value,
    notes: form.elements.notes.value,
    ...getRepeatBody(form,'event'),
  };
  try {
    await api(id ? `/api/events/${id}` : "/api/events", {
      method: id ? "PUT" : "POST",
      body,
    });
    $("#eventDialog").close();
    await loadCalendarEvents();
    toast(id ? "Compromisso atualizado!" : "Compromisso criado!");
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
});

document.addEventListener("dragstart", (e) => {
  const task = e.target.closest("[data-task-drag]");
  if (!task || page !== "calendar") return;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", task.dataset.taskDrag);
  task.classList.add("is-dragging");
});
document.addEventListener("dragend", (e) => {
  e.target.closest("[data-task-drag]")?.classList.remove("is-dragging");
  document
    .querySelectorAll(".calendar-day.drop-target")
    .forEach((d) => d.classList.remove("drop-target"));
});
document.addEventListener("dragover", (e) => {
  const day = e.target.closest("[data-drop-date]");
  if (
    !day ||
    page !== "calendar" ||
    !e.dataTransfer.types.includes("text/plain")
  )
    return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  document.querySelectorAll(".calendar-day.drop-target").forEach((d) => {
    if (d !== day) d.classList.remove("drop-target");
  });
  day.classList.add("drop-target");
});
document.addEventListener("drop", async (e) => {
  const day = e.target.closest("[data-drop-date]");
  if (!day || page !== "calendar") return;
  e.preventDefault();
  day.classList.remove("drop-target");
  const id = e.dataTransfer.getData("text/plain");
  if (!state.tasks.some((task) => task.id === id)) return;
  try {
    await moveTaskToDate(id, day.dataset.dropDate);
  } catch (error) {
    showError(error);
  }
});
$("#habitEditForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const id = f.elements.id.value;
  const days = [...f.querySelectorAll('input[name="day"]:checked')]
    .map((el) => Number(el.value))
    .sort((a, b) => a - b);
  const error = $("#habitError");
  error.hidden = true;
  if (!days.length) {
    error.textContent = "Escolha pelo menos um dia da semana.";
    error.hidden = false;
    return;
  }
  const body = {
    name: f.elements.name.value.trim(),
    scheduleDays: days,
    preferredTime: f.elements.preferredTime.value || null,
    goalPerWeek: Number(f.elements.goalPerWeek.value),
    routineId: f.elements.routineId.value || null,
  };
  try {
    await api(id ? `/api/habits/${id}` : "/api/habits", {
      method: id ? "PUT" : "POST",
      body,
    });
    $("#habitDialog").close();
    await refreshHabits();
    toast(id ? "Hábito atualizado." : "Novo hábito criado!");
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
});
$("#routineForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const id = f.elements.id.value;
  const error = $("#routineError");
  error.hidden = true;
  const body = {
    name: f.elements.name.value.trim(),
    period: f.elements.period.value,
    description: f.elements.description.value.trim(),
  };
  try {
    await api(id ? `/api/routines/${id}` : "/api/routines", {
      method: id ? "PUT" : "POST",
      body,
    });
    $("#routineDialog").close();
    await refreshHabits();
    toast(id ? "Rotina atualizada." : "Rotina criada!");
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
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
    if (page === "calendar") {await refreshCategories();await loadCalendarEvents();}
    if (page === "insights") renderInsights(await api("/api/insights"));
  } catch (err) {
    showError(err);
  }
}

function setRepeatVisibility(form,kind){
 const repeating=form.elements.repeat.value!=='none';
 const weekly=form.elements.repeat.value==='weekly';
 form.querySelector(`[data-repeat-days="${kind}"]`).hidden=!weekly;
 form.querySelector(`[data-repeat-until="${kind}"]`).hidden=!repeating;
 form.querySelector(`[data-repeat-message="${kind}"]`).hidden=!repeating;
}
function setRepeatFields(form,kind,obj){
 form.elements.repeat.value=obj?.repeat||'none';
 form.elements.repeatUntil.value=obj?.repeatUntil||'';
 const box=form.querySelector(`[data-repeat-days="${kind}"] .repeat-days`);
 const iso=kind==='task'?(form.elements.dueDate.value||todayISO()):(form.elements.timeMode.value==='exact'?form.elements.startsAt.value.slice(0,10):form.elements.eventDate.value);
 const days=obj?.repeatDays?.length?obj.repeatDays:[fromISO(iso||todayISO()).getDay()];
 form.dataset.repeatDaysTouched=obj?.repeatDays?.length?'1':'';
 box.innerHTML=[1,2,3,4,5,6,0].map((day,i)=>`<label><input name="repeatDay" type="checkbox" value="${day}" ${days.includes(day)?'checked':''} /><span>${['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'][i]}</span></label>`).join('');
 setRepeatVisibility(form,kind);
}
function getRepeatBody(form,kind){
 const repeat=form.elements.repeat.value;
 const repeatDays=repeat==='weekly'?[...form.querySelectorAll(`[data-repeat-days="${kind}"] input:checked`)].map(el=>Number(el.value)):[];
 return {repeat,repeatDays,repeatUntil:repeat!=='none'?(form.elements.repeatUntil.value||null):null};
}
function resetCategoryForm(){const f=$('#categoryForm');f.reset();f.elements.id.value='';$('#categoryError').hidden=true;}
let requestedDeletion=null;
function askDelete(item){
 if(!item.id)return;
 requestedDeletion=item;
 $('#confirmTitle').textContent=item.kind==='habit'?'Excluir hábito?':item.kind==='event'?'Excluir compromisso?':item.kind==='category'?'Excluir bloco?':'Excluir tarefa?';
 $('#confirmMessage').textContent=item.kind==='habit'?`Deseja excluir “${item.title}”? Todo o histórico deste hábito será apagado.`:item.kind==='category'?`O bloco “${item.title}” será excluído somente se não tiver compromissos associados.`:`Deseja excluir “${item.title}”? Essa ação não poderá ser desfeita.`;
 $('#deleteScope').hidden=!item.recurring;
 $('#deleteScope').querySelector('input[value="one"]').checked=true;
 $('#confirmError').hidden=true;
 $('#confirmDialog').showModal();
}
async function performDeletion(){
 if(!requestedDeletion)return;
 const item=requestedDeletion;
 const scope=item.recurring?$('#deleteScope').querySelector('input:checked').value:'series';
 let url;
 if(item.kind==='habit')url=`/api/habits/${item.id}`;
 else if(item.kind==='category')url=`/api/event-categories/${item.id}`;
 else if(item.kind==='task')url=scope==='one'?`/api/recurring-tasks/${item.id}/${item.instance}`:`/api/tasks/${item.id}`;
 else url=scope==='one'?`/api/events/${item.id}/occurrences/${item.instance}`:`/api/events/${item.id}`;
 const err=$('#confirmError');err.hidden=true;
 try{
   await api(url,{method:'DELETE'});
   $('#confirmDialog').close();requestedDeletion=null;
   if(item.kind==='habit'){await refreshHabits();toast('Hábito excluído.');}
   else if(item.kind==='category'){await refreshCategories();await loadCalendarEvents();toast('Bloco excluído.');}
   else if(item.kind==='task'){await refreshTasks();toast('Tarefa excluída.');}
   else {$('#eventDialog').close();await loadCalendarEvents();toast('Compromisso excluído.');}
 }catch(e){err.textContent=e.message;err.hidden=false;}
}
$('#categoryForm')?.addEventListener('submit',async(e)=>{
 e.preventDefault();const f=e.currentTarget;const id=f.elements.id.value;
 const error=$('#categoryError');error.hidden=true;
 try{
   await api(id?`/api/event-categories/${id}`:'/api/event-categories',{method:id?'PUT':'POST',body:{name:f.elements.name.value.trim(),color:f.elements.color.value}});
   await refreshCategories();await loadCalendarEvents();resetCategoryForm();toast(id?'Bloco atualizado.':'Bloco criado.');
 }catch(e){error.textContent=e.message;error.hidden=false;}
});
init();
