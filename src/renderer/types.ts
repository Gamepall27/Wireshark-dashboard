export type ImportStatus = "queued" | "processing" | "done" | "failed";

export interface LiveInterface {
  id: string;
  name: string;
  description: string | null;
}

export interface LiveStatus {
  running: boolean;
  importId: number | null;
  interfaceName: string | null;
}

export interface ImportFlow {
  start_time: string;
  bytes_total: number;
}

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

export interface DeviceTotals {
  device_count: number;
  total_bytes: number;
  total_packets: number;
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

export interface DeviceLogEntry {
  timestamp: string;
  src_ip: string | null;
  dst_ip: string | null;
  src_port: number | null;
  dst_port: number | null;
  proto: string | null;
  host: string | null;
  bytes: number;
  src_mac: string | null;
  dst_mac: string | null;
}

export interface ProtocolSeriesPoint {
  time: string;
  tcp: number;
  udp: number;
  other: number;
}

export interface HeatmapCell {
  day: number;
  hour: number;
  bytes: number;
}

export interface CommPair {
  source: string;
  target: string;
  bytes: number;
}

export interface PortTreemapNode {
  name: string;
  size: number;
}

export interface DurationBucket {
  label: string;
  count: number;
}

export interface DomainStat {
  domain: string;
  bytes: number;
}

export interface NewDomainStat {
  day: string;
  count: number;
}

export interface CategoryDrilldown {
  category: string;
  hosts: Array<{ host: string; bytes: number }>;
}

export interface BurstPoint {
  time: string;
  bytes: number;
}

export interface ExternalTarget {
  ip: string;
  bytes: number;
}

export interface RiskIndicator {
  label: string;
  value: number;
  severity: "low" | "med" | "high";
}

export interface DeviceAnalytics {
  heatmap: HeatmapCell[];
  protocolSeries: ProtocolSeriesPoint[];
  protocolTotals: Array<{ name: string; bytes: number }>;
  commPairs: CommPair[];
  portTreemap: PortTreemapNode[];
  durationHistogram: DurationBucket[];
  topDomains: DomainStat[];
  newDomainsSeries: NewDomainStat[];
  categoryDrilldown: CategoryDrilldown[];
  bursts: BurstPoint[];
  externalTargets: ExternalTarget[];
  riskIndicators: RiskIndicator[];
}

export interface TalkerStat {
  device: string;
  out_bytes: number;
  in_bytes: number;
}

export interface LifecycleEntry {
  id: number;
  name: string;
  first_seen: string;
  last_seen: string;
}

export interface ImportAnalytics {
  protocolSeries: ProtocolSeriesPoint[];
  heatmap: HeatmapCell[];
  talkers: TalkerStat[];
  lifecycle: LifecycleEntry[];
  bursts: BurstPoint[];
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
