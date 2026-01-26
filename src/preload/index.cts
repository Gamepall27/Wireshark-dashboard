import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("netscope", {
  pickPcap: () => ipcRenderer.invoke("pickPcap"),
  importPcap: (filePath: string) => ipcRenderer.invoke("importPcap", filePath),
  listInterfaces: () => ipcRenderer.invoke("listInterfaces"),
  startLiveCapture: (interfaceName: string) =>
    ipcRenderer.invoke("startLiveCapture", interfaceName),
  stopLiveCapture: () => ipcRenderer.invoke("stopLiveCapture"),
  getLiveStatus: () => ipcRenderer.invoke("getLiveStatus"),
  getImports: () => ipcRenderer.invoke("getImports"),
  getDevices: (importId: number) => ipcRenderer.invoke("getDevices", importId),
  getAllDevices: (importId: number) => ipcRenderer.invoke("getAllDevices", importId),
  getDeviceTotals: (importId: number) => ipcRenderer.invoke("getDeviceTotals", importId),
  getDeviceDetails: (importId: number, deviceId: number) =>
    ipcRenderer.invoke("getDeviceDetails", importId, deviceId),
  getCategories: (importId: number, deviceId: number) =>
    ipcRenderer.invoke("getCategories", importId, deviceId),
  getFlows: (importId: number, deviceId: number, filters: unknown) =>
    ipcRenderer.invoke("getFlows", importId, deviceId, filters),
  getImportFlows: (importId: number) => ipcRenderer.invoke("getImportFlows", importId),
  renameDevice: (deviceId: number, newName: string) =>
    ipcRenderer.invoke("renameDevice", deviceId, newName)
});
