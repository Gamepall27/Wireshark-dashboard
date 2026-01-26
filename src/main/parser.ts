import { spawn } from "node:child_process";
import readline from "node:readline";
import { ParsedPacket } from "./types";

const getFirst = (value: unknown): string | null => {
  if (Array.isArray(value)) {
    const item = value[0];
    return typeof item === "string" ? item : null;
  }
  if (typeof value === "string") return value;
  return null;
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
      if (!line.trim()) return;
      try {
        const record = JSON.parse(line) as {
          timestamp?: string;
          layers?: Record<string, unknown>;
        };
        const layers = record.layers ?? {};

        const protoValue = getFirst(pickLayer(layers, "ip_ip_proto"));
        const proto =
          protoValue === "6"
            ? "tcp"
            : protoValue === "17"
            ? "udp"
            : protoValue ??
              (pickLayer(layers, "tcp_tcp_srcport")
                ? "tcp"
                : pickLayer(layers, "udp_udp_srcport")
                ? "udp"
                : null);

        const packet: ParsedPacket = {
          timestamp: record.timestamp ?? new Date().toISOString(),
          frame_len: getNumber(pickLayer(layers, "frame_frame_len")) ?? 0,
          src_ip: getFirst(pickLayer(layers, "ip_ip_src")),
          dst_ip: getFirst(pickLayer(layers, "ip_ip_dst")),
          src_port: getNumber(pickLayer(layers, "tcp_tcp_srcport")) ?? getNumber(pickLayer(layers, "udp_udp_srcport")),
          dst_port: getNumber(pickLayer(layers, "tcp_tcp_dstport")) ?? getNumber(pickLayer(layers, "udp_udp_dstport")),
          proto,
          src_mac: getFirst(pickLayer(layers, "eth_eth_src")),
          dst_mac: getFirst(pickLayer(layers, "eth_eth_dst")),
          host:
            getFirst(pickLayer(layers, "dns_dns_qry_name")) ??
            getFirst(pickLayer(layers, "tls_tls_handshake_extensions_server_name"))
        };

        onPacket(packet);
      } catch (error) {
        // ignore malformed line
      }
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
