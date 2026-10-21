"use strict";
(function(root){
  const choices=["light","dark","system"];
  const storageKey="pattern.theme.preference";
  const doc=root.document.documentElement;
  const media=root.matchMedia("(prefers-color-scheme: dark)");
  let stored="system";
  try{stored=root.localStorage.getItem(storageKey)||"system";}catch(_){ }
  let preference=choices.includes(doc.dataset.themePreference)?doc.dataset.themePreference:(choices.includes(stored)?stored:"system");
  function effective(value){return value==="system"?(media.matches?"dark":"light"):value;}
  function apply(){
    const active=effective(preference);
    doc.dataset.theme=active;
    doc.dataset.themePreference=preference;
    doc.style.colorScheme=active;
    const meta=root.document.querySelector('meta[name="theme-color"]');
    if(meta)meta.setAttribute("content",active==="dark"?"#181420":"#f8f7fc");
    root.document.querySelectorAll("[data-theme-select]").forEach(select=>{select.value=preference;});
  }
  function saveLocal(value){try{root.localStorage.setItem(storageKey,value);}catch(_){ }}
  async function setPreference(value){
    if(!choices.includes(value))return;
    const previous=preference;
    preference=value;
    apply();
    saveLocal(value);
    if(!root.document.body || !root.document.body.dataset.page)return;
    try{
      const response=await root.fetch("/api/theme",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({preference:value})});
      if(!response.ok)throw new Error("Falha ao salvar o tema.");
    }catch(_){
      if(preference===value){preference=previous;apply();saveLocal(previous);}
      const toast=root.document.getElementById("toast");
      if(toast){toast.textContent="Não foi possível salvar o tema. Tente novamente.";toast.classList.add("visible");root.setTimeout(()=>toast.classList.remove("visible"),3500);}
    }
  }
  if(media.addEventListener)media.addEventListener("change",()=>{if(preference==="system")apply();});
  else if(media.addListener)media.addListener(()=>{if(preference==="system")apply();});
  root.document.addEventListener("DOMContentLoaded",()=>{
    apply();
    root.document.querySelectorAll("[data-theme-select]").forEach(select=>select.addEventListener("change",()=>setPreference(select.value)));
    doc.classList.add("theme-ready");
  });
  apply();
  root.PatternTheme={getPreference:()=>preference,effective,setPreference,apply};
})(window);
