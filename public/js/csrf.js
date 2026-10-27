"use strict";
(() => {
  const originalFetch=window.fetch.bind(window);
  const unsafe=new Set(["POST","PUT","PATCH","DELETE"]);
  const token=()=>{
    const match=document.cookie.match(/(?:^|;\s*)pattern_csrf=([^;]*)/);
    return match?decodeURIComponent(match[1]):null;
  };
  window.fetch=(input,options={})=>{
    const method=String(options.method||(input instanceof Request?input.method:"GET")).toUpperCase();
    const target=new URL(input instanceof Request?input.url:String(input),window.location.href);
    if(!unsafe.has(method)||target.origin!==window.location.origin||!target.pathname.startsWith("/api/")){
      return originalFetch(input,options);
    }
    const headers=new Headers(options.headers||(input instanceof Request?input.headers:undefined));
    const current=token();
    if(current)headers.set("x-csrf-token",current);
    return originalFetch(input,{...options,headers});
  };
})();
