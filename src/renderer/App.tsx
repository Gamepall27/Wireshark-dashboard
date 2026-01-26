import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CategorySummary,
  DeviceDetails,
  DeviceSummary,
  DeviceTotals,
  FlowFilters,
  FlowRecord,
  ImportRecord,
  ImportFlow,
  LiveInterface,
  LiveStatus
} from "./types";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

const DEFAULT_FILTERS: FlowFilters = {};
const DEFAULT_LIVE_STATUS: LiveStatus = {
  running: false,
  importId: null,
  interfaceName: null
};
const DEFAULT_DEVICE_TOTALS: DeviceTotals = {
  device_count: 0,
  total_bytes: 0,
  total_packets: 0
};

const formatBytes = (value: number) => {
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(value) / Math.log(1024));
  return `${(value / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
};

const formatDateTime = (value: string | null) => {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString("de-DE");
};

export default function App() {
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [selectedImportId, setSelectedImportId] = useState<number | null>(null);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);
  const [deviceDetails, setDeviceDetails] = useState<DeviceDetails | null>(null);
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [flows, setFlows] = useState<FlowRecord[]>([]);
  const [filters, setFilters] = useState<FlowFilters>(DEFAULT_FILTERS);
  const [renameValue, setRenameValue] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [interfaces, setInterfaces] = useState<LiveInterface[]>([]);
  const [selectedInterface, setSelectedInterface] = useState("");
  const [liveStatus, setLiveStatus] = useState<LiveStatus>(DEFAULT_LIVE_STATUS);
  const [importFlows, setImportFlows] = useState<ImportFlow[]>([]);
  const [isDeviceLoading, setIsDeviceLoading] = useState(false);
  const [isImportLoading, setIsImportLoading] = useState(false);
  const [showAllDevices, setShowAllDevices] = useState(false);
  const [deviceTotals, setDeviceTotals] = useState<DeviceTotals>(DEFAULT_DEVICE_TOTALS);

  const refreshImports = useCallback(async () => {
    const [items, status] = await Promise.all([
      window.netscope.getImports(),
      window.netscope.getLiveStatus()
    ]);
    setImports(items);
    setLiveStatus(status);
    if (items.length && selectedImportId === null) {
      setSelectedImportId(items[0].id);
    }
  }, [selectedImportId]);

  useEffect(() => {
    window.netscope
      .listInterfaces()
      .then(list => {
        setInterfaces(list);
        setSelectedInterface(current => current || list[0]?.name || "");
      })
      .catch(error => {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      });
  }, []);

  useEffect(() => {
    refreshImports();
    const interval = setInterval(refreshImports, 4000);
    return () => clearInterval(interval);
  }, [refreshImports]);

  const refreshDeviceData = useCallback(async () => {
    if (!selectedImportId) return;
    setIsDeviceLoading(true);
    try {
      const [deviceList, totals] = await Promise.all([
        showAllDevices
          ? window.netscope.getAllDevices(selectedImportId)
          : window.netscope.getDevices(selectedImportId),
        window.netscope.getDeviceTotals(selectedImportId)
      ]);
      setDevices(deviceList);
      setDeviceTotals(totals);
      if (!selectedDeviceId) return;
      const detail = await window.netscope.getDeviceDetails(selectedImportId, selectedDeviceId);
      setDeviceDetails(detail);
      setRenameValue(detail.name);
      const categoryList = await window.netscope.getCategories(selectedImportId, selectedDeviceId);
      setCategories(categoryList);
      const flowList = await window.netscope.getFlows(selectedImportId, selectedDeviceId, filters);
      setFlows(flowList);
    } finally {
      setIsDeviceLoading(false);
    }
  }, [filters, selectedDeviceId, selectedImportId, showAllDevices]);

  useEffect(() => {
    refreshDeviceData();
    if (!selectedImportId) return;
    const interval = setInterval(refreshDeviceData, 4000);
    return () => clearInterval(interval);
  }, [refreshDeviceData, selectedImportId]);

  const refreshImportTraffic = useCallback(async () => {
    if (!selectedImportId) return;
    setIsImportLoading(true);
    try {
      const flowList = await window.netscope.getImportFlows(selectedImportId);
      setImportFlows(flowList);
    } finally {
      setIsImportLoading(false);
    }
  }, [selectedImportId]);

  useEffect(() => {
    refreshImportTraffic();
    if (!selectedImportId) return;
    const interval = setInterval(refreshImportTraffic, 4000);
    return () => clearInterval(interval);
  }, [refreshImportTraffic, selectedImportId]);

  useEffect(() => {
    if (!selectedImportId) return;
    setSelectedDeviceId(null);
    setDeviceDetails(null);
    setCategories([]);
    setFlows([]);
    setShowAllDevices(false);
  }, [selectedImportId]);

  const handleImport = async () => {
    setErrorMessage(null);
    const filePath = await window.netscope.pickPcap();
    if (!filePath) return;
    try {
      await window.netscope.importPcap(filePath);
      await refreshImports();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const handleStartLive = async () => {
    if (!selectedInterface) {
      setErrorMessage("No capture interface selected.");
      return;
    }
    setErrorMessage(null);
    try {
      const importId = await window.netscope.startLiveCapture(selectedInterface);
      await refreshImports();
      setSelectedImportId(importId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const handleStopLive = async () => {
    setErrorMessage(null);
    try {
      const importId = await window.netscope.stopLiveCapture();
      await refreshImports();
      if (importId) setSelectedImportId(importId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const handleRename = async () => {
    if (!selectedDeviceId || !renameValue.trim()) return;
    await window.netscope.renameDevice(selectedDeviceId, renameValue.trim());
    if (selectedImportId) {
      const updated = showAllDevices
        ? await window.netscope.getAllDevices(selectedImportId)
        : await window.netscope.getDevices(selectedImportId);
      setDevices(updated);
      const detail = await window.netscope.getDeviceDetails(
        selectedImportId,
        selectedDeviceId
      );
      setDeviceDetails(detail);
    }
  };

  const deviceTrafficSeries = useMemo(() => {
    const map = new Map<string, number>();
    flows.forEach(flow => {
      const key = new Date(flow.start_time).toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit"
      });
      map.set(key, (map.get(key) ?? 0) + flow.bytes_total);
    });
    return Array.from(map.entries()).map(([time, bytes]) => ({ time, bytes }));
  }, [flows]);

  const importTrafficSeries = useMemo(() => {
    const map = new Map<string, number>();
    importFlows.forEach(flow => {
      const key = new Date(flow.start_time).toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit"
      });
      map.set(key, (map.get(key) ?? 0) + flow.bytes_total);
    });
    return Array.from(map.entries()).map(([time, bytes]) => ({ time, bytes }));
  }, [importFlows]);

  const totalImportBytes = useMemo(
    () => importFlows.reduce((sum, flow) => sum + flow.bytes_total, 0),
    [importFlows]
  );

  const categorySeries = useMemo(() => {
    return categories.map(category => ({
      name: category.name,
      bytes: category.bytes_total
    }));
  }, [categories]);

  const filteredFlows = useMemo(() => {
    return [...flows].sort((a, b) => b.bytes_total - a.bytes_total);
  }, [flows]);

  return (
    <div className="h-full bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <div>
          <h1 className="text-2xl font-semibold">netscope-electron</h1>
          <p className="text-sm text-slate-400">
            PCAP/PCAPNG Imports, Flow-Aggregation und Device-Analytics
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm">
            <span className="text-xs uppercase text-slate-500">Live</span>
            <select
              value={selectedInterface}
              onChange={event => setSelectedInterface(event.target.value)}
              disabled={liveStatus.running}
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
            >
              {interfaces.map(item => (
                <option key={item.id} value={item.name}>
                  {item.description ? `${item.description} (${item.name})` : item.name}
                </option>
              ))}
              {!interfaces.length && <option value="">No interfaces</option>}
            </select>
            <button
              onClick={handleStartLive}
              disabled={liveStatus.running || !selectedInterface}
              className="rounded bg-emerald-500 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-emerald-500/40"
            >
              Start
            </button>
            <button
              onClick={handleStopLive}
              disabled={!liveStatus.running}
              className="rounded bg-slate-800 px-3 py-1 text-xs text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-800/40"
            >
              Stop
            </button>
            {liveStatus.running && (
              <span className="text-xs text-emerald-300">
                running {liveStatus.interfaceName ?? ""}
              </span>
            )}
          </div>
          <button
            onClick={handleImport}
            className="rounded bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400"
          >
            PCAP importieren
          </button>
        </div>
      </header>

      {errorMessage && (
        <div className="mx-6 mt-4 rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
          {errorMessage}
        </div>
      )}

      <main className="grid h-[calc(100%-88px)] grid-cols-[320px_1fr] gap-4 p-6">
        <section className="space-y-4">
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase text-slate-400">Imports</h2>
            <div className="space-y-3">
              {imports.map(item => (
                <button
                  key={item.id}
                  onClick={() => setSelectedImportId(item.id)}
                  className={`w-full rounded border px-3 py-2 text-left text-sm transition ${
                    selectedImportId === item.id
                      ? "border-indigo-400 bg-indigo-500/10"
                      : "border-slate-800 bg-slate-900/60 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{item.file_name}</span>
                    <span className="text-xs text-slate-400">{item.status}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {formatDateTime(item.created_at)}
                  </div>
                  {item.error && (
                    <div className="mt-1 text-xs text-red-300">{item.error}</div>
                  )}
                </button>
              ))}
              {!imports.length && (
                <div className="text-sm text-slate-500">
                  Noch keine Imports. Klicke auf "PCAP importieren".
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold uppercase text-slate-400">Ger?te</h2>
                <p className="text-xs text-slate-500">
                  {showAllDevices
                    ? `${deviceTotals.device_count} Ger?te ? ${formatBytes(
                        deviceTotals.total_bytes
                      )}`
                    : `Top 10 ? ${deviceTotals.device_count} gesamt`}
                </p>
              </div>
              <button
                onClick={() => setShowAllDevices(current => !current)}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-300 hover:border-slate-600"
              >
                {showAllDevices ? "Top 10" : "Alle"}
              </button>
            </div>
            <div className="space-y-2">
              {devices.map(device => (
                <button
                  key={device.id}
                  onClick={() => setSelectedDeviceId(device.id)}
                  className={`w-full rounded border px-3 py-2 text-left text-sm transition ${
                    selectedDeviceId === device.id
                      ? "border-indigo-400 bg-indigo-500/10"
                      : "border-slate-800 bg-slate-900/60 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{device.name}</span>
                    <span className="text-xs text-slate-400">
                      {formatBytes(device.total_bytes)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {device.vendor ?? "Unbekannter Hersteller"}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Zuletzt: {formatDateTime(device.last_seen)}
                  </div>
                </button>
              ))}
              {!devices.length && (
                <div className="text-sm text-slate-500">
                  W?hle einen Import, um Ger?te zu sehen.
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Gesamttraffic</h2>
                <p className="text-sm text-slate-400">
                  {selectedImportId
                    ? `${formatBytes(totalImportBytes)} gesamt`
                    : "Wähle einen Import"}
                </p>
              </div>
              {liveStatus.running && (
                <span className="rounded bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-300">
                  live
                </span>
              )}
            </div>
            <div className="mt-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={importTrafficSeries}>
                  <defs>
                    <linearGradient id="importTraffic" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="time" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="bytes"
                    stroke="#22d3ee"
                    fillOpacity={1}
                    fill="url(#importTraffic)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Device Dashboard</h2>
                <p className="text-sm text-slate-400">
                  {deviceDetails
                    ? `${deviceDetails.name} · ${formatBytes(deviceDetails.total_bytes)}`
                    : "Wähle ein Gerät"}
                </p>
              </div>
              {deviceDetails && (
                <div className="flex items-center gap-2">
                  <input
                    value={renameValue}
                    onChange={event => setRenameValue(event.target.value)}
                    className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
                  />
                  <button
                    onClick={handleRename}
                    className="rounded bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700"
                  >
                    Umbenennen
                  </button>
                </div>
              )}
            </div>
            {deviceDetails && (
              <div className="mt-4 grid gap-4 xl:grid-cols-3">
                <div className="h-64 xl:col-span-2">
                  <h3 className="mb-2 text-sm font-semibold text-slate-400">
                    Traffic over time
                  </h3>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={deviceTrafficSeries}>
                      <defs>
                        <linearGradient id="traffic" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.8} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="time" stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" />
                      <Tooltip />
                      <Area
                        type="monotone"
                        dataKey="bytes"
                        stroke="#6366f1"
                        fillOpacity={1}
                        fill="url(#traffic)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="h-64">
                  <h3 className="mb-2 text-sm font-semibold text-slate-400">
                    Kategorienanteile
                  </h3>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={categorySeries}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="name" stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="bytes" fill="#22d3ee" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="rounded border border-slate-800 bg-slate-950/60 p-3">
                  <h3 className="mb-2 text-sm font-semibold text-slate-400">Kategorien</h3>
                  <div className="space-y-2 text-sm">
                    {categories.map(category => (
                      <div key={category.id} className="flex items-center justify-between">
                        <span>{category.name}</span>
                        <span className="text-slate-400">
                          {formatBytes(category.bytes_total)} · {category.percentage.toFixed(1)}%
                        </span>
                      </div>
                    ))}
                    {!categories.length && (
                      <div className="text-sm text-slate-500">Noch keine Kategorien.</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold uppercase text-slate-400">
                Flows (nach Bytes)
              </h3>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <input
                  placeholder="Host enthält"
                  value={filters.host ?? ""}
                  onChange={event =>
                    setFilters(current => ({
                      ...current,
                      host: event.target.value || undefined
                    }))
                  }
                  className="rounded border border-slate-700 bg-slate-950 px-2 py-1"
                />
                <input
                  placeholder="Port"
                  type="number"
                  value={filters.port ?? ""}
                  onChange={event =>
                    setFilters(current => ({
                      ...current,
                      port: event.target.value ? Number(event.target.value) : undefined
                    }))
                  }
                  className="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1"
                />
                <input
                  placeholder="Proto"
                  value={filters.proto ?? ""}
                  onChange={event =>
                    setFilters(current => ({
                      ...current,
                      proto: event.target.value || undefined
                    }))
                  }
                  className="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1"
                />
                <select
                  value={filters.categoryId ?? ""}
                  onChange={event =>
                    setFilters(current => ({
                      ...current,
                      categoryId: event.target.value ? Number(event.target.value) : undefined
                    }))
                  }
                  className="rounded border border-slate-700 bg-slate-950 px-2 py-1"
                >
                  <option value="">Alle Kategorien</option>
                  {categories.map(category => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-4 overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-2 py-1">Host</th>
                    <th className="px-2 py-1">Src</th>
                    <th className="px-2 py-1">Dst</th>
                    <th className="px-2 py-1">Proto</th>
                    <th className="px-2 py-1">Packets</th>
                    <th className="px-2 py-1">Bytes</th>
                    <th className="px-2 py-1">Kategorie</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFlows.map(flow => (
                    <tr key={flow.id} className="border-t border-slate-800">
                      <td className="px-2 py-2 text-slate-200">{flow.host ?? "-"}</td>
                      <td className="px-2 py-2 text-slate-400">
                        {flow.src_ip}:{flow.src_port}
                      </td>
                      <td className="px-2 py-2 text-slate-400">
                        {flow.dst_ip}:{flow.dst_port}
                      </td>
                      <td className="px-2 py-2 text-slate-400">{flow.proto}</td>
                      <td className="px-2 py-2 text-slate-400">{flow.packets}</td>
                      <td className="px-2 py-2 text-slate-200">
                        {formatBytes(flow.bytes_total)}
                      </td>
                      <td className="px-2 py-2 text-slate-400">
                        {flow.category_name ?? "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filteredFlows.length && (
                <div className="mt-4 text-sm text-slate-500">
                  Keine Flows für das gewählte Gerät.
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
