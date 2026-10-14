"""Serviço de análises do Pattern. Sem IA fictícia: apenas cálculos verificáveis."""
from datetime import date
from statistics import mean
from typing import List

from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="Pattern Insights", version="0.1.0")


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
