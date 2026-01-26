import { spawn } from "node:child_process";
import readline from "node:readline";
import { ParsedPacket } from "./types.js";

export interface CaptureInterface {
  id: string;
  name: string;
  description: string | null;
}

const getFirst = (value: unknown): string | null => {
  if (Array.isArray(value)) {
    const item = value[0];
    return typeof item === "string" ? item : null;
  }
  if (typeof value === "string") return value;
  return null;
};

const normalizeTimestamp = (value: unknown): string => {
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      const ms = numeric < 1e11 ? numeric * 1000 : numeric;
      return new Date(ms).toISOString();
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
};

const getNumber = (value: unknown): number | null => {
  const raw = getFirst(value);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? null : parsed;
};

const pickLayer = (layers: Record<string, unknown>, key: string): unknown => {
  if (layers[key] !== undefined) return layers[key];
  const alt = Object.keys(layers).find(layerKey => layerKey.endsWith(key));
  return alt ? layers[alt] : undefined;
};

const pickNestedLayer = (layers: Record<string, unknown>, key: string): unknown => {
  const direct = pickLayer(layers, key);
  if (direct !== undefined) return direct;
  for (const value of Object.values(layers)) {
    if (!value || typeof value !== "object") continue;
    const nested = pickLayer(value as Record<string, unknown>, key);
    if (nested !== undefined) return nested;
  }
  return undefined;
};

const getFrameLength = (layers: Record<string, unknown>): number => {
  const candidates = [
    "frame_len",
    "frame_frame_len",
    "frame_len_raw",
    "frame_frame_len_raw",
    "ip_ip_len",
    "ipv6_ipv6_plen"
  ];
  for (const key of candidates) {
    const value = getNumber(pickNestedLayer(layers, key));
    if (value !== null && value > 0) return value;
  }
  return 0;
};

const cleanDeviceName = (value: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  const withoutSuffix = trimmed.replace(/<[^>]+>$/, "").trim();
  return withoutSuffix || null;
};

const getDeviceName = (layers: Record<string, unknown>): string | null => {
  const candidates = [
    "bootp_bootp_option_hostname",
    "bootp_bootp_hostname",
    "dhcp_dhcp_option_hostname",
    "dhcp_dhcp_hostname",
    "dhcp_option_hostname",
    "nbns_nb_name",
    "llmnr_llmnr_name"
  ];
  for (const key of candidates) {
    const value = cleanDeviceName(getFirst(pickNestedLayer(layers, key)));
    if (value) return value;
  }
  return null;
};

const parsePacketLine = (line: string): ParsedPacket | null => {
  if (!line.trim()) return null;
  try {
    const record = JSON.parse(line) as {
      timestamp?: string;
      layers?: Record<string, unknown>;
    };
    const layers = record.layers ?? {};

    const protoValue = getFirst(pickNestedLayer(layers, "ip_ip_proto"));
    const proto =
      protoValue === "6"
        ? "tcp"
        : protoValue === "17"
        ? "udp"
        : protoValue ??
          (pickNestedLayer(layers, "tcp_tcp_srcport")
            ? "tcp"
            : pickNestedLayer(layers, "udp_udp_srcport")
            ? "udp"
            : null);

    return {
      timestamp: normalizeTimestamp(record.timestamp),
      frame_len: getFrameLength(layers),
      src_ip: getFirst(pickNestedLayer(layers, "ip_ip_src")),
      dst_ip: getFirst(pickNestedLayer(layers, "ip_ip_dst")),
      src_port:
        getNumber(pickNestedLayer(layers, "tcp_tcp_srcport")) ??
        getNumber(pickNestedLayer(layers, "udp_udp_srcport")),
      dst_port:
        getNumber(pickNestedLayer(layers, "tcp_tcp_dstport")) ??
        getNumber(pickNestedLayer(layers, "udp_udp_dstport")),
      proto,
      src_mac: getFirst(pickNestedLayer(layers, "eth_eth_src")),
      dst_mac: getFirst(pickNestedLayer(layers, "eth_eth_dst")),
      device_name: getDeviceName(layers),
      host:
        getFirst(pickNestedLayer(layers, "dns_dns_qry_name")) ??
        getFirst(pickNestedLayer(layers, "tls_tls_handshake_extensions_server_name"))
    };
  } catch (error) {
    return null;
  }
};

export const parsePcapStream = (
  filePath: string,
  onPacket: (packet: ParsedPacket) => void
) =>
  new Promise<void>((resolve, reject) => {
    const args = [
      "-r",
      filePath,
      "-T",
      "ek",
      "-l",
      "-E",
      "separator=,"
    ];
    const proc = spawn("tshark", args);

    proc.on("error", error => reject(error));

    const rl = readline.createInterface({ input: proc.stdout });

    rl.on("line", line => {
      const packet = parsePacketLine(line);
      if (packet) onPacket(packet);
    });

    proc.stderr.on("data", () => {
      // tshark writes progress to stderr; ignore for now
    });

    proc.on("close", code => {
      rl.close();
      if (code === 0) resolve();
      else reject(new Error(`tshark exited with code ${code}`));
    });
  });

export const startLiveCapture = (
  interfaceName: string,
  onPacket: (packet: ParsedPacket) => void
) => {
  const args = ["-i", interfaceName, "-T", "ek", "-l", "-E", "separator=,"];
  const proc = spawn("tshark", args);
  let stopped = false;

  const stop = () => {
    if (proc.killed) return;
    stopped = true;
    proc.kill();
  };

  const done = new Promise<void>((resolve, reject) => {
    proc.on("error", error => reject(error));

    const rl = readline.createInterface({ input: proc.stdout });
    rl.on("line", line => {
      const packet = parsePacketLine(line);
      if (packet) onPacket(packet);
    });

    proc.stderr.on("data", () => {
      // tshark writes progress to stderr; ignore for now
    });

    proc.on("close", code => {
      rl.close();
      if (code === 0 || stopped) resolve();
      else reject(new Error(`tshark exited with code ${code}`));
    });
  });

  return { stop, done };
};

export const listCaptureInterfaces = () =>
  new Promise<CaptureInterface[]>((resolve, reject) => {
    const proc = spawn("tshark", ["-D"]);
    let output = "";

    proc.on("error", error => reject(error));
    proc.stdout.on("data", chunk => {
      output += chunk.toString();
    });

    proc.on("close", code => {
      if (code !== 0) {
        reject(new Error(`tshark exited with code ${code}`));
        return;
      }
      const interfaces = output
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
          const match = line.match(/^(\d+)\.\s+(.+?)(?:\s+\((.*)\))?$/);
          if (!match) {
            return { id: line, name: line, description: null };
          }
          return {
            id: match[1],
            name: match[2],
            description: match[3] ?? null
          };
        });
      resolve(interfaces);
    });
  });
