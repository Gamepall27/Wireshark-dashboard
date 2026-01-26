const hostRules: Array<{ pattern: string; category: string }> = [
  { pattern: "*.googlevideo.com", category: "Streaming" },
  { pattern: "*.youtube.com", category: "Streaming" },
  { pattern: "*.discord.com", category: "Messaging" },
  { pattern: "*.whatsapp.net", category: "Messaging" },
  { pattern: "*.steamcontent.com", category: "Gaming" },
  { pattern: "*.steamstatic.com", category: "Gaming" }
];

const matchHostPattern = (host: string, pattern: string) => {
  if (pattern.startsWith("*")) {
    const suffix = pattern.slice(1);
    return host.endsWith(suffix);
  }
  return host === pattern;
};

const detectUpdates = (host: string) => {
  if (!host.includes("apple.com")) return false;
  return host.includes("updates") || host.includes("mesu");
};

export const categorizeTraffic = (
  host: string | null,
  srcPort: number | null,
  dstPort: number | null,
  proto: string | null
) => {
  const lowerHost = host?.toLowerCase() ?? null;
  if (lowerHost) {
    if (detectUpdates(lowerHost)) {
      return "Updates";
    }
    const match = hostRules.find(rule => matchHostPattern(lowerHost, rule.pattern));
    if (match) return match.category;
  }

  const port = srcPort ?? dstPort ?? null;
  if (port === 53) return "DNS";
  if (port === 123) return "Time/NTP";
  if (port === 443 || port === 80) return "Web";
  if (proto?.toLowerCase() === "tcp") return "Web";
  return "Unkategorisiert";
};
