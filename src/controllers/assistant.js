"use strict";
const {rateLimit}=require("express-rate-limit");
const {validate}=require("../middleware/api");
const assistant=require("../services/assistant");

const assistantLimiter=rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:"draft-7",legacyHeaders:false,message:{error:"Muitas perguntas em pouco tempo. Tente novamente em alguns minutos."}});

module.exports=function createAssistantController(db){
  const status=(_req,res)=>res.json({available:Boolean(process.env.OPENAI_API_KEY?.trim()),model:process.env.OPENAI_MODEL||"gpt-6-luna"});
  const chat=async(req,res)=>{
    const body=validate(assistant.messageSchema,req,res);
    if(!body)return;
    if(!process.env.OPENAI_API_KEY?.trim())return res.status(503).json({error:"Configure OPENAI_API_KEY no .env para ativar o assistente."});
    try{
      const context=body.includeContext?await assistant.collectContext(db,req.user.id):null;
      const result=await assistant.generateAnswer({message:body.message,history:body.history,context});
      return res.json({...result,usedContext:body.includeContext});
    }catch(error){
      if(error instanceof assistant.AssistantError)return res.status(error.status).json({error:error.message});
      throw error;
    }
  };
  return {status,chat,assistantLimiter};
};
