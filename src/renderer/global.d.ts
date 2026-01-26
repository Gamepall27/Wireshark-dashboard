import { CategorySummary, DeviceDetails, DeviceSummary, FlowFilters, FlowRecord, ImportRecord } from "./types";

export {}; // ensure module

declare global {
  interface Window {
    netscope: {
      pickPcap: () => Promise<string | null>;
      importPcap: (filePath: string) => Promise<number>;
      getImports: () => Promise<ImportRecord[]>;
      getDevices: (importId: number) => Promise<DeviceSummary[]>;
      getDeviceDetails: (importId: number, deviceId: number) => Promise<DeviceDetails>;
      getCategories: (importId: number, deviceId: number) => Promise<CategorySummary[]>;
      getFlows: (
        importId: number,
        deviceId: number,
        filters: FlowFilters
      ) => Promise<FlowRecord[]>;
      renameDevice: (deviceId: number, newName: string) => Promise<void>;
    };
  }
}
