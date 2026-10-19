"use strict";
const {randomUUID}=require("node:crypto");
const {routineSchema}=require("../validation/habits");
const {validate}=require("../middleware/api");

module.exports = function createRoutinesController(db) {
const list = async (req, res) => {
    const { rows } = await db.query(
      "SELECT id,name,period,description FROM routines WHERE user_id=$1 ORDER BY created_at ASC",
      [req.user.id],
    );
    res.json(rows);
  };
const create = async (req, res) => {
    const body = validate(routineSchema, req, res);
    if (!body) return;
    const { rows } = await db.query(
      "INSERT INTO routines(id,user_id,name,period,description) VALUES($1,$2,$3,$4,$5) RETURNING id,name,period,description",
      [randomUUID(), req.user.id, body.name, body.period, body.description],
    );
    res.status(201).json(rows[0]);
  };
const update = async (req, res) => {
    const body = validate(routineSchema, req, res);
    if (!body) return;
    const { rows } = await db.query(
      "UPDATE routines SET name=$1,period=$2,description=$3 WHERE id=$4 AND user_id=$5 RETURNING id,name,period,description",
      [body.name, body.period, body.description, req.params.id, req.user.id],
    );
    if (!rows[0])
      return res.status(404).json({ error: "Rotina não encontrada." });
    res.json(rows[0]);
  };
const remove = async (req, res) => {
    const result = await db.query(
      "DELETE FROM routines WHERE id=$1 AND user_id=$2",
      [req.params.id, req.user.id],
    );
    if (!result.rowCount)
      return res.status(404).json({ error: "Rotina não encontrada." });
    res.json({ ok: true });
  };
return {list,create,update,remove};
};
