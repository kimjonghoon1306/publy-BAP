import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("electron", {
  getBotStatus:    () => ipcRenderer.invoke("get-bot-status"),
  getBotSecret:    () => ipcRenderer.invoke("get-bot-secret"),
  registerUser:    (userId: string) => ipcRenderer.invoke("register-user", userId),
  unregisterUser:  (userId: string) => ipcRenderer.invoke("unregister-user", userId),
  openPreview:     (html: string) => ipcRenderer.invoke("open-preview", html),
});
