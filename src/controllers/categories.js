"use strict";
const {randomUUID}=require("node:crypto");
const {categorySchema,categoryFields}=require("../validation/categories");
const {validate}=require("../middleware/api");

module.exports = function createCategoriesController(db) {
const list = async(req,res)=>{
  const {rows}=await db.query(`SELECT ${categoryFields} FROM event_categories WHERE user_id=$1 ORDER BY created_at ASC`,[req.user.id]);
  res.json(rows);
};
const create = async(req,res)=>{
  const b=validate(categorySchema,req,res); if(!b)return;
  try{
    const {rows}=await db.query(`INSERT INTO event_categories(id,user_id,name,color) VALUES($1,$2,$3,$4) RETURNING ${categoryFields}`,[randomUUID(),req.user.id,b.name,b.color]);
    res.status(201).json(rows[0]);
  } catch(e) {if(e.code==='23505') return res.status(409).json({error:'Você já tem um bloco com esse nome.'});throw e;}
};
const update = async(req,res)=>{
  const b=validate(categorySchema,req,res);if(!b)return;
  try{
    const {rows}=await db.query(`UPDATE event_categories SET name=$1,color=$2 WHERE id=$3 AND user_id=$4 RETURNING ${categoryFields}`,[b.name,b.color,req.params.id,req.user.id]);
    if(!rows[0])return res.status(404).json({error:'Bloco não encontrado.'});
    res.json(rows[0]);
  }catch(e){if(e.code==='23505')return res.status(409).json({error:'Você já tem um bloco com esse nome.'});throw e;}
};
const remove = async(req,res)=>{
  const used=(await db.query('SELECT 1 FROM events WHERE user_id=$1 AND category_id=$2 LIMIT 1',[req.user.id,req.params.id])).rowCount;
  const overrideUsed=(await db.query("SELECT 1 FROM event_overrides o JOIN events e ON e.id=o.event_id WHERE e.user_id=$1 AND o.category_id=$2 LIMIT 1",[req.user.id,req.params.id])).rowCount;
  if(used || overrideUsed)return res.status(409).json({error:'Este bloco possui compromissos. Mova-os para outro bloco antes de excluir.'});
  const result=await db.query('DELETE FROM event_categories WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);
  if(!result.rowCount)return res.status(404).json({error:'Bloco não encontrado.'});
  res.json({ok:true});
};
return {list,create,update,remove};
};
