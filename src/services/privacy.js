"use strict";

const datasets={
  tarefas:"SELECT * FROM tasks WHERE user_id=$1 ORDER BY created_at,id",
  ocorrenciasTarefas:"SELECT o.* FROM task_occurrences o JOIN tasks t ON t.id=o.task_id WHERE t.user_id=$1 ORDER BY o.occurrence_date,o.task_id",
  rotinas:"SELECT * FROM routines WHERE user_id=$1 ORDER BY created_at,id",
  habitos:"SELECT * FROM habits WHERE user_id=$1 ORDER BY created_at,id",
  registrosHabitos:"SELECT h.* FROM habit_entries h JOIN habits b ON b.id=h.habit_id WHERE b.user_id=$1 ORDER BY h.entry_date,h.habit_id",
  blocos:"SELECT * FROM event_categories WHERE user_id=$1 ORDER BY created_at,id",
  compromissos:"SELECT * FROM events WHERE user_id=$1 ORDER BY starts_at,id",
  ajustesCompromissos:"SELECT o.* FROM event_overrides o JOIN events e ON e.id=o.event_id WHERE e.user_id=$1 ORDER BY o.occurrence_date,o.event_id",
  cancelamentosCompromissos:"SELECT c.* FROM event_cancellations c JOIN events e ON e.id=c.event_id WHERE e.user_id=$1 ORDER BY c.occurrence_date,c.event_id",
  sessoesFoco:"SELECT * FROM focus_sessions WHERE user_id=$1 ORDER BY started_at,id",
  objetivos:"SELECT * FROM goals WHERE user_id=$1 ORDER BY created_at,id",
  etapasObjetivos:"SELECT s.* FROM goal_steps s JOIN goals g ON g.id=s.goal_id WHERE g.user_id=$1 ORDER BY s.position,s.id",
  historicoEtapas:"SELECT e.* FROM goal_step_events e JOIN goal_steps s ON s.id=e.step_id JOIN goals g ON g.id=s.goal_id WHERE g.user_id=$1 ORDER BY e.happened_at,e.id",
  vinculosTarefas:"SELECT l.* FROM goal_task_links l JOIN goals g ON g.id=l.goal_id WHERE g.user_id=$1 ORDER BY l.goal_id,l.task_id",
  vinculosHabitos:"SELECT l.* FROM goal_habit_links l JOIN goals g ON g.id=l.goal_id WHERE g.user_id=$1 ORDER BY l.goal_id,l.habit_id",
  sugestoesPlanejamento:"SELECT * FROM planning_suggestions WHERE user_id=$1 ORDER BY created_at,id",
  propostasAssistente:"SELECT id,action_type,arguments,status,created_at,expires_at,decided_at,created_id FROM ai_action_proposals WHERE user_id=$1 ORDER BY created_at,id"
};

async function exportData(db,userId){
  const client=await db.connect();
  try{
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const {rows}=await client.query(`SELECT id,name,email,email_verified_at,pending_email,theme_preference,created_at FROM users WHERE id=$1`,[userId]);
    if(!rows[0]){await client.query("ROLLBACK");return null;}
    const data={};
    for(const [label,sql] of Object.entries(datasets)){
      data[label]=(await client.query(sql,[userId])).rows;
    }
    await client.query("COMMIT");
    return {formato:"pattern-export",versao:1,geradoEm:new Date().toISOString(),conta:rows[0],dados:data,
      aviso:"Exportação de dados existentes no Pattern. Não inclui senhas, tokens, registros internos de sessões, logs do servidor ou cópias de segurança."};
  }catch(error){try{await client.query("ROLLBACK");}catch(_){}throw error;}
  finally{client.release();}
}

async function eraseAccount(db,userId,verifyPassword){
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    const result=await client.query("SELECT password_hash FROM users WHERE id=$1 FOR UPDATE",[userId]);
    if(!result.rows[0]){await client.query("ROLLBACK");return "missing";}
    if(!(await verifyPassword(result.rows[0].password_hash))){await client.query("ROLLBACK");return "invalid";}
    await client.query("DELETE FROM events WHERE user_id=$1",[userId]);
    const removed=await client.query("DELETE FROM users WHERE id=$1 RETURNING id",[userId]);
    if(removed.rowCount!==1)throw new Error("Falha ao excluir conta.");
    await client.query("COMMIT");
    return "deleted";
  }catch(error){try{await client.query("ROLLBACK");}catch(_){}throw error;}
  finally{client.release();}
}
module.exports={exportData,eraseAccount,datasets};
