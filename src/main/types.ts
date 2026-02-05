export type ImportStatus = "queued" | "processing" | "done" | "failed";

export interface ParsedPacket {
  timestamp: string;
  frame_len: number;
  src_ip: string | null;
  dst_ip: string | null;
  src_port: number | null;
  dst_port: number | null;
  proto: string | null;
  src_mac: string | null;
  dst_mac: string | null;
  host: string | null;
  device_name: string | null;
}

export interface FlowFilters {
  from?: string;
  to?: string;
  categoryId?: number;
  host?: string;
  port?: number;
  proto?: string;
}
