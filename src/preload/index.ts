import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("netscope", {
  pickPcap: () => ipcRenderer.invoke("pickPcap"),
  importPcap: (filePath: string) => ipcRenderer.invoke("importPcap", filePath),
  getImports: () => ipcRenderer.invoke("getImports"),
  getDevices: (importId: number) => ipcRenderer.invoke("getDevices", importId),
  getDeviceDetails: (importId: number, deviceId: number) =>
    ipcRenderer.invoke("getDeviceDetails", importId, deviceId),
  getCategories: (importId: number, deviceId: number) =>
    ipcRenderer.invoke("getCategories", importId, deviceId),
  getFlows: (importId: number, deviceId: number, filters: unknown) =>
    ipcRenderer.invoke("getFlows", importId, deviceId, filters),
  renameDevice: (deviceId: number, newName: string) =>
    ipcRenderer.invoke("renameDevice", deviceId, newName)
});
