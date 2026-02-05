import path from "node:path";
import process from "node:process";
import {
  listCaptureInterfaces,
  parsePcapStream,
  startLiveCapture
} from "../../src/main/parser.js";
import type { ParsedPacket } from "../../src/main/types.js";

const getArgValue = (args: string[], ...keys: string[]) => {
  for (let i = 0; i < args.length; i += 1) {
    if (keys.includes(args[i])) {
      return args[i + 1] ?? null;
    }
  }
  return null;
};

const hasFlag = (args: string[], ...keys: string[]) =>
  args.some(arg => keys.includes(arg));

const formatPacketText = (packet: ParsedPacket, iface?: string | null) => {
  const src = `${packet.src_ip ?? "-"}:${packet.src_port ?? "-"}`;
  const dst = `${packet.dst_ip ?? "-"}:${packet.dst_port ?? "-"}`;
  const mac = `${packet.src_mac ?? "-"} -> ${packet.dst_mac ?? "-"}`;
  const host = packet.host ?? "-";
  const proto = packet.proto ?? "-";
  const ifaceLabel = iface ? ` iface=${iface}` : "";
  return `${packet.timestamp}${ifaceLabel} proto=${proto} len=${packet.frame_len} src=${src} dst=${dst} host=${host} mac=${mac}`;
};

const printUsage = () => {
  console.log(
    [
      "Usage:",
      "  npm run logger",
      "  npm run logger -- --file <pcap|pcapng> [--format json|text]",
      "  npm run logger -- --interface <id|name> [--format json|text]",
      "  npm run logger -- --list-interfaces",
      "  npx tsx tools/console-logger/index.ts --file <pcap|pcapng>",
      "  npm run logger -- --all-interfaces [--format json|text]",
      "",
      "Notes:",
      "  - Output is logged only to this console.",
      "  - Requires tshark to be installed and available in PATH."
    ].join("\n")
  );
};

const main = async () => {
  const args = process.argv.slice(2);
  const filePath = getArgValue(args, "--file", "-f");
  const interfaceName = getArgValue(args, "--interface", "-i");
  const format = (getArgValue(args, "--format") ?? "json").toLowerCase();
  const listOnly = hasFlag(args, "--list-interfaces", "-l");
  const allInterfaces = hasFlag(args, "--all-interfaces", "-a");

  if (listOnly) {
    const interfaces = await listCaptureInterfaces();
    if (interfaces.length === 0) {
      console.log("No capture interfaces found.");
      return;
    }
    interfaces.forEach(item => {
      const desc = item.description ? ` (${item.description})` : "";
      console.log(`${item.id}. ${item.name}${desc}`);
    });
    return;
  }

  if ((filePath && (interfaceName || allInterfaces)) || (interfaceName && allInterfaces)) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const logPacket = (packet: ParsedPacket, iface?: string | null) => {
    if (format === "text") {
      console.log(formatPacketText(packet, iface));
      return;
    }
    const payload = iface ? { ...packet, interface: iface } : packet;
    console.log(JSON.stringify(payload));
  };

  if (!filePath && !interfaceName && !allInterfaces) {
    // Default to all interfaces for the simplest command.
    return mainWithAllInterfaces(logPacket);
  }

  if (filePath) {
    const resolved = path.resolve(process.cwd(), filePath);
    console.log(`Reading file: ${resolved}`);
    await parsePcapStream(resolved, packet => logPacket(packet, "file"));
    console.log("Done.");
    return;
  }

  if (allInterfaces) {
    return mainWithAllInterfaces(logPacket);
  }

  if (!interfaceName) return;
  console.log(`Starting live capture on: ${interfaceName}`);
  const live = startLiveCapture(interfaceName, packet => logPacket(packet, interfaceName));

  const handleStop = () => {
    console.log("Stopping capture...");
    live.stop();
  };

  process.on("SIGINT", handleStop);
  process.on("SIGTERM", handleStop);

  await live.done;
  console.log("Stopped.");
};

const mainWithAllInterfaces = async (
  logPacket: (packet: ParsedPacket, iface?: string | null) => void
) => {
  const interfaces = await listCaptureInterfaces();
  if (interfaces.length === 0) {
    console.log("No capture interfaces found.");
    return;
  }
  console.log(
    `Starting live capture on ${interfaces.length} interfaces (use Ctrl+C to stop).`
  );
  const captures = interfaces.map(item => ({
    id: item.id,
    name: item.name,
    live: startLiveCapture(item.id, packet => logPacket(packet, item.name))
  }));

  const handleStop = () => {
    console.log("Stopping capture...");
    captures.forEach(item => item.live.stop());
  };

  process.on("SIGINT", handleStop);
  process.on("SIGTERM", handleStop);

  await Promise.all(captures.map(item => item.live.done));
  console.log("Stopped.");
};

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
