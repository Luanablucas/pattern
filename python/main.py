"""Serviço de análises do Pattern. Sem IA fictícia: apenas cálculos verificáveis."""
from datetime import date
from statistics import mean
from typing import List

from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="Pattern Insights", version="0.4.0")


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
    # Não sugerimos "melhor dia" com dados insuficientes.
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
