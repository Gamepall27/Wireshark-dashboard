export type ImportStatus = "queued" | "processing" | "done" | "failed";

export interface ImportRecord {
  id: number;
  file_path: string;
  file_name: string;
  status: ImportStatus;
  created_at: string;
  finished_at: string | null;
  error: string | null;
}

export interface DeviceSummary {
  id: number;
  name: string;
  mac: string | null;
  vendor: string | null;
  first_seen: string;
  last_seen: string;
  total_bytes: number;
}

export interface CategorySummary {
  id: number;
  name: string;
  bytes_total: number;
  percentage: number;
}

export interface FlowRecord {
  id: number;
  start_time: string;
  end_time: string;
  src_ip: string | null;
  dst_ip: string | null;
  src_port: number | null;
  dst_port: number | null;
  proto: string | null;
  host: string | null;
  packets: number;
  bytes_total: number;
  category_name: string | null;
}

export interface DeviceDetails {
  id: number;
  name: string;
  mac: string | null;
  vendor: string | null;
  first_seen: string;
  last_seen: string;
  total_bytes: number;
  flow_count: number;
}

export interface FlowFilters {
  from?: string;
  to?: string;
  categoryId?: number;
  host?: string;
  port?: number;
  proto?: string;
}
