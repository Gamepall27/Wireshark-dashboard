import {
  CategorySummary,
  DeviceDetails,
  DeviceAnalytics,
  DeviceLogEntry,
  DeviceSummary,
  DeviceTotals,
  FlowFilters,
  FlowRecord,
  ImportAnalytics,
  ImportRecord,
  ImportFlow,
  LiveInterface,
  LiveStatus
} from "./types";

export {}; // ensure module

declare global {
  interface Window {
    netscope: {
      pickPcap: () => Promise<string | null>;
      importPcap: (filePath: string) => Promise<number>;
      listInterfaces: () => Promise<LiveInterface[]>;
      startLiveCapture: (interfaceName: string) => Promise<number>;
      stopLiveCapture: () => Promise<number | null>;
      getLiveStatus: () => Promise<LiveStatus>;
      getImports: () => Promise<ImportRecord[]>;
      getDevices: (importId: number) => Promise<DeviceSummary[]>;
      getAllDevices: (importId: number) => Promise<DeviceSummary[]>;
      getDeviceTotals: (importId: number) => Promise<DeviceTotals>;
      getDeviceDetails: (importId: number, deviceId: number) => Promise<DeviceDetails>;
      getCategories: (importId: number, deviceId: number) => Promise<CategorySummary[]>;
      getFlows: (
        importId: number,
        deviceId: number,
        filters: FlowFilters
      ) => Promise<FlowRecord[]>;
      getImportFlows: (importId: number) => Promise<ImportFlow[]>;
      getDeviceLog: (
        importId: number,
        deviceId: number,
        limit?: number,
        offset?: number
      ) => Promise<DeviceLogEntry[]>;
      getDeviceAnalytics: (importId: number, deviceId: number) => Promise<DeviceAnalytics>;
      getImportAnalytics: (importId: number) => Promise<ImportAnalytics>;
      renameDevice: (deviceId: number, newName: string) => Promise<void>;
    };
  }
}
