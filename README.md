# netscope-electron

Electron + React Desktop-App zum Import von PCAP/PCAPNG-Dateien, Flow-Aggregation und Geräte-Dashboarding.

## Features (MVP)
- PCAP-Import über `tshark` (Wireshark) mit Statusanzeige.
- Flow-Aggregation pro Gerät (MAC/IP Fallback) und Kategorien-Regeln.
- Dashboard mit Geräten, Kategorien und Flow-Tabelle.
- Lokale SQLite-Datenbank (better-sqlite3).

## Voraussetzungen
- Node.js 18+
- **Wireshark / tshark** im PATH verfügbar
  - macOS (Homebrew): `brew install wireshark`
  - Ubuntu/Debian: `sudo apt install tshark`
  - Windows: Wireshark installieren und `tshark.exe` im PATH ergänzen

## Setup
```bash
npm install
```

## Entwicklung
```bash
npm run dev
```

## Build
```bash
npm run build
```

## Hinweise zu tshark
Die App nutzt `tshark` für das Streaming-Parsing. Wenn `tshark` nicht gefunden wird, erscheint in der UI eine klare Fehlermeldung.

## Datenbank-Schema
Siehe `src/main/db.ts` für Tabellen und Aggregationen.
