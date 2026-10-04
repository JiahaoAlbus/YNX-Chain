const {contextBridge,ipcRenderer}=require("electron");
contextBridge.exposeInMainWorld("frameQA",Object.freeze({
  fixture:()=>ipcRenderer.invoke("frame-qa:fixture"),
  decode:input=>ipcRenderer.invoke("frame-qa:decode",input),
  done:result=>ipcRenderer.send("frame-qa:done",result),
  stage:value=>ipcRenderer.send("frame-qa:stage",value),
}));
