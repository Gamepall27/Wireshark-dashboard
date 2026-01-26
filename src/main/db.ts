import Database from "better-sqlite3";
import { app } from "electron";
import path from "node:path";
import { FlowFilters, ImportStatus, ParsedPacket } from "./types";
import { categorizeTraffic } from "./rules";

let db: Database.Database | null = null;

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
  const identifier = packet.src_mac ?? packet.src_ip ?? "unknown";

  let device = null as null | { id: number; name: string };
  if (packet.src_mac) {
    device = database
      .prepare(`SELECT id, name FROM devices WHERE mac = ?`)
      .get(packet.src_mac) as { id: number; name: string } | undefined;
  }

  if (!device && packet.src_ip) {
    device = database
      .prepare(
        `SELECT devices.id, devices.name FROM devices
         JOIN device_ips ON device_ips.device_id = devices.id
         WHERE device_ips.ip = ?`
      )
      .get(packet.src_ip) as { id: number; name: string } | undefined;
  }

  if (!device) {
    const name = packet.src_mac
      ? `Device ${packet.src_mac.replace(/:/g, "").slice(-4).toUpperCase()}`
      : `IP ${identifier}`;
    const info = database
      .prepare(
        `INSERT INTO devices (name, mac, vendor, first_seen, last_seen)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(name, packet.src_mac, null, now, now);
    device = { id: Number(info.lastInsertRowid), name };
  }

  database
    .prepare(`UPDATE devices SET last_seen = ? WHERE id = ?`)
    .run(now, device.id);

  if (packet.src_ip) {
    database
      .prepare(
        `INSERT INTO device_ips (device_id, ip, first_seen, last_seen)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(device_id, ip) DO UPDATE SET last_seen = excluded.last_seen`
      )
      .run(device.id, packet.src_ip, now, now);
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
       ORDER BY total_bytes DESC`
    )
    .all(importId);
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
  `;

  return database.prepare(query).all(...params);
};

export const renameDevice = (deviceId: number, newName: string) => {
  const database = ensureDb();
  database.prepare(`UPDATE devices SET name = ? WHERE id = ?`).run(newName, deviceId);
};

export const clearImportFlows = (importId: number) => {
  const database = ensureDb();
  database.prepare(`DELETE FROM flows WHERE import_id = ?`).run(importId);
};
