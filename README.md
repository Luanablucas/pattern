# ✳ Pattern — organize sua rotina, descubra seus padrões

Um projeto full-stack de organização pessoal, com **Node.js + Express + EJS**, **PostgreSQL** e um serviço independente de análises com **Python + FastAPI**.


## Endpoints principais

| Método | Endpoint | Função |
|---|---|---|
| POST | `/api/auth/register` | Criar conta |
| POST | `/api/auth/login` | Entrar |
| POST | `/api/auth/logout` | Sair |
| GET / POST | `/api/tasks` | Listar / criar tarefas |
| PUT / DELETE | `/api/tasks/:id` | Editar / excluir tarefas |
| PATCH | `/api/tasks/:id/toggle` | Concluir / reabrir tarefa |
| GET / POST | `/api/habits` | Listar / criar hábitos |
| POST | `/api/habits/:id/check` | Marcar / desmarcar um dia |
| DELETE | `/api/habits/:id` | Excluir hábito |
| GET / POST | `/api/events` | Listar / criar compromissos |
| DELETE | `/api/events/:id` | Excluir compromisso |
| GET | `/api/insights` | Consultar dados e análise |
| POST | `http://localhost:8001/analyze` | Serviço Python (interno) |


