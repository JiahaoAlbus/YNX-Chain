function reject(){throw Object.assign(new Error("Open an HTTP(S) DApp tab and invoke the extension action first."),{code:"ACTIVE_TAB_REQUIRED"})}

export function requireActiveDappTab(tab){
  if(!Number.isInteger(tab?.id)||typeof tab.url!=="string")reject();
  let url;try{url=new URL(tab.url)}catch{reject()}
  if(!["http:","https:"].includes(url.protocol)||url.username||url.password)reject();
  return Object.freeze({tabId:tab.id,origin:url.origin});
}

export function activeTabInjectionPlans(tabId){
  if(!Number.isInteger(tabId))reject();
  return Object.freeze([
    Object.freeze({target:Object.freeze({tabId}),files:Object.freeze(["content-script.js"])}),
    Object.freeze({target:Object.freeze({tabId}),world:"MAIN",files:Object.freeze(["page-provider.js"])}),
  ]);
}
