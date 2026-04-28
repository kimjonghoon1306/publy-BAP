import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("electron", {
  getBotStatus: () => ipcRenderer.invoke("get-bot-status"),
});
