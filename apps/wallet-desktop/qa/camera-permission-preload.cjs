const {contextBridge,ipcRenderer}=require("electron");
contextBridge.exposeInMainWorld("permissionQA",Object.freeze({
 prepare:mode=>ipcRenderer.invoke("permission-qa:prepare",mode),
 row:value=>ipcRenderer.send("permission-qa:row",value),
 done:value=>ipcRenderer.send("permission-qa:done",value),
}));
