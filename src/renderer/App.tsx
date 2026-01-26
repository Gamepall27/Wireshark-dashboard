import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CategorySummary,
  DeviceDetails,
  DeviceSummary,
  FlowFilters,
  FlowRecord,
  ImportRecord
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

const formatBytes = (value: number) => {
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(value) / Math.log(1024));
  return `${(value / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
};

const formatDateTime = (value: string | null) =>
  value ? new Date(value).toLocaleString("de-DE") : "-";

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

  const refreshImports = useCallback(async () => {
    const items = await window.netscope.getImports();
    setImports(items);
    if (items.length && selectedImportId === null) {
      setSelectedImportId(items[0].id);
    }
  }, [selectedImportId]);

  useEffect(() => {
    refreshImports();
    const interval = setInterval(refreshImports, 2000);
    return () => clearInterval(interval);
  }, [refreshImports]);

  useEffect(() => {
    if (!selectedImportId) return;
    window.netscope.getDevices(selectedImportId).then(setDevices);
    setSelectedDeviceId(null);
    setDeviceDetails(null);
    setCategories([]);
    setFlows([]);
  }, [selectedImportId]);

  useEffect(() => {
    if (!selectedImportId || !selectedDeviceId) return;
    window.netscope.getDeviceDetails(selectedImportId, selectedDeviceId).then(data => {
      setDeviceDetails(data);
      setRenameValue(data.name);
    });
    window.netscope.getCategories(selectedImportId, selectedDeviceId).then(setCategories);
    window.netscope
      .getFlows(selectedImportId, selectedDeviceId, filters)
      .then(setFlows);
  }, [selectedImportId, selectedDeviceId, filters]);

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

  const handleRename = async () => {
    if (!selectedDeviceId || !renameValue.trim()) return;
    await window.netscope.renameDevice(selectedDeviceId, renameValue.trim());
    if (selectedImportId) {
      const updated = await window.netscope.getDevices(selectedImportId);
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
        <button
          onClick={handleImport}
          className="rounded bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400"
        >
          PCAP importieren
        </button>
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
            <h2 className="mb-3 text-sm font-semibold uppercase text-slate-400">Geräte</h2>
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
                  Wähle einen Import, um Geräte zu sehen.
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-4">
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
