import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearImportFlows,
  createImport,
  getCategories,
  getDeviceDetails,
  getDevices,
  getFlows,
  listImports,
  renameDevice,
  updateImportStatus,
  upsertFlow
} from "./db";
import { parsePcapStream } from "./parser";
import { FlowFilters } from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
};

const startImport = async (importId: number, filePath: string) => {
  updateImportStatus(importId, "processing");
  clearImportFlows(importId);
  try {
    await parsePcapStream(filePath, packet => {
      upsertFlow(importId, packet);
    });
    updateImportStatus(importId, "done");
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.includes("ENOENT")
          ? "tshark nicht gefunden. Bitte Wireshark installieren und tshark im PATH verfügbar machen."
          : error.message
        : String(error);
    updateImportStatus(importId, "failed", message);
  }
};

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle("pickPcap", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [
        { name: "PCAP/PCAPNG", extensions: ["pcap", "pcapng"] },
        { name: "Alle Dateien", extensions: ["*"] }
      ]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("importPcap", async (_event, filePath: string) => {
    const fileName = path.basename(filePath);
    const importId = createImport(filePath, fileName);
    setImmediate(() => startImport(importId, filePath));
    return importId;
  });

  ipcMain.handle("getImports", () => listImports());
  ipcMain.handle("getDevices", (_event, importId: number) => getDevices(importId));
  ipcMain.handle("getDeviceDetails", (_event, importId: number, deviceId: number) =>
    getDeviceDetails(importId, deviceId)
  );
  ipcMain.handle("getCategories", (_event, importId: number, deviceId: number) =>
    getCategories(importId, deviceId)
  );
  ipcMain.handle(
    "getFlows",
    (_event, importId: number, deviceId: number, filters: FlowFilters) =>
      getFlows(importId, deviceId, filters)
  );
  ipcMain.handle("renameDevice", (_event, deviceId: number, newName: string) =>
    renameDevice(deviceId, newName)
  );

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
