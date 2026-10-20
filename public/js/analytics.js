"use strict";

(() => {
  const root = document.querySelector('[data-page="insights"]');
  if (!root) return;
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? "").replace(/[&<>"']/g, symbol => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[symbol]);
  const minutesLabel = seconds => {
    const total = Math.round(Math.max(0, Number(seconds) || 0) / 60);
    return total >= 60 ? `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}min` : `${total}min`;
  };
  const percentChange = value => value === null || value === undefined ? "Sem período anterior comparável" : `${value > 0 ? "+" : ""}${value}% ante o período anterior`;
  const dateLabel = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  let request = 0;

  function renderCards(data) {
    const { summary: s, comparison: c } = data;
    const cards = [
      ["TEMPO DE FOCO", minutesLabel(s.focusSeconds), percentChange(c.focusSeconds)],
      ["SESSÕES", s.focusSessions, `${s.focusDays} dia(s) com foco`],
      ["TAREFAS CONCLUÍDAS", s.tasksCompleted, percentChange(c.tasksCompleted)],
      ["HÁBITOS REALIZADOS", s.habitRate === null ? "—" : `${s.habitRate}%`, `${s.habitsCompleted} de ${s.habitsPlanned} planejados`],
      ["TAREFAS RECORRENTES", s.recurringRate === null ? "—" : `${s.recurringRate}%`, `${s.recurringCompleted} de ${s.recurringPlanned} ocorrências planejadas`],
      ["TAREFAS PENDENTES", s.pending, `${s.overdue} atrasada(s), sem contar séries recorrentes`]
    ];
    $("#analyticsOverview").innerHTML = cards.map(([label, value, sub]) => `<article class="analytics-stat"><span class="eyebrow">${label}</span><strong>${escape(value)}</strong><span class="muted small">${escape(sub)}</span></article>`).join("");
  }

  function buckets(daily, days) {
    const interval = days <= 14 ? 1 : days <= 30 ? 3 : 7;
    const chunks = [];
    for (let index = 0; index < daily.length; index += interval) {
      const batch = daily.slice(index, index + interval);
      chunks.push({
        label: batch.length === 1 ? dateLabel(batch[0].date) : `${dateLabel(batch[0].date)}–${dateLabel(batch[batch.length - 1].date)}`,
        focusSeconds: batch.reduce((sum, day) => sum + day.focusSeconds, 0),
        tasksCompleted: batch.reduce((sum, day) => sum + day.tasksCompleted, 0)
      });
    }
    return chunks;
  }

  function renderBarChart(selector, series, key, formatter) {
    const max = Math.max(1, ...series.map(item => item[key]));
    const hasValues = series.some(item => item[key] > 0);
    $(selector).innerHTML = `<div class="analytics-bars">${series.map(item => {
      const height = item[key] ? Math.max(3, Math.round(item[key] / max * 100)) : 2;
      const value = formatter(item[key]);
      const short = key === "focusSeconds" ? (item[key] >= 3600 ? `${Math.round(item[key] / 360) / 10}h` : `${Math.round(item[key] / 60)}m`) : String(item[key]);
      return `<div class="analytics-bar-cell" title="${escape(item.label)}: ${escape(value)}"><span class="analytics-bar-value">${item[key] ? escape(short) : ""}</span><div class="analytics-bar-track"><div class="analytics-bar" style="height:${height}%"></div></div><span class="analytics-bar-date">${escape(item.label)}</span></div>`;
    }).join("")}</div>${hasValues ? "" : '<p class="muted small analytics-empty-note">Nenhum registro neste período.</p>'}`;
  }

  function renderHabits(data) {
    const s = data.summary;
    const rate = s.habitRate === null ? 0 : s.habitRate;
    $("#analyticsHabitProgress").innerHTML = `<div class="analytics-habit-header"><strong>${s.habitRate === null ? "—" : `${rate}%`}</strong><p class="muted small">${s.habitsCompleted} de ${s.habitsPlanned} realizações previstas</p></div><div class="progress-track" role="progressbar" aria-label="Hábitos realizados" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${rate}"><span style="width:${rate}%"></span></div>`;
    const firstWeekday = new Date(`${data.daily[0].date}T12:00:00Z`).getUTCDay();
    const offset = (firstWeekday + 6) % 7;
    const cells = Array.from({ length: offset }, () => '<span class="analytics-heat-day pad"></span>');
    for (const day of data.daily) {
      const value = day.habitsPlanned ? day.habitsCompleted / day.habitsPlanned : null;
      const level = value === null ? "off" : value === 0 ? "low" : value < 0.5 ? "mid" : value < 1 ? "high" : "full";
      cells.push(`<span class="analytics-heat-day ${level}" title="${escape(dateLabel(day.date))}: ${day.habitsCompleted}/${day.habitsPlanned} hábitos" aria-label="${day.date}: ${day.habitsCompleted} de ${day.habitsPlanned} hábitos"></span>`);
    }
    $("#analyticsHabitHeatmap").innerHTML = `<div class="analytics-heat-scroll"><div class="analytics-heat-grid">${cells.join("")}</div></div><div class="analytics-heat-legend"><span>Sem registro</span><span class="analytics-heat-day low"></span><span class="analytics-heat-day mid"></span><span class="analytics-heat-day high"></span><span class="analytics-heat-day full"></span><span>100%</span></div>`;
  }

  function renderCategories(data) {
    const total = data.categories.reduce((sum, item) => sum + item.seconds, 0);
    const container = $("#analyticsCategories");
    if (!total) {
      container.innerHTML = '<div class="empty"><strong>Nenhum compromisso agendado</strong>Crie compromissos com blocos no calendário para ver a distribuição.</div>';
      return;
    }
    container.innerHTML = data.categories.map(item => {
      const fraction = Math.round(item.seconds / total * 100);
      return `<div class="analytics-category-item"><div class="analytics-category-top"><span><i class="analytics-dot" style="background:${escape(item.color)}"></i>${escape(item.name)}</span><strong>${escape(minutesLabel(item.seconds))}</strong></div><div class="analytics-category-track"><div style="background:${escape(item.color)};width:${fraction}%"></div></div><span class="muted small">${fraction}% do tempo reservado · ${item.events} ocorrência(s)</span></div>`;
    }).join("");
  }

  function renderHours(data) {
    const byHour = new Map(data.focusHours.map(item => [item.hour, item.seconds]));
    const top = Math.max(1, ...byHour.values());
    const container = $("#analyticsHours");
    container.innerHTML = `<div class="analytics-hour-bars">${Array.from({ length: 24 }, (_, hour) => {
      const seconds = byHour.get(hour) || 0;
      return `<div class="analytics-hour-cell" title="${String(hour).padStart(2, "0")}:00 — ${escape(minutesLabel(seconds))}"><div class="analytics-hour-bar" style="height:${Math.max(2, seconds / top * 100)}%"></div><span>${hour % 3 === 0 ? `${String(hour).padStart(2, "0")}h` : ""}</span></div>`;
    }).join("")}</div>${data.focusHours.length ? "" : '<p class="muted small analytics-empty-note">Ainda não há sessões registradas.</p>'}`;
  }

  function renderFocusTasks(data) {
    const container = $("#analyticsFocusTasks");
    if (!data.focusTasks.length) {
      container.innerHTML = '<div class="empty"><strong>Nenhuma sessão finalizada</strong>Vincule sessões a tarefas no Modo Foco para construir este histórico.</div>';
      return;
    }
    container.innerHTML = data.focusTasks.map((item, index) => `<div class="analytics-focus-item"><span class="analytics-focus-rank">${index + 1}</span><div class="analytics-focus-name"><strong>${escape(item.title)}</strong><span class="muted small">${item.sessions} sessão(ões)</span></div><strong>${escape(minutesLabel(item.seconds))}</strong></div>`).join("");
  }

  function renderInsights(data) {
    const container = $("#analyticsInsights");
    if (data.pythonOnline && data.insight?.insights?.length) {
      container.innerHTML = data.insight.insights.map(item => `<p class="analytics-insight"><span aria-hidden="true">✦</span>${escape(item)}</p>`).join("");
      $("#analyticsMethod").textContent = data.insight.method;
      return;
    }
    const text = data.summary.focusSessions || data.summary.tasksCompleted || data.summary.habitsPlanned ? "Seus indicadores acima estão disponíveis. Inicie o serviço Python com Pandas para gerar interpretações complementares." : "Comece registrando tarefas, hábitos ou sessões de foco. Seus padrões vão aparecer conforme você utiliza o Pattern.";
    container.innerHTML = `<p class="analytics-insight"><span aria-hidden="true">✦</span>${escape(text)}</p>`;
    $("#analyticsMethod").textContent = "Análises complementares indisponíveis. Os indicadores principais são calculados pelo servidor Node.js.";
  }

  async function load(days) {
    const id = ++request;
    const status = $("#analyticsStatus");
    status.textContent = "Atualizando seus indicadores...";
    document.querySelectorAll("[data-analytics-days]").forEach(button => {
      const selected = Number(button.dataset.analyticsDays) === days;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    try {
      const response = await fetch(`/api/analytics?days=${days}`);
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar os indicadores.");
      if (id !== request) return;
      renderCards(data);
      const grouped = buckets(data.daily, days);
      renderBarChart("#analyticsFocusChart", grouped, "focusSeconds", minutesLabel);
      renderBarChart("#analyticsTasksChart", grouped, "tasksCompleted", value => `${value} tarefa(s)`);
      renderHabits(data);
      renderCategories(data);
      renderHours(data);
      renderFocusTasks(data);
      renderInsights(data);
      status.textContent = `De ${dateLabel(data.period.from)} a ${dateLabel(data.period.to)} · ${data.pythonOnline ? "Análises Python conectadas" : "Indicadores disponíveis sem Python"}`;
    } catch (error) {
      if (id !== request) return;
      status.textContent = error.message || "Falha ao carregar dados.";
    }
  }

  document.querySelectorAll("[data-analytics-days]").forEach(button => button.addEventListener("click", () => load(Number(button.dataset.analyticsDays))));
  load(30);
})();
