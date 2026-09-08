window.BRTrack=function(eventName,params){
const payload={event:eventName,ts:new Date().toISOString(),page:location.pathname,...(params||{})};
try{console.log("[BudgetReset]",payload)}catch(e){}
if(window.gtag){gtag("event",eventName,params||{});}
if(window.fbq){fbq("trackCustom",eventName,params||{});}
if(window.ttq){ttq.track(eventName,params||{});}
};
document.addEventListener("DOMContentLoaded",()=>BRTrack("page_view"));
