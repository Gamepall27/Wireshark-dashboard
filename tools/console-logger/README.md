Console logger

This is a small console-only program that prints relevant Wireshark/tshark packet fields.

Usage (from repo root):

  npm run logger
  npm run logger -- --list-interfaces
  npm run logger -- --interface <id|name> --format text
  npm run logger -- --file <path-to-pcap> --format json
  npm run logger -- --all-interfaces --format json

  npx tsx tools/console-logger/index.ts --list-interfaces

Notes:
  - Output is logged only to the console that runs this program.
  - Requires tshark installed and available in PATH.
