import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearImportFlows,
  createImport,
  getCategories,
  getDeviceDetails,
  getDevices,
  getAllDevices,
  getDeviceTotals,
  getFlows,
  getImportFlows,
  listImports,
  renameDevice,
  updateImportStatus,
  upsertFlow
} from "./db.js";
import { listCaptureInterfaces, startLiveCapture, parsePcapStream } from "./parser.js";
import { FlowFilters, ParsedPacket } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let liveCapture: {
  importId: number;
  interfaceName: string;
  stop: () => void;
  done: Promise<void>;
} | null = null;

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
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
    await parsePcapStream(filePath, (packet: ParsedPacket) => {
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

const startLiveImport = async (interfaceName: string) => {
  if (liveCapture) {
    throw new Error("Live capture already running.");
  }
  const importId = createImport(`live://${interfaceName}`, `Live: ${interfaceName}`);
  updateImportStatus(importId, "processing");
  clearImportFlows(importId);

  const live = startLiveCapture(interfaceName, packet => {
    upsertFlow(importId, packet);
  });

  liveCapture = {
    importId,
    interfaceName,
    stop: live.stop,
    done: live.done
  };

  live.done
    .then(() => {
      if (liveCapture?.importId === importId) {
        liveCapture = null;
      }
      updateImportStatus(importId, "done");
    })
    .catch(error => {
      if (liveCapture?.importId === importId) {
        liveCapture = null;
      }
      const message = error instanceof Error ? error.message : String(error);
      updateImportStatus(importId, "failed", message);
    });

  return importId;
};

const stopLiveImport = async () => {
  if (!liveCapture) return null;
  const { stop, done, importId } = liveCapture;
  stop();
  await done;
  return importId;
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

  ipcMain.handle("listInterfaces", async () => listCaptureInterfaces());
  ipcMain.handle("startLiveCapture", async (_event, interfaceName: string) =>
    startLiveImport(interfaceName)
  );
  ipcMain.handle("stopLiveCapture", async () => stopLiveImport());
  ipcMain.handle("getLiveStatus", () => ({
    running: Boolean(liveCapture),
    importId: liveCapture?.importId ?? null,
    interfaceName: liveCapture?.interfaceName ?? null
  }));

  ipcMain.handle("getImports", () => listImports());
  ipcMain.handle("getDevices", (_event, importId: number) => getDevices(importId));
  ipcMain.handle("getAllDevices", (_event, importId: number) => getAllDevices(importId));
  ipcMain.handle("getDeviceTotals", (_event, importId: number) => getDeviceTotals(importId));
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
  ipcMain.handle("getImportFlows", (_event, importId: number) => getImportFlows(importId));
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
