"use strict";
const {z}=require("zod");
const schema=z.object({preference:z.enum(["light","dark","system"])}).strict();
module.exports=function createThemeController(db){
  return {
    async read(req,res){
      const {rows}=await db.query("SELECT theme_preference AS preference FROM users WHERE id=$1",[req.user.id]);
      if(!rows[0])return res.status(404).json({error:"Usuário não encontrado."});
      res.set("Cache-Control","no-store").json(rows[0]);
    },
    async update(req,res){
      const result=schema.safeParse(req.body);
      if(!result.success)return res.status(400).json({error:"Escolha um tema válido."});
      const {rows}=await db.query("UPDATE users SET theme_preference=$1 WHERE id=$2 RETURNING theme_preference AS preference",[result.data.preference,req.user.id]);
      if(!rows[0])return res.status(404).json({error:"Usuário não encontrado."});
      res.set("Cache-Control","no-store").json(rows[0]);
    }
  };
};
