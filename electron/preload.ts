import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("electron", {
  getBotStatus: () => ipcRenderer.invoke("get-bot-status"),
  registerUser: (userId: string) => ipcRenderer.invoke("register-user", userId),
});
