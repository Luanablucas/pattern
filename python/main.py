from datetime import date
from statistics import mean
from typing import List

from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="Pattern Insights", version="0.10.0")


class DailyCount(BaseModel):
    date: date
    completed: int = Field(ge=0)


class AnalysisInput(BaseModel):
    days: List[DailyCount] = Field(min_length=1, max_length=90)


@app.get('/health')
def health():
    return {'status': 'ok'}


@app.post('/analyze')
def analyze(payload: AnalysisInput):
    days = payload.days
    total = sum(day.completed for day in days)
    average = round(mean(day.completed for day in days), 1)
    active_days = sum(day.completed > 0 for day in days)
    if total == 0:
        insight = 'Você ainda não concluiu tarefas nesse período. Os insights aparecem conforme você usa o Pattern.'
    elif len(days) < 7:
        insight = 'Os registros estão começando. Continue usando o Pattern para encontrar tendências.'
    else:
        insight = f'Você concluiu {total} tarefa(s) em {active_days} dia(s) do período. Média de {average} por dia.'

    return {
        'totalCompleted': total,
        'averagePerDay': average,
        'activeDays': active_days,
        'insight': insight,
        'method': 'Contagem de tarefas marcadas como concluídas por dia. Não representa produtividade total.'
    }


class HabitDay(BaseModel):
    date: date
    scheduled: int = Field(ge=0)
    completed: int = Field(ge=0)


class HabitAnalysisInput(BaseModel):
    days: List[HabitDay] = Field(min_length=28, max_length=28)


@app.post('/analyze-habits')
def analyze_habits(payload: HabitAnalysisInput):
    days = payload.days
    if any(day.completed > day.scheduled for day in days):
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail='Conclusões acima do planejado.')
    current, previous = days[14:], days[:14]
    current_total = sum(d.scheduled for d in current)
    current_done = sum(d.completed for d in current)
    previous_total = sum(d.scheduled for d in previous)
    previous_done = sum(d.completed for d in previous)
    rate = round(100 * current_done / current_total) if current_total else None
    previous_rate = round(100 * previous_done / previous_total) if previous_total else None
    variation = rate - previous_rate if rate is not None and previous_rate is not None else None
    if current_total == 0:
        insight = 'Nenhuma realização foi planejada para as últimas duas semanas.'
    elif current_done == 0:
        insight = 'Ainda não há conclusões registradas nas últimas duas semanas.'
    elif variation is None:
        insight = f'Você registrou {current_done} de {current_total} realizações planejadas nas últimas duas semanas.'
    elif variation > 0:
        insight = f'Sua consistência registrada subiu {variation} ponto(s) percentual(is) em relação às duas semanas anteriores.'
    elif variation < 0:
        insight = f'Sua consistência registrada caiu {abs(variation)} ponto(s) percentual(is) em relação às duas semanas anteriores.'
    else:
        insight = 'Sua taxa de realização registrada se manteve estável entre os dois períodos.'
    return {
        'planned': current_total,
        'completed': current_done,
        'completionRate': rate,
        'previousRate': previous_rate,
        'changePoints': variation,
        'insight': insight,
        'method': 'Proporção de ocorrências previstas e marcadas nos últimos 14 dias. O cálculo usa a programação atual dos hábitos.'
    }

class AnalyticsDay(BaseModel):
    date: date
    tasksCompleted: int = Field(ge=0)
    focusSeconds: int = Field(ge=0)
    focusSessions: int = Field(ge=0)
    habitsPlanned: int = Field(ge=0)
    habitsCompleted: int = Field(ge=0)


class DashboardAnalysisInput(BaseModel):
    days: List[AnalyticsDay] = Field(min_length=14, max_length=180)
    periodDays: int = Field(ge=7, le=90)


@app.post('/analyze-dashboard')
def analyze_dashboard(payload: DashboardAnalysisInput):
    import pandas as pd

    if len(payload.days) != payload.periodDays * 2:
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail='O período não corresponde aos registros.')
    if any(row.habitsCompleted > row.habitsPlanned for row in payload.days):
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail='Conclusões de hábitos acima do previsto.')
    frame = pd.DataFrame([row.model_dump() for row in payload.days]).sort_values('date')
    current = frame.tail(payload.periodDays)
    previous = frame.head(payload.periodDays)
    focus = int(current['focusSeconds'].sum())
    previous_focus = int(previous['focusSeconds'].sum())
    tasks = int(current['tasksCompleted'].sum())
    planned = int(current['habitsPlanned'].sum())
    done = int(current['habitsCompleted'].sum())
    consistency = round(100 * done / planned) if planned else None
    active = current[current['focusSeconds'] > 0]
    insights = []
    if focus:
        hours = round(focus / 3600, 1)
        insights.append(f'Você registrou {hours} hora(s) de foco em {len(active)} dia(s) do período.')
        if previous_focus:
            variation = round((focus - previous_focus) / previous_focus * 100)
            if variation > 0:
                insights.append(f'O tempo de foco registrado aumentou {variation}% em relação ao período anterior.')
            elif variation < 0:
                insights.append(f'O tempo de foco registrado diminuiu {abs(variation)}% em relação ao período anterior.')
            else:
                insights.append('O tempo de foco registrado se manteve estável em relação ao período anterior.')
    if planned:
        insights.append(f'Você registrou {done} de {planned} realizações de hábitos previstas ({consistency}%).')
    if tasks:
        insights.append(f'{tasks} conclusão(ões) de tarefas foram registradas no período.')
    if not insights:
        insights.append('Ainda há poucos registros neste período. Acompanhe tarefas, hábitos ou sessões de foco para formar seu histórico.')
    return {
        'insights': insights,
        'focusActiveDays': int(len(active)),
        'habitRate': consistency,
        'method': 'Análise descritiva com Pandas, sem previsão ou inferência causal. As sessões são atribuídas ao dia de término e os hábitos usam a programação atual.'
    }


class PlanningSession(BaseModel):
    hour: int = Field(ge=0, le=23)
    seconds: int = Field(ge=0, le=86400)


class PlanningPatternsInput(BaseModel):
    sessions: List[PlanningSession] = Field(max_length=1200)


@app.post('/planning-patterns')
def planning_patterns(payload: PlanningPatternsInput):
    import pandas as pd

    if not payload.sessions:
        return {'sampleCount': 0, 'preferredHours': [], 'method': 'Histórico insuficiente.'}
    frame = pd.DataFrame([row.model_dump() for row in payload.sessions])
    frame = frame[(frame['hour'] >= 8) & (frame['hour'] <= 19) & (frame['seconds'] > 0)]
    if len(frame) < 5:
        return {'sampleCount': int(len(frame)), 'preferredHours': [], 'method': 'Menos de cinco sessões em horários de planejamento.'}
    ranked = (frame.groupby('hour').size().reset_index(name='count')
              .sort_values(['count', 'hour'], ascending=[False, True]))
    return {
        'sampleCount': int(len(frame)),
        'preferredHours': [int(hour) for hour in ranked['hour'].head(3)],
        'method': 'Frequência de horários de início de sessões de foco nos últimos 90 dias, com Pandas. Não é previsão de produtividade.'
    }
