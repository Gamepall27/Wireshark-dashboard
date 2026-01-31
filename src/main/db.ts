import Database from "better-sqlite3";
import { app } from "electron";
import path from "node:path";
import { FlowFilters, ImportStatus, ParsedPacket } from "./types.js";
import { categorizeTraffic } from "./rules.js";

let db: Database.Database | null = null;
const MAX_DEVICE_FLOWS = 25;
const importFlowVersion = new Map<number, number>();
const deviceFlowVersion = new Map<string, number>();
type RiskSeverity = "low" | "med" | "high";
type DeviceAnalyticsResult = {
  heatmap: Array<{ day: number; hour: number; bytes: number }>;
  protocolSeries: Array<{ time: string; tcp: number; udp: number; other: number }>;
  protocolTotals: Array<{ name: string; bytes: number }>;
  commPairs: Array<{ source: string; target: string; bytes: number }>;
  portTreemap: Array<{ name: string; size: number }>;
  durationHistogram: Array<{ label: string; count: number }>;
  topDomains: Array<{ domain: string; bytes: number }>;
  newDomainsSeries: Array<{ day: string; count: number }>;
  categoryDrilldown: Array<{ category: string; hosts: Array<{ host: string; bytes: number }> }>;
  bursts: Array<{ time: string; bytes: number }>;
  externalTargets: Array<{ ip: string; bytes: number }>;
  riskIndicators: Array<{ label: string; value: number; severity: RiskSeverity }>;
};
type ImportAnalyticsResult = {
  protocolSeries: Array<{ time: string; tcp: number; udp: number; other: number }>;
  heatmap: Array<{ day: number; hour: number; bytes: number }>;
  talkers: Array<{ device: string; out_bytes: number; in_bytes: number }>;
  lifecycle: Array<{
    id: number;
    name: string;
    first_seen: string;
    last_seen: string;
    total_bytes: number;
  }>;
  bursts: Array<{ time: string; bytes: number }>;
};
const importAnalyticsCache = new Map<number, { version: number; value: ImportAnalyticsResult }>();
const deviceAnalyticsCache = new Map<string, { version: number; value: DeviceAnalyticsResult }>();

const bumpVersion = (map: Map<string | number, number>, key: string | number) => {
  map.set(key, (map.get(key) ?? 0) + 1);
};

const deviceKey = (importId: number, deviceId: number) => `${importId}:${deviceId}`;
const protoBucket = (proto: string | null) => (proto === "tcp" ? "tcp" : proto === "udp" ? "udp" : "other");
const MAX_LOG_ROWS = 5000;
const ANALYTICS_WINDOW_MINUTES = 180;

const toDateKey = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

const toMinuteKey = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 16);
};

const cutoffIso = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString();
const cutoffMinute = (minutes: number) =>
  new Date(Date.now() - minutes * 60000).toISOString().slice(0, 16);

const upsertTrafficBuckets = (
  importId: number,
  deviceId: number,
  minute: string,
  bytes: number,
  proto: string | null
) => {
  const database = ensureDb();
  const protoKey = protoBucket(proto);
  database
    .prepare(
      `INSERT INTO traffic_buckets (import_id, device_id, minute, bytes_total, packets)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(import_id, device_id, minute)
       DO UPDATE SET
         bytes_total = bytes_total + excluded.bytes_total,
         packets = packets + 1`
    )
    .run(importId, deviceId, minute, bytes);

  database
    .prepare(
      `INSERT INTO traffic_buckets_proto (import_id, device_id, minute, proto, bytes_total)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(import_id, device_id, minute, proto)
       DO UPDATE SET
         bytes_total = bytes_total + excluded.bytes_total`
    )
    .run(importId, deviceId, minute, protoKey, bytes);
};

const isPrivateIp = (ip: string | null) => {
  if (!ip) return false;
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    return (
      lower === "::1" ||
      lower.startsWith("fe80:") ||
      lower.startsWith("fc") ||
      lower.startsWith("fd")
    );
  }
  const parts = ip.split(".").map(part => Number(part));
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
};

const buildDeviceName = (mac: string | null, ip: string | null, fallback: string) => {
  if (mac) return `Device ${mac.replace(/:/g, "").slice(-4).toUpperCase()}`;
  if (ip) return `IP ${ip}`;
  return `IP ${fallback}`;
};

const isAutoName = (name: string, deviceIp: string | null, fallback: string) =>
  name === buildDeviceName(null, deviceIp, fallback) || /^Device\s[0-9A-F]{4}$/.test(name);

const ensureDb = () => {
  if (db) return db;
  const dbPath = path.join(app.getPath("userData"), "netscope.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      finished_at TEXT,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      mac TEXT,
      vendor TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS device_ips (
      device_id INTEGER NOT NULL,
      ip TEXT NOT NULL,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      UNIQUE(device_id, ip)
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      UNIQUE(device_id, name)
    );

    CREATE TABLE IF NOT EXISTS flows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER NOT NULL,
      device_id INTEGER NOT NULL,
      category_id INTEGER,
      direction TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      src_ip TEXT,
      dst_ip TEXT,
      src_port INTEGER,
      dst_port INTEGER,
      proto TEXT,
      host TEXT,
      packets INTEGER NOT NULL,
      bytes_total INTEGER NOT NULL,
      UNIQUE(import_id, device_id, src_ip, dst_ip, src_port, dst_port, proto)
    );

    CREATE TABLE IF NOT EXISTS packet_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER NOT NULL,
      device_id INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      src_ip TEXT,
      dst_ip TEXT,
      src_port INTEGER,
      dst_port INTEGER,
      proto TEXT,
      host TEXT,
      src_mac TEXT,
      dst_mac TEXT,
      bytes INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS traffic_buckets (
      import_id INTEGER NOT NULL,
      device_id INTEGER NOT NULL,
      minute TEXT NOT NULL,
      bytes_total INTEGER NOT NULL,
      packets INTEGER NOT NULL,
      PRIMARY KEY(import_id, device_id, minute)
    );

    CREATE TABLE IF NOT EXISTS traffic_buckets_proto (
      import_id INTEGER NOT NULL,
      device_id INTEGER NOT NULL,
      minute TEXT NOT NULL,
      proto TEXT NOT NULL,
      bytes_total INTEGER NOT NULL,
      PRIMARY KEY(import_id, device_id, minute, proto)
    );

    CREATE INDEX IF NOT EXISTS idx_packet_logs_import_device_time
      ON packet_logs (import_id, device_id, timestamp);

    CREATE INDEX IF NOT EXISTS idx_flows_import
      ON flows (import_id);
    CREATE INDEX IF NOT EXISTS idx_flows_import_device
      ON flows (import_id, device_id);
    CREATE INDEX IF NOT EXISTS idx_flows_import_time
      ON flows (import_id, start_time);
    CREATE INDEX IF NOT EXISTS idx_device_ips_device
      ON device_ips (device_id);
    CREATE INDEX IF NOT EXISTS idx_traffic_buckets_import_device
      ON traffic_buckets (import_id, device_id, minute);
    CREATE INDEX IF NOT EXISTS idx_traffic_buckets_proto_import_device
      ON traffic_buckets_proto (import_id, device_id, minute);
  `);
  return db;
};

export const createImport = (filePath: string, fileName: string) => {
  const database = ensureDb();
  const now = new Date().toISOString();
  const stmt = database.prepare(
    `INSERT INTO imports (file_path, file_name, status, created_at)
     VALUES (?, ?, ?, ?)`
  );
  const info = stmt.run(filePath, fileName, "queued", now);
  return Number(info.lastInsertRowid);
};

export const updateImportStatus = (
  importId: number,
  status: ImportStatus,
  error: string | null = null
) => {
  const database = ensureDb();
  const finishedAt = status === "processing" || status === "queued" ? null : new Date().toISOString();
  database
    .prepare(
      `UPDATE imports SET status = ?, finished_at = COALESCE(?, finished_at), error = ? WHERE id = ?`
    )
    .run(status, finishedAt, error, importId);
};

export const listImports = () => {
  const database = ensureDb();
  return database
    .prepare(`SELECT * FROM imports ORDER BY created_at DESC`)
    .all();
};

const resolveDevice = (
  packet: ParsedPacket
): { deviceId: number; host: string | null; categoryId: number | null } => {
  const database = ensureDb();
  const now = packet.timestamp;
  const identifier =
    packet.src_mac ?? packet.dst_mac ?? packet.src_ip ?? packet.dst_ip ?? "unknown";
  const deviceMac = packet.src_mac ?? packet.dst_mac ?? null;
  const deviceIp = packet.src_ip ?? packet.dst_ip ?? null;
  const detectedName = packet.device_name?.trim() || null;

  let device = null as null | { id: number; name: string; mac: string | null };
  if (deviceMac) {
    const found = database
      .prepare(`SELECT id, name, mac FROM devices WHERE mac = ?`)
      .get(deviceMac) as { id: number; name: string; mac: string | null } | undefined;
    device = found ?? null;
  }

  if (!device && deviceIp) {
    const found = database
      .prepare(
        `SELECT devices.id, devices.name, devices.mac FROM devices
         JOIN device_ips ON device_ips.device_id = devices.id
         WHERE device_ips.ip = ?`
      )
      .get(deviceIp) as { id: number; name: string; mac: string | null } | undefined;
    device = found ?? null;
  }

  if (!device) {
    const name = detectedName ?? buildDeviceName(deviceMac, deviceIp, identifier);
    const info = database
      .prepare(
        `INSERT INTO devices (name, mac, vendor, first_seen, last_seen)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(name, deviceMac, null, now, now);
    device = { id: Number(info.lastInsertRowid), name, mac: deviceMac };
  } else if (deviceMac && !device.mac) {
    const nextName = isAutoName(device.name, deviceIp, identifier)
      ? buildDeviceName(deviceMac, deviceIp, identifier)
      : device.name;
    database
      .prepare(`UPDATE devices SET mac = ?, name = ? WHERE id = ?`)
      .run(deviceMac, nextName, device.id);
    device = { ...device, name: nextName };
  }

  if (detectedName && isAutoName(device.name, deviceIp, identifier)) {
    database.prepare(`UPDATE devices SET name = ? WHERE id = ?`).run(detectedName, device.id);
    device = { ...device, name: detectedName };
  }

  database
    .prepare(`UPDATE devices SET last_seen = ? WHERE id = ?`)
    .run(now, device.id);

  if (deviceIp) {
    database
      .prepare(
        `INSERT INTO device_ips (device_id, ip, first_seen, last_seen)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(device_id, ip) DO UPDATE SET last_seen = excluded.last_seen`
      )
      .run(device.id, deviceIp, now, now);
  }

  const categoryName = categorizeTraffic(packet.host, packet.src_port, packet.dst_port, packet.proto);
  const categoryId = ensureCategory(device.id, categoryName);

  return { deviceId: device.id, host: packet.host, categoryId };
};

const ensureCategory = (deviceId: number, name: string) => {
  const database = ensureDb();
  const existing = database
    .prepare(`SELECT id FROM categories WHERE device_id = ? AND name = ?`)
    .get(deviceId, name) as { id: number } | undefined;
  if (existing) return existing.id;
  const info = database
    .prepare(`INSERT INTO categories (device_id, name) VALUES (?, ?)`)
    .run(deviceId, name);
  return Number(info.lastInsertRowid);
};

const insertPacketLog = (importId: number, deviceId: number, packet: ParsedPacket) => {
  const database = ensureDb();
  database
    .prepare(
      `INSERT INTO packet_logs (
        import_id, device_id, timestamp, src_ip, dst_ip, src_port, dst_port, proto,
        host, src_mac, dst_mac, bytes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      importId,
      deviceId,
      packet.timestamp,
      packet.src_ip,
      packet.dst_ip,
      packet.src_port,
      packet.dst_port,
      packet.proto,
      packet.host,
      packet.src_mac,
      packet.dst_mac,
      packet.frame_len
    );

  database
    .prepare(
      `DELETE FROM packet_logs
       WHERE id IN (
         SELECT id FROM packet_logs
         WHERE import_id = ? AND device_id = ?
         ORDER BY timestamp DESC, id DESC
         LIMIT -1 OFFSET ?
       )`
    )
    .run(importId, deviceId, MAX_LOG_ROWS);
};

export const upsertFlow = (importId: number, packet: ParsedPacket) => {
  const database = ensureDb();
  const now = packet.timestamp;
  const { deviceId, host, categoryId } = resolveDevice(packet);
  const direction = "src_to_dst";

  database
    .prepare(
      `INSERT INTO flows (
        import_id, device_id, category_id, direction, start_time, end_time, src_ip, dst_ip,
        src_port, dst_port, proto, host, packets, bytes_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(import_id, device_id, src_ip, dst_ip, src_port, dst_port, proto)
      DO UPDATE SET
        end_time = excluded.end_time,
        packets = flows.packets + 1,
        bytes_total = flows.bytes_total + excluded.bytes_total,
        host = CASE WHEN flows.host IS NULL OR flows.host = '' THEN excluded.host ELSE flows.host END,
        category_id = excluded.category_id`
    )
    .run(
      importId,
      deviceId,
      categoryId,
      direction,
      now,
      now,
      packet.src_ip,
      packet.dst_ip,
      packet.src_port,
      packet.dst_port,
      packet.proto,
      host,
      1,
      packet.frame_len
    );

  insertPacketLog(importId, deviceId, packet);
  const minuteKey = toMinuteKey(packet.timestamp);
  if (minuteKey) {
    upsertTrafficBuckets(importId, deviceId, minuteKey, packet.frame_len, packet.proto);
    upsertTrafficBuckets(importId, 0, minuteKey, packet.frame_len, packet.proto);
  }
  bumpVersion(importFlowVersion, importId);
  bumpVersion(deviceFlowVersion, deviceKey(importId, deviceId));
};

export const getDevices = (importId: number) => {
  const database = ensureDb();
  return database
    .prepare(
      `SELECT devices.*, COALESCE(SUM(flows.bytes_total), 0) AS total_bytes
       FROM devices
       JOIN flows ON flows.device_id = devices.id
       WHERE flows.import_id = ?
       GROUP BY devices.id
       ORDER BY total_bytes DESC
       LIMIT 10`
    )
    .all(importId);
};

export const getAllDevices = (importId: number) => {
  const database = ensureDb();
  return database
    .prepare(
      `SELECT devices.*, COALESCE(SUM(flows.bytes_total), 0) AS total_bytes
       FROM devices
       JOIN flows ON flows.device_id = devices.id
       WHERE flows.import_id = ?
       GROUP BY devices.id
       ORDER BY total_bytes DESC`
    )
    .all(importId);
};

export const getDeviceTotals = (importId: number) => {
  const database = ensureDb();
  return database
    .prepare(
      `SELECT COUNT(DISTINCT device_id) AS device_count,
              COALESCE(SUM(bytes_total), 0) AS total_bytes,
              COALESCE(SUM(packets), 0) AS total_packets
       FROM flows
       WHERE import_id = ?`
    )
    .get(importId) as {
    device_count: number;
    total_bytes: number;
    total_packets: number;
  };
};
export const getDeviceDetails = (importId: number, deviceId: number) => {
  const database = ensureDb();
  return database
    .prepare(
      `SELECT devices.*, COALESCE(SUM(flows.bytes_total), 0) AS total_bytes,
              COUNT(flows.id) AS flow_count
       FROM devices
       JOIN flows ON flows.device_id = devices.id
       WHERE flows.import_id = ? AND devices.id = ?`
    )
    .get(importId, deviceId);
};

export const getCategories = (importId: number, deviceId: number) => {
  const database = ensureDb();
  const totals = database
    .prepare(
      `SELECT categories.id, categories.name, COALESCE(SUM(flows.bytes_total), 0) AS bytes_total
       FROM categories
       LEFT JOIN flows ON flows.category_id = categories.id
       WHERE categories.device_id = ? AND flows.import_id = ?
       GROUP BY categories.id
       ORDER BY bytes_total DESC`
    )
    .all(deviceId, importId) as Array<{ id: number; name: string; bytes_total: number }>;

  const totalBytes = totals.reduce((sum, row) => sum + Number(row.bytes_total), 0) || 1;
  return totals.map(row => ({
    ...row,
    percentage: Number((Number(row.bytes_total) / totalBytes) * 100)
  }));
};

export const getFlows = (importId: number, deviceId: number, filters: FlowFilters) => {
  const database = ensureDb();
  const where: string[] = ["flows.import_id = ?", "flows.device_id = ?"];
  const params: Array<string | number> = [importId, deviceId];

  if (filters.from) {
    where.push("flows.start_time >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    where.push("flows.end_time <= ?");
    params.push(filters.to);
  }
  if (filters.categoryId) {
    where.push("flows.category_id = ?");
    params.push(filters.categoryId);
  }
  if (filters.host) {
    where.push("flows.host LIKE ?");
    params.push(`%${filters.host}%`);
  }
  if (filters.port) {
    where.push("(flows.src_port = ? OR flows.dst_port = ?)");
    params.push(filters.port, filters.port);
  }
  if (filters.proto) {
    where.push("flows.proto = ?");
    params.push(filters.proto);
  }

  const query = `
    SELECT flows.*, categories.name AS category_name
    FROM flows
    LEFT JOIN categories ON categories.id = flows.category_id
    WHERE ${where.join(" AND ")}
    ORDER BY flows.bytes_total DESC
    LIMIT ${MAX_DEVICE_FLOWS}
  `;

  return database.prepare(query).all(...params);
};

export const getImportFlows = (importId: number) => {
  const database = ensureDb();
  const minuteCutoff = cutoffMinute(ANALYTICS_WINDOW_MINUTES);
  return database
    .prepare(
      `SELECT minute AS start_time, bytes_total
       FROM traffic_buckets
       WHERE import_id = ? AND device_id = 0 AND minute >= ?
       ORDER BY minute DESC
       LIMIT 180`
    )
    .all(importId, minuteCutoff);
};

export const getDeviceLog = (
  importId: number,
  deviceId: number,
  limit = 200,
  offset = 0
) => {
  const database = ensureDb();
  return database
    .prepare(
      `SELECT timestamp, src_ip, dst_ip, src_port, dst_port, proto, host, bytes, src_mac, dst_mac
       FROM packet_logs
       WHERE import_id = ? AND device_id = ?
       ORDER BY timestamp DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(importId, deviceId, limit, offset);
};

export const getDeviceAnalytics = (
  importId: number,
  deviceId: number
): DeviceAnalyticsResult => {
  const database = ensureDb();
  const flowCutoff = cutoffIso(ANALYTICS_WINDOW_MINUTES);
  const minuteCutoff = cutoffMinute(ANALYTICS_WINDOW_MINUTES);
  const key = deviceKey(importId, deviceId);
  const version = deviceFlowVersion.get(key) ?? 0;
  const cached = deviceAnalyticsCache.get(key);
  if (cached && cached.version == version) return cached.value;

  const protocolRows = database
    .prepare(
      `SELECT minute AS time, proto, bytes_total AS bytes
       FROM traffic_buckets_proto
       WHERE import_id = ? AND device_id = ? AND minute >= ?
       ORDER BY minute DESC
       LIMIT 540`
    )
    .all(importId, deviceId, minuteCutoff) as Array<{ time: string; proto: string | null; bytes: number }>;

  const protocolSeriesMap = new Map<string, { time: string; tcp: number; udp: number; other: number }>();
  protocolRows.forEach(row => {
    const entry = protocolSeriesMap.get(row.time) ?? {
      time: row.time,
      tcp: 0,
      udp: 0,
      other: 0
    };
    const bucket = protoBucket(row.proto);
    entry[bucket] += Number(row.bytes);
    protocolSeriesMap.set(row.time, entry);
  });

  const protocolTotals = database
    .prepare(
      `SELECT COALESCE(proto, 'other') AS proto,
              SUM(bytes_total) AS bytes
       FROM flows
       WHERE import_id = ? AND device_id = ? AND COALESCE(end_time, start_time) >= ?
       GROUP BY proto`
    )
    .all(importId, deviceId, flowCutoff) as Array<{ proto: string; bytes: number }>;

  const heatmap = database
    .prepare(
      `SELECT CAST(strftime('%w', COALESCE(end_time, start_time)) AS INTEGER) AS day,
              CAST(strftime('%H', COALESCE(end_time, start_time)) AS INTEGER) AS hour,
              SUM(bytes_total) AS bytes
       FROM flows
       WHERE import_id = ? AND device_id = ? AND COALESCE(end_time, start_time) >= ?
       GROUP BY day, hour`
    )
    .all(importId, deviceId, flowCutoff) as Array<{ day: number; hour: number; bytes: number }>;

  const commPairs = database
    .prepare(
      `SELECT COALESCE(src_ip, 'unknown') AS source,
              COALESCE(dst_ip, 'unknown') AS target,
              SUM(bytes_total) AS bytes
       FROM flows
       WHERE import_id = ? AND device_id = ? AND COALESCE(end_time, start_time) >= ?
       GROUP BY source, target
       ORDER BY bytes DESC
       LIMIT 20`
    )
    .all(importId, deviceId, flowCutoff) as Array<{ source: string; target: string; bytes: number }>;

  const portTotals = database
    .prepare(
      `SELECT proto, port, SUM(bytes_total) AS bytes
       FROM (
         SELECT proto, src_port AS port, bytes_total
         FROM flows
         WHERE import_id = ? AND device_id = ? AND src_port IS NOT NULL AND COALESCE(end_time, start_time) >= ?
         UNION ALL
         SELECT proto, dst_port AS port, bytes_total
         FROM flows
         WHERE import_id = ? AND device_id = ? AND dst_port IS NOT NULL AND COALESCE(end_time, start_time) >= ?
       )
       GROUP BY proto, port
       ORDER BY bytes DESC
       LIMIT 25`
    )
    .all(importId, deviceId, flowCutoff, importId, deviceId, flowCutoff) as Array<{
    proto: string | null;
    port: number;
    bytes: number;
  }>;

  const durationHistogram = database
    .prepare(
      `SELECT CASE
                WHEN dur < 1 THEN '0-1s'
                WHEN dur < 5 THEN '1-5s'
                WHEN dur < 30 THEN '5-30s'
                WHEN dur < 120 THEN '30-120s'
                WHEN dur < 300 THEN '2-5m'
                WHEN dur < 900 THEN '5-15m'
                ELSE '15m+'
              END AS label,
              COUNT(*) AS count
       FROM (
         SELECT (julianday(end_time) - julianday(start_time)) * 86400.0 AS dur
         FROM flows
         WHERE import_id = ? AND device_id = ? AND end_time IS NOT NULL AND start_time IS NOT NULL
           AND COALESCE(end_time, start_time) >= ?
       )
       GROUP BY label`
    )
    .all(importId, deviceId, flowCutoff) as Array<{ label: string; count: number }>;

  const topDomains = database
    .prepare(
      `SELECT lower(rtrim(host, '.')) AS domain,
              SUM(bytes_total) AS bytes
       FROM flows
       WHERE import_id = ? AND device_id = ? AND host IS NOT NULL AND host != ''
         AND COALESCE(end_time, start_time) >= ?
       GROUP BY domain
       ORDER BY bytes DESC
       LIMIT 12`
    )
    .all(importId, deviceId, flowCutoff) as Array<{ domain: string; bytes: number }>;

  const newDomainsSeries = database
    .prepare(
      `SELECT substr(COALESCE(end_time, start_time), 1, 10) AS day,
              COUNT(DISTINCT lower(rtrim(host, '.'))) AS count
       FROM flows
       WHERE import_id = ? AND device_id = ? AND host IS NOT NULL AND host != ''
         AND COALESCE(end_time, start_time) >= ?
       GROUP BY day
       ORDER BY day`
    )
    .all(importId, deviceId, flowCutoff) as Array<{ day: string; count: number }>;

  const categoryRows = database
    .prepare(
      `SELECT categories.name AS category,
              lower(rtrim(flows.host, '.')) AS host,
              SUM(flows.bytes_total) AS bytes
       FROM flows
       JOIN categories ON categories.id = flows.category_id
       WHERE flows.import_id = ? AND flows.device_id = ? AND flows.host IS NOT NULL AND flows.host != ''
         AND COALESCE(flows.end_time, flows.start_time) >= ?
       GROUP BY categories.name, host
       ORDER BY bytes DESC`
    )
    .all(importId, deviceId, flowCutoff) as Array<{ category: string; host: string; bytes: number }>;

  const minuteRows = database
    .prepare(
      `SELECT minute AS time, bytes_total AS bytes
       FROM traffic_buckets
       WHERE import_id = ? AND device_id = ? AND minute >= ?
       ORDER BY minute DESC
       LIMIT 180`
    )
    .all(importId, deviceId, minuteCutoff) as Array<{ time: string; bytes: number }>;

  const externalRows = database
    .prepare(
      `SELECT dst_ip AS ip,
              SUM(bytes_total) AS bytes
       FROM flows
       WHERE import_id = ? AND device_id = ? AND dst_ip IS NOT NULL
         AND COALESCE(end_time, start_time) >= ?
       GROUP BY dst_ip
       ORDER BY bytes DESC`
    )
    .all(importId, deviceId, flowCutoff) as Array<{ ip: string; bytes: number }>;

  const targetCount = database
    .prepare(
      `SELECT COUNT(DISTINCT dst_ip) AS count
       FROM flows
       WHERE import_id = ? AND device_id = ? AND dst_ip IS NOT NULL
         AND COALESCE(end_time, start_time) >= ?`
    )
    .get(importId, deviceId, flowCutoff) as { count: number } | undefined;

  const portCount = database
    .prepare(
      `SELECT COUNT(DISTINCT port) AS count
       FROM (
         SELECT src_port AS port FROM flows WHERE import_id = ? AND device_id = ? AND src_port IS NOT NULL
           AND COALESCE(end_time, start_time) >= ?
         UNION
         SELECT dst_port AS port FROM flows WHERE import_id = ? AND device_id = ? AND dst_port IS NOT NULL
           AND COALESCE(end_time, start_time) >= ?
       )`
    )
    .get(importId, deviceId, flowCutoff, importId, deviceId, flowCutoff) as { count: number } | undefined;

  const domainCount = database
    .prepare(
      `SELECT COUNT(DISTINCT lower(rtrim(host, '.'))) AS count
       FROM flows
       WHERE import_id = ? AND device_id = ? AND host IS NOT NULL AND host != ''
         AND COALESCE(end_time, start_time) >= ?`
    )
    .get(importId, deviceId, flowCutoff) as { count: number } | undefined;

  const protocolSeries = Array.from(protocolSeriesMap.values())
    .sort((a, b) => a.time.localeCompare(b.time))
    .slice(-180);

  const portTreemap = portTotals.map(row => {
    const label = `${(row.proto ?? 'other').toUpperCase()} ${row.port}`;
    return { name: label, size: Number(row.bytes) };
  });

  const categoryMap = new Map<string, Array<{ host: string; bytes: number }>>();
  categoryRows.forEach(row => {
    const list = categoryMap.get(row.category) ?? [];
    list.push({ host: row.host, bytes: Number(row.bytes) });
    categoryMap.set(row.category, list);
  });

  const categoryDrilldown = Array.from(categoryMap.entries()).map(([category, hosts]) => ({
    category,
    hosts: hosts
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 8)
  }));

  const minuteValues = minuteRows.map(row => Number(row.bytes)).sort((a, b) => a - b);
  const percentile = minuteValues.length
    ? minuteValues[Math.floor(0.95 * (minuteValues.length - 1))]
    : 0;
  const bursts = minuteRows
    .filter(row => Number(row.bytes) >= percentile && Number(row.bytes) > 0)
    .map(row => ({ time: row.time, bytes: Number(row.bytes) }));

  const externalTargets = externalRows
    .filter(row => !isPrivateIp(row.ip))
    .slice(0, 12)
    .map(row => ({ ip: row.ip, bytes: Number(row.bytes) }));

  const riskIndicators = [
    {
      label: "Unique targets",
      value: Number(targetCount?.count ?? 0),
      severity: Number(targetCount?.count ?? 0) > 200 ? "high" : Number(targetCount?.count ?? 0) > 80 ? "med" : "low"
    },
    {
      label: "Unique ports",
      value: Number(portCount?.count ?? 0),
      severity: Number(portCount?.count ?? 0) > 120 ? "high" : Number(portCount?.count ?? 0) > 40 ? "med" : "low"
    },
    {
      label: "New domains",
      value: Number(domainCount?.count ?? 0),
      severity: Number(domainCount?.count ?? 0) > 120 ? "high" : Number(domainCount?.count ?? 0) > 40 ? "med" : "low"
    }
  ];

  const result: DeviceAnalyticsResult = {
    heatmap: heatmap.map(row => ({
      day: Number(row.day),
      hour: Number(row.hour),
      bytes: Number(row.bytes)
    })),
    protocolSeries,
    protocolTotals: protocolTotals.map(row => ({
      name: row.proto ?? "other",
      bytes: Number(row.bytes)
    })),
    commPairs: commPairs.map(row => ({
      source: row.source,
      target: row.target,
      bytes: Number(row.bytes)
    })),
    portTreemap,
    durationHistogram: durationHistogram.map(row => ({
      label: row.label,
      count: Number(row.count)
    })),
    topDomains: topDomains.map(row => ({ domain: row.domain, bytes: Number(row.bytes) })),
    newDomainsSeries: newDomainsSeries.map(row => ({ day: row.day, count: Number(row.count) })),
    categoryDrilldown,
    bursts,
    externalTargets,
    riskIndicators
  };

  deviceAnalyticsCache.set(key, { version, value: result });
  return result;
};

export const getImportAnalytics = (importId: number): ImportAnalyticsResult => {
  const database = ensureDb();
  const flowCutoff = cutoffIso(ANALYTICS_WINDOW_MINUTES);
  const minuteCutoff = cutoffMinute(ANALYTICS_WINDOW_MINUTES);
  const version = importFlowVersion.get(importId) ?? 0;
  const cached = importAnalyticsCache.get(importId);
  if (cached && cached.version == version) return cached.value;

  const protocolRows = database
    .prepare(
      `SELECT minute AS time, proto, bytes_total AS bytes
       FROM traffic_buckets_proto
       WHERE import_id = ? AND device_id = 0 AND minute >= ?
       ORDER BY minute DESC
       LIMIT 540`
    )
    .all(importId, minuteCutoff) as Array<{ time: string; proto: string | null; bytes: number }>;

  const protocolSeriesMap = new Map<string, { time: string; tcp: number; udp: number; other: number }>();
  protocolRows.forEach(row => {
    const entry = protocolSeriesMap.get(row.time) ?? {
      time: row.time,
      tcp: 0,
      udp: 0,
      other: 0
    };
    const bucket = protoBucket(row.proto);
    entry[bucket] += Number(row.bytes);
    protocolSeriesMap.set(row.time, entry);
  });

  const heatmap = database
    .prepare(
      `SELECT CAST(strftime('%w', COALESCE(end_time, start_time)) AS INTEGER) AS day,
              CAST(strftime('%H', COALESCE(end_time, start_time)) AS INTEGER) AS hour,
              SUM(bytes_total) AS bytes
       FROM flows
       WHERE import_id = ? AND COALESCE(end_time, start_time) >= ?
       GROUP BY day, hour`
    )
    .all(importId, flowCutoff) as Array<{ day: number; hour: number; bytes: number }>;

  const deviceList = database
    .prepare(
      `SELECT devices.id, devices.name
       FROM devices
       JOIN flows ON flows.device_id = devices.id
       WHERE flows.import_id = ? AND COALESCE(flows.end_time, flows.start_time) >= ?
       GROUP BY devices.id`
    )
    .all(importId, flowCutoff) as Array<{ id: number; name: string }>;

  const talkerMap = new Map<number, { device: string; out_bytes: number; in_bytes: number }>();
  deviceList.forEach(device => {
    talkerMap.set(device.id, { device: device.name, out_bytes: 0, in_bytes: 0 });
  });

  const outRows = database
    .prepare(
      `SELECT flows.device_id AS device_id, SUM(flows.bytes_total) AS bytes
       FROM flows
       JOIN device_ips ON device_ips.device_id = flows.device_id AND flows.src_ip = device_ips.ip
       WHERE flows.import_id = ? AND COALESCE(flows.end_time, flows.start_time) >= ?
       GROUP BY flows.device_id`
    )
    .all(importId, flowCutoff) as Array<{ device_id: number; bytes: number }>;

  outRows.forEach(row => {
    const entry = talkerMap.get(row.device_id);
    if (entry) entry.out_bytes = Number(row.bytes);
  });

  const inRows = database
    .prepare(
      `SELECT flows.device_id AS device_id, SUM(flows.bytes_total) AS bytes
       FROM flows
       JOIN device_ips ON device_ips.device_id = flows.device_id AND flows.dst_ip = device_ips.ip
       WHERE flows.import_id = ? AND COALESCE(flows.end_time, flows.start_time) >= ?
       GROUP BY flows.device_id`
    )
    .all(importId, flowCutoff) as Array<{ device_id: number; bytes: number }>;

  inRows.forEach(row => {
    const entry = talkerMap.get(row.device_id);
    if (entry) entry.in_bytes = Number(row.bytes);
  });

  const lifecycle = database
    .prepare(
      `SELECT devices.id, devices.name,
              MIN(flows.start_time) AS first_seen,
              MAX(flows.end_time) AS last_seen,
              SUM(flows.bytes_total) AS total_bytes
       FROM devices
       JOIN flows ON flows.device_id = devices.id
       WHERE flows.import_id = ? AND COALESCE(flows.end_time, flows.start_time) >= ?
       GROUP BY devices.id
       ORDER BY total_bytes DESC
       LIMIT 25`
    )
    .all(importId, flowCutoff) as Array<{
    id: number;
    name: string;
    first_seen: string;
    last_seen: string;
    total_bytes: number;
  }>;

  const minuteRows = database
    .prepare(
      `SELECT minute AS time, bytes_total AS bytes
       FROM traffic_buckets
       WHERE import_id = ? AND device_id = 0 AND minute >= ?
       ORDER BY minute DESC
       LIMIT 180`
    )
    .all(importId, minuteCutoff) as Array<{ time: string; bytes: number }>;

  const minuteValues = minuteRows.map(row => Number(row.bytes)).sort((a, b) => a - b);
  const percentile = minuteValues.length
    ? minuteValues[Math.floor(0.95 * (minuteValues.length - 1))]
    : 0;
  const bursts = minuteRows
    .filter(row => Number(row.bytes) >= percentile && Number(row.bytes) > 0)
    .map(row => ({ time: row.time, bytes: Number(row.bytes) }));

  const result: ImportAnalyticsResult = {
    protocolSeries: Array.from(protocolSeriesMap.values())
      .sort((a, b) => a.time.localeCompare(b.time))
      .slice(-180),
    heatmap: heatmap.map(row => ({
      day: Number(row.day),
      hour: Number(row.hour),
      bytes: Number(row.bytes)
    })),
    talkers: Array.from(talkerMap.values()).sort((a, b) => b.out_bytes - a.out_bytes),
    lifecycle,
    bursts
  };

  importAnalyticsCache.set(importId, { version, value: result });
  return result;
};

export const renameDevice = (deviceId: number, newName: string) => {
  const database = ensureDb();
  database.prepare(`UPDATE devices SET name = ? WHERE id = ?`).run(newName, deviceId);
};

export const clearImportFlows = (importId: number) => {
  const database = ensureDb();
  database.prepare(`DELETE FROM flows WHERE import_id = ?`).run(importId);
  database.prepare(`DELETE FROM packet_logs WHERE import_id = ?`).run(importId);
  database.prepare(`DELETE FROM traffic_buckets WHERE import_id = ?`).run(importId);
  database.prepare(`DELETE FROM traffic_buckets_proto WHERE import_id = ?`).run(importId);
  importFlowVersion.delete(importId);
  importAnalyticsCache.delete(importId);
  for (const key of deviceFlowVersion.keys()) {
    if (key.startsWith(`${importId}:`)) {
      deviceFlowVersion.delete(key);
    }
  }
  for (const key of deviceAnalyticsCache.keys()) {
    if (key.startsWith(`${importId}:`)) {
      deviceAnalyticsCache.delete(key);
    }
  }
};
