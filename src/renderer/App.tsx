import { useCallback, useEffect, useMemo, useState } from"react";
import {
  CategorySummary,
  DeviceAnalytics,
  DeviceDetails,
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
} from"./types";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  Scatter,
  ScatterChart,
  ResponsiveContainer,
  Sankey,
  Treemap,
  Tooltip,
  XAxis,
  YAxis
} from"recharts";

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
  if (value === 0) return"0 B";
  const units = ["B","KB","MB","GB","TB"];
  const i = Math.floor(Math.log(value) / Math.log(1024));
  return `${(value / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
};

const formatDateTime = (value: string | null) => {
  if (!value) return"-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ?"-" : parsed.toLocaleString("de-DE");
};

const DAY_LABELS = ["So","Mo","Di","Mi","Do","Fr","Sa"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

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
  const [deviceAnalytics, setDeviceAnalytics] = useState<DeviceAnalytics | null>(null);
  const [importAnalytics, setImportAnalytics] = useState<ImportAnalytics | null>(null);
  const [deviceLog, setDeviceLog] = useState<DeviceLogEntry[]>([]);
  const [logOffset, setLogOffset] = useState(0);
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
        setSelectedInterface(current => current || list[0]?.name ||"");
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
      const [detail, categoryList, flowList] = await Promise.all([
        window.netscope.getDeviceDetails(selectedImportId, selectedDeviceId),
        window.netscope.getCategories(selectedImportId, selectedDeviceId),
        window.netscope.getFlows(selectedImportId, selectedDeviceId, filters)
      ]);
      setDeviceDetails(detail);
      setRenameValue(detail.name);
      setCategories(categoryList);
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

  const refreshImportAnalytics = useCallback(async () => {
    if (!selectedImportId) return;
    const analytics = await window.netscope.getImportAnalytics(selectedImportId);
    setImportAnalytics(analytics);
  }, [selectedImportId]);

  const refreshDeviceAnalytics = useCallback(async () => {
    if (!selectedImportId || !selectedDeviceId) return;
    const analytics = await window.netscope.getDeviceAnalytics(
      selectedImportId,
      selectedDeviceId
    );
    setDeviceAnalytics(analytics);
  }, [selectedDeviceId, selectedImportId]);

  const refreshDeviceLog = useCallback(
    async (reset = true) => {
      if (!selectedImportId || !selectedDeviceId) return;
      const entries = await window.netscope.getDeviceLog(
        selectedImportId,
        selectedDeviceId,
        200,
        0
      );
      setDeviceLog(entries);
      if (reset) setLogOffset(0);
    },
    [selectedDeviceId, selectedImportId]
  );

  useEffect(() => {
    refreshImportTraffic();
    if (!selectedImportId) return;
    const interval = setInterval(refreshImportTraffic, 4000);
    return () => clearInterval(interval);
  }, [refreshImportTraffic, selectedImportId]);

  useEffect(() => {
    refreshImportAnalytics();
  }, [refreshImportAnalytics, selectedImportId]);

  useEffect(() => {
    if (!selectedImportId) return;
    const shouldPoll = liveStatus.running && liveStatus.importId === selectedImportId;
    if (!shouldPoll) return;
    const interval = setInterval(refreshImportAnalytics, 15000);
    return () => clearInterval(interval);
  }, [liveStatus, refreshImportAnalytics, selectedImportId]);

  useEffect(() => {
    if (!selectedImportId) return;
    setSelectedDeviceId(null);
    setDeviceDetails(null);
    setCategories([]);
    setFlows([]);
    setDeviceAnalytics(null);
    setDeviceLog([]);
    setLogOffset(0);
    setImportAnalytics(null);
    setShowAllDevices(false);
  }, [selectedImportId]);

  useEffect(() => {
    if (!selectedImportId || !selectedDeviceId) return;
    setDeviceAnalytics(null);
    setDeviceLog([]);
    setLogOffset(0);
    refreshDeviceAnalytics();
    refreshDeviceLog();
  }, [
    refreshDeviceAnalytics,
    refreshDeviceLog,
    selectedDeviceId,
    selectedImportId
  ]);

  useEffect(() => {
    if (!selectedImportId || !selectedDeviceId) return;
    const shouldPoll =
      liveStatus.running && liveStatus.importId === selectedImportId && logOffset === 0;
    if (!shouldPoll) return;
    const analyticsInterval = setInterval(refreshDeviceAnalytics, 15000);
    const logInterval = setInterval(() => refreshDeviceLog(true), 10000);
    return () => {
      clearInterval(analyticsInterval);
      clearInterval(logInterval);
    };
  }, [
    liveStatus,
    logOffset,
    refreshDeviceAnalytics,
    refreshDeviceLog,
    selectedDeviceId,
    selectedImportId
  ]);

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

  const handleLoadMoreLogs = async () => {
    if (!selectedImportId || !selectedDeviceId) return;
    const nextOffset = logOffset + 200;
    const more = await window.netscope.getDeviceLog(
      selectedImportId,
      selectedDeviceId,
      200,
      nextOffset
    );
    setDeviceLog(current => [...current, ...more]);
    setLogOffset(nextOffset);
  };

  const deviceProtocolSeries = useMemo(() => {
    const series = deviceAnalytics?.protocolSeries ?? [];
    return [...series]
      .sort((a, b) => a.time.localeCompare(b.time))
      .slice(-180);
  }, [deviceAnalytics]);

  const categorySeries = useMemo(() => {
    return categories.map(category => ({
      name: category.name,
      bytes: category.bytes_total
    }));
  }, [categories]);

  const deviceTrafficSeries = useMemo(() => {
    return deviceProtocolSeries.map(point => ({
      time: point.time,
      bytes: point.tcp + point.udp + point.other
    }));
  }, [deviceProtocolSeries]);

  const importTrafficSeries = useMemo(() => {
    return [...importFlows]
      .sort((a, b) => a.start_time.localeCompare(b.start_time))
      .map(flow => ({ time: flow.start_time, bytes: flow.bytes_total }));
  }, [importFlows]);

  const totalImportBytes = useMemo(
    () => importFlows.reduce((sum, flow) => sum + flow.bytes_total, 0),
    [importFlows]
  );

  const importProtocolSeries = useMemo(() => {
    const series = importAnalytics?.protocolSeries ?? [];
    return [...series]
      .sort((a, b) => a.time.localeCompare(b.time))
      .slice(-180);
  }, [importAnalytics]);

  const filteredFlows = useMemo(() => {
    return [...flows].sort((a, b) => b.bytes_total - a.bytes_total);
  }, [flows]);

  const portTreemapKey = useMemo(() => {
    if (!deviceAnalytics) return"empty";
    return deviceAnalytics.portTreemap
      .map(item => `${item.name}:${item.size}`)
      .join("|");
  }, [deviceAnalytics]);

  const deviceSankey = useMemo(() => {
    if (!deviceAnalytics) return null;
    const nodes = new Map<string, number>();
    deviceAnalytics.commPairs.forEach(pair => {
      if (!nodes.has(pair.source)) nodes.set(pair.source, nodes.size);
      if (!nodes.has(pair.target)) nodes.set(pair.target, nodes.size);
    });
    return {
      nodes: Array.from(nodes.keys()).map(name => ({ name })),
      links: deviceAnalytics.commPairs.map(pair => ({
        source: nodes.get(pair.source) ?? 0,
        target: nodes.get(pair.target) ?? 0,
        value: pair.bytes
      }))
    };
  }, [deviceAnalytics]);

  const deviceHeatmap = useMemo(() => {
    if (!deviceAnalytics) return { max: 0, map: new Map<string, number>() };
    const map = new Map<string, number>();
    let max = 0;
    deviceAnalytics.heatmap.forEach(cell => {
      const key = `${cell.day}-${cell.hour}`;
      map.set(key, cell.bytes);
      if (cell.bytes > max) max = cell.bytes;
    });
    return { max, map };
  }, [deviceAnalytics]);

  const importHeatmap = useMemo(() => {
    if (!importAnalytics) return { max: 0, map: new Map<string, number>() };
    const map = new Map<string, number>();
    let max = 0;
    importAnalytics.heatmap.forEach(cell => {
      const key = `${cell.day}-${cell.hour}`;
      map.set(key, cell.bytes);
      if (cell.bytes > max) max = cell.bytes;
    });
    return { max, map };
  }, [importAnalytics]);

  const lifecycleRange = useMemo(() => {
    if (!importAnalytics || !importAnalytics.lifecycle.length) return null;
    const times = importAnalytics.lifecycle.flatMap(entry => [
      new Date(entry.first_seen).getTime(),
      new Date(entry.last_seen).getTime()
    ]);
    const min = Math.min(...times);
    const max = Math.max(...times);
    return { min, max, span: Math.max(1, max - min) };
  }, [importAnalytics]);

  return (
    <div className="relative h-full text-slate-100">
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute -left-20 top-24 h-64 w-64 rounded-full bg-cyan-400/20 blur-[120px]" />
        <div className="absolute right-10 top-10 h-72 w-72 rounded-full bg-indigo-500/20 blur-[140px]" />
      </div>
      <div className="relative z-10">
        <header className="flex items-center justify-between border-b border-white/10 bg-slate-950/60 px-6 py-4 backdrop-blur">
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
              className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-sm"
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
              className="rounded-full bg-emerald-400/90 px-3 py-1 text-xs font-semibold text-slate-950 shadow-[0_6px_18px_rgba(52,211,153,0.3)] hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-emerald-500/30"
            >
              Start
            </button>
            <button
              onClick={handleStopLive}
              disabled={!liveStatus.running}
              className="rounded-full bg-white/10 px-3 py-1 text-xs text-slate-200 hover:bg-white/20 disabled:cursor-not-allowed disabled:bg-white/10"
            >
              Stop
            </button>
            {liveStatus.running && (
              <span className="text-xs text-emerald-300">
                running {liveStatus.interfaceName ??""}
              </span>
            )}
          </div>
          <button
            onClick={handleImport}
            className="rounded-full bg-cyan-500/90 px-4 py-2 text-sm font-semibold text-slate-950 shadow-[0_8px_24px_rgba(34,211,238,0.35)] hover:bg-cyan-400"
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
          <div className="panel p-4">
            <h2 className="mb-3 panel-title">Imports</h2>
            <div className="space-y-3">
              {imports.map(item => (
                <button
                  key={item.id}
                  onClick={() => setSelectedImportId(item.id)}
                  className={`w-full rounded border px-3 py-2 text-left text-sm transition ${
                    selectedImportId === item.id
                      ?"border-indigo-400 bg-indigo-500/10"
                      :"border-slate-800 bg-slate-900/60 hover:border-slate-700"
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
                  Noch keine Imports. Klicke auf"PCAP importieren".
                </div>
              )}
            </div>
          </div>

          <div className="panel p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h2 className="panel-title">Ger?te</h2>
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
                className="glass-button"
              >
                {showAllDevices ?"Top 10" :"Alle"}
              </button>
            </div>
            <div className="space-y-2">
              {devices.map(device => (
                <button
                  key={device.id}
                  onClick={() => setSelectedDeviceId(device.id)}
                  className={`w-full rounded border px-3 py-2 text-left text-sm transition ${
                    selectedDeviceId === device.id
                      ?"border-indigo-400 bg-indigo-500/10"
                      :"border-slate-800 bg-slate-900/60 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{device.name}</span>
                    <span className="text-xs text-slate-400">
                      {formatBytes(device.total_bytes)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {device.vendor ??"Unbekannter Hersteller"}
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
          <div className="panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Gesamttraffic</h2>
                <p className="text-sm text-slate-400">
                  {selectedImportId
                    ? `${formatBytes(totalImportBytes)} gesamt`
                    :"Waehle einen Import"}
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
                  <XAxis
                    dataKey="time"
                    stroke="#94a3b8"
                    tickFormatter={value =>
                      new Date(value).toLocaleTimeString("de-DE", {
                        hour:"2-digit",
                        minute:"2-digit"
                      })
                    }
                  />
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

          <div className="panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Import Insights</h2>
                <p className="text-sm text-slate-400">
                  {importAnalytics ?"Protokolle, Heatmap, Talker und Peaks" :"Lade Daten..."}
                </p>
              </div>
              {isImportLoading && (
                <span className="text-xs text-slate-400">aktualisiert...</span>
              )}
            </div>
            <div className="mt-4 grid grid-cols-12 gap-4 grid-flow-dense">
              <div className="col-span-12 h-60 xl:col-span-8">
                <h3 className="mb-2 text-sm font-semibold text-slate-400">
                  Protokoll-Mix ueber Zeit
                </h3>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={importProtocolSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="time" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" />
                    <Tooltip />
                    <Legend />
                    <Area type="monotone" dataKey="tcp" stackId="1" stroke="#38bdf8" fill="#38bdf8" />
                    <Area type="monotone" dataKey="udp" stackId="1" stroke="#22d3ee" fill="#22d3ee" />
                    <Area type="monotone" dataKey="other" stackId="1" stroke="#a78bfa" fill="#a78bfa" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="col-span-12 rounded border border-slate-800 bg-slate-950/60 p-3 xl:col-span-4">
                <h3 className="mb-2 text-sm font-semibold text-slate-400">
                  Traffic Heatmap (Tag/Stunde)
                </h3>
                <div className="space-y-1 text-[10px] text-slate-500">
                  {DAY_LABELS.map((day, dayIndex) => (
                    <div key={day} className="flex items-center gap-1">
                      <span className="w-6">{day}</span>
                      <div
                        className="grid flex-1 gap-[2px]"
                        style={{ gridTemplateColumns:"repeat(24, minmax(0, 1fr))" }}
                      >
                        {HOURS.map(hour => {
                          const value = importHeatmap.map.get(`${dayIndex}-${hour}`) ?? 0;
                          const intensity = importHeatmap.max
                            ? Math.min(0.9, value / importHeatmap.max)
                            : 0;
                          return (
                            <div
                              key={hour}
                              title={`${hour}:00 · ${formatBytes(value)}`}
                              className="h-3 rounded"
                              style={{
                                backgroundColor: `rgba(34, 211, 238, ${intensity})`,
                                outline:"1px solid rgba(15, 23, 42, 0.6)"
                              }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="col-span-12 h-56 md:col-span-6 xl:col-span-4">
                <h3 className="mb-2 text-sm font-semibold text-slate-400">
                  Talkers vs. Listeners
                </h3>
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis type="number" dataKey="out_bytes" name="Out" stroke="#94a3b8" />
                    <YAxis type="number" dataKey="in_bytes" name="In" stroke="#94a3b8" />
                    <Tooltip cursor={{ strokeDasharray:"3 3" }} />
                    <Scatter data={importAnalytics?.talkers ?? []} fill="#38bdf8" />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <div className="col-span-12 rounded border border-slate-800 bg-slate-950/60 p-3 xl:col-span-8">
                <h3 className="mb-2 text-sm font-semibold text-slate-400">Geraete-Lebenszyklus</h3>
                <div className="space-y-2 text-xs text-slate-300">
                  {(importAnalytics?.lifecycle ?? []).map(entry => {
                    if (!lifecycleRange) return null;
                    const start = new Date(entry.first_seen).getTime();
                    const end = new Date(entry.last_seen).getTime();
                    const left = ((start - lifecycleRange.min) / lifecycleRange.span) * 100;
                    const width = Math.max(2, ((end - start) / lifecycleRange.span) * 100);
                    return (
                      <div key={entry.id} className="flex items-center gap-3">
                        <span className="w-40 truncate text-slate-400">{entry.name}</span>
                        <div className="relative h-2 flex-1 rounded bg-slate-800">
                          <div
                            className="absolute top-0 h-2 rounded bg-indigo-400"
                            style={{ left: `${left}%`, width: `${width}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-slate-500">
                          {formatDateTime(entry.first_seen)} – {formatDateTime(entry.last_seen)}
                        </span>
                      </div>
                    );
                  })}
                  {!importAnalytics?.lifecycle?.length && (
                    <div className="text-slate-500">Keine Geraete-Daten.</div>
                  )}
                </div>
              </div>
              <div className="col-span-12 rounded border border-slate-800 bg-slate-950/60 p-3 md:col-span-6 xl:col-span-4">
                <h3 className="mb-2 text-sm font-semibold text-slate-400">Burst Detection</h3>
                <div className="space-y-2 text-sm">
                  {(importAnalytics?.bursts ?? []).slice(0, 6).map(burst => (
                    <div key={burst.time} className="flex items-center justify-between">
                      <span className="text-slate-400">{formatDateTime(burst.time)}</span>
                      <span className="text-slate-200">{formatBytes(burst.bytes)}</span>
                    </div>
                  ))}
                  {!importAnalytics?.bursts?.length && (
                    <div className="text-sm text-slate-500">Keine Peaks erkannt.</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Device Dashboard</h2>
                <p className="text-sm text-slate-400">
                  {deviceDetails
                    ? `${deviceDetails.name} · ${formatBytes(deviceDetails.total_bytes)}`
                    :"Waehle ein Geraet"}
                </p>
              </div>
              {deviceDetails && (
                <div className="flex items-center gap-2">
                  <input
                    value={renameValue}
                    onChange={event => setRenameValue(event.target.value)}
                    className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-sm"
                  />
                  <button
                    onClick={handleRename}
                    className="rounded-full bg-white/10 px-3 py-1 text-sm text-slate-100 hover:bg-white/20"
                  >
                    Umbenennen
                  </button>
                </div>
              )}
            </div>
            {deviceDetails && (
              <div className="mt-4 grid grid-cols-12 gap-4 grid-flow-dense">
                <div className="col-span-12 h-64 xl:col-span-8">
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
                      <XAxis
                        dataKey="time"
                        stroke="#94a3b8"
                        tickFormatter={value =>
                          new Date(value).toLocaleTimeString("de-DE", {
                            hour:"2-digit",
                            minute:"2-digit"
                          })
                        }
                      />
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
                <div className="col-span-12 h-64 xl:col-span-4">
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
                <div className="col-span-12 rounded border border-slate-800 bg-slate-950/60 p-3 md:col-span-6 xl:col-span-4 overflow-auto">
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
                <div className="col-span-12 h-64 xl:col-span-8">
                  <h3 className="mb-2 text-sm font-semibold text-slate-400">
                    Protokoll-Mix (Geraet)
                  </h3>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={deviceProtocolSeries}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="time" stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" />
                      <Tooltip />
                      <Legend />
                      <Area type="monotone" dataKey="tcp" stackId="1" stroke="#60a5fa" fill="#60a5fa" />
                      <Area type="monotone" dataKey="udp" stackId="1" stroke="#22d3ee" fill="#22d3ee" />
                      <Area type="monotone" dataKey="other" stackId="1" stroke="#f472b6" fill="#f472b6" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="col-span-12 rounded border border-slate-800 bg-slate-950/60 p-3 md:col-span-6 xl:col-span-4">
                  <h3 className="mb-2 text-sm font-semibold text-slate-400">Kategorien Donut</h3>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Tooltip />
                        <Pie
                          data={categorySeries}
                          dataKey="bytes"
                          nameKey="name"
                          innerRadius={40}
                          outerRadius={70}
                          fill="#38bdf8"
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="col-span-12 rounded border border-slate-800 bg-slate-950/60 p-3">
                  <h3 className="mb-2 text-sm font-semibold text-slate-400">
                    Kommunikationspaare (Sankey)
                  </h3>
                  <div className="h-64">
                    {deviceSankey ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <Sankey
                          data={deviceSankey}
                          nodePadding={24}
                          nodeWidth={12}
                          linkCurvature={0.5}
                        />
                      </ResponsiveContainer>
                    ) : (
                      <div className="text-sm text-slate-500">Keine Daten.</div>
                    )}
                  </div>
                </div>
                <div className="col-span-12 h-56 md:col-span-4">
                  <h3 className="mb-2 text-sm font-semibold text-slate-400">
                    Flow-Dauer Verteilung
                  </h3>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={deviceAnalytics?.durationHistogram ?? []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="label" stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" />
                      <Tooltip />
                      <Bar dataKey="count" fill="#fbbf24" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="col-span-12 h-56 md:col-span-4">
                  <h3 className="mb-2 text-sm font-semibold text-slate-400">
                    Port-Treemap
                  </h3>
                  <ResponsiveContainer width="100%" height="100%">
                    <Treemap
                      key={portTreemapKey}
                      data={deviceAnalytics?.portTreemap ?? []}
                      dataKey="size"
                      stroke="#0f172a"
                      fill="#38bdf8"
                      isAnimationActive={false}
                      aspectRatio={4 / 3}
                    />
                  </ResponsiveContainer>
                </div>
                <div className="col-span-12 h-56 md:col-span-4">
                  <h3 className="mb-2 text-sm font-semibold text-slate-400">
                    DNS Top-Domains
                  </h3>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={deviceAnalytics?.topDomains ?? []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="domain" stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" />
                      <Tooltip />
                      <Bar dataKey="bytes" fill="#34d399" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="col-span-12 h-56 md:col-span-4">
                  <h3 className="mb-2 text-sm font-semibold text-slate-400">
                    Neue Domains pro Tag
                  </h3>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={deviceAnalytics?.newDomainsSeries ?? []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="day" stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" />
                      <Tooltip />
                      <Line type="monotone" dataKey="count" stroke="#f97316" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="col-span-12 rounded border border-slate-800 bg-slate-950/60 p-3 md:col-span-4 overflow-auto">
                  <h3 className="mb-2 text-sm font-semibold text-slate-400">
                    Kategorien Drilldown
                  </h3>
                  <div className="space-y-3 text-sm">
                    {(deviceAnalytics?.categoryDrilldown ?? []).map(category => (
                      <div key={category.category}>
                        <div className="text-xs uppercase text-slate-500">
                          {category.category}
                        </div>
                        <div className="space-y-1">
                          {category.hosts.map(host => (
                            <div key={host.host} className="flex justify-between text-xs">
                              <span className="text-slate-300">{host.host}</span>
                              <span className="text-slate-500">
                                {formatBytes(host.bytes)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    {!deviceAnalytics?.categoryDrilldown?.length && (
                      <div className="text-sm text-slate-500">Keine Host-Daten.</div>
                    )}
                  </div>
                </div>
                <div className="col-span-12 rounded border border-slate-800 bg-slate-950/60 p-3 md:col-span-4 overflow-auto">
                  <h3 className="mb-2 text-sm font-semibold text-slate-400">Risiko-Indikatoren</h3>
                  <div className="space-y-2 text-sm">
                    {(deviceAnalytics?.riskIndicators ?? []).map(indicator => (
                      <div key={indicator.label} className="flex items-center justify-between">
                        <span className="text-slate-300">{indicator.label}</span>
                        <span
                          className={`rounded px-2 py-0.5 text-xs ${
                            indicator.severity ==="high"
                              ?"bg-red-500/20 text-red-300"
                              : indicator.severity ==="med"
                              ?"bg-amber-500/20 text-amber-300"
                              :"bg-emerald-500/20 text-emerald-300"
                          }`}
                        >
                          {indicator.value}
                        </span>
                      </div>
                    ))}
                    {!deviceAnalytics?.riskIndicators?.length && (
                      <div className="text-sm text-slate-500">Keine Auffaelligkeiten.</div>
                    )}
                  </div>
                </div>
                <div className="col-span-12 rounded border border-slate-800 bg-slate-950/60 p-3 md:col-span-4 overflow-auto">
  <h3 className="mb-2 text-sm font-semibold text-slate-400">
    Externe Targets
  </h3>
  <div className="space-y-2 text-sm">
    {(deviceAnalytics?.externalTargets ?? []).map(target => (
      <div key={target.ip} className="flex items-center justify-between">
        <span className="text-slate-300">{target.ip}</span>
        <span className="text-slate-500">{formatBytes(target.bytes)}</span>
      </div>
    ))}
    {!deviceAnalytics?.externalTargets?.length && (
      <div className="text-sm text-slate-500">Keine externen Ziele.</div>
    )}
  </div>
</div>
                <div className="col-span-12 rounded border border-slate-800 bg-slate-950/60 p-3">
                  <h3 className="mb-2 text-sm font-semibold text-slate-400">
                    Geraete-Heatmap (Tag/Stunde)
                  </h3>
                  <div className="space-y-1 text-[10px] text-slate-500">
                    {DAY_LABELS.map((day, dayIndex) => (
                      <div key={day} className="flex items-center gap-1">
                        <span className="w-6">{day}</span>
                        <div
                          className="grid flex-1 gap-[2px]"
                          style={{ gridTemplateColumns:"repeat(24, minmax(0, 1fr))" }}
                        >
                          {HOURS.map(hour => {
                            const value = deviceHeatmap.map.get(`${dayIndex}-${hour}`) ?? 0;
                            const intensity = deviceHeatmap.max
                              ? Math.min(0.9, value / deviceHeatmap.max)
                              : 0;
                            return (
                              <div
                                key={hour}
                                title={`${hour}:00 · ${formatBytes(value)}`}
                                className="h-3 rounded"
                                style={{
                                  backgroundColor: `rgba(99, 102, 241, ${intensity})`,
                                  outline:"1px solid rgba(15, 23, 42, 0.6)"
                                }}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="panel-title">
                Flows (nach Bytes)
              </h3>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <input
                  placeholder="Host enthaelt"
                  value={filters.host ??""}
                  onChange={event =>
                    setFilters(current => ({
                      ...current,
                      host: event.target.value || undefined
                    }))
                  }
                  className="rounded-full border border-white/10 bg-white/5 px-2 py-1"
                />
                <input
                  placeholder="Port"
                  type="number"
                  value={filters.port ??""}
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
                  value={filters.proto ??""}
                  onChange={event =>
                    setFilters(current => ({
                      ...current,
                      proto: event.target.value || undefined
                    }))
                  }
                  className="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1"
                />
                <select
                  value={filters.categoryId ??""}
                  onChange={event =>
                    setFilters(current => ({
                      ...current,
                      categoryId: event.target.value ? Number(event.target.value) : undefined
                    }))
                  }
                  className="rounded-full border border-white/10 bg-white/5 px-2 py-1"
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
                      <td className="px-2 py-2 text-slate-200">{flow.host ??"-"}</td>
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
                        {flow.category_name ??"-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filteredFlows.length && (
                <div className="mt-4 text-sm text-slate-500">
                  Keine Flows fuer das gewaehlte Geraet.
                </div>
              )}
            </div>
          </div>
        

          <div className="panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="panel-title">
                LOG (Device-spezifisch)
              </h3>
              <button
                onClick={handleLoadMoreLogs}
                disabled={!deviceDetails}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-300 hover:border-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Mehr laden
              </button>
            </div>
            <div className="mt-4 max-h-96 overflow-auto">
              <table className="min-w-full text-xs">
                <thead className="text-left text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="px-2 py-1">Time</th>
                    <th className="px-2 py-1">Source</th>
                    <th className="px-2 py-1">Destination</th>
                    <th className="px-2 py-1">Proto</th>
                    <th className="px-2 py-1">Len</th>
                    <th className="px-2 py-1">Host</th>
                    <th className="px-2 py-1">MAC</th>
                  </tr>
                </thead>
                <tbody>
                  {deviceLog.map((row, idx) => (
                    <tr key={`${row.timestamp}-${idx}`} className="border-t border-slate-800">
                      <td className="px-2 py-2 text-slate-300">
                        {formatDateTime(row.timestamp)}
                      </td>
                      <td className="px-2 py-2 text-slate-400">
                        {row.src_ip}:{row.src_port}
                      </td>
                      <td className="px-2 py-2 text-slate-400">
                        {row.dst_ip}:{row.dst_port}
                      </td>
                      <td className="px-2 py-2 text-slate-400">{row.proto ??"-"}</td>
                      <td className="px-2 py-2 text-slate-200">{formatBytes(row.bytes)}</td>
                      <td className="px-2 py-2 text-slate-400">{row.host ??"-"}</td>
                      <td className="px-2 py-2 text-slate-500">
                        {row.src_mac ??"-"} {"->"} {row.dst_mac ??"-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!deviceLog.length && (
                <div className="mt-4 text-sm text-slate-500">
                  Keine Logs fuer das gewaehlte Geraet.
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
      </div>
    </div>
  );
}
