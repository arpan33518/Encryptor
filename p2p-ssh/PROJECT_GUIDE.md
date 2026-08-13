# EncryptChat (p2p-ssh) - Comprehensive Project & Architecture Guide

Welcome to the **EncryptChat (p2p-ssh)** codebase guide! This document explains how the peer-to-peer encrypted chat system works under the hood, how all the components fit together, and all the key improvements made to the project.

---

## 🛠️ 1. High-Level Architecture Overview

EncryptChat is a **decentralized, peer-to-peer (P2P) chat engine** built with Node.js. It does NOT rely on any central server or cloud database. Instead, every instance acts as both a **Server** and a **Client**:

```
 ┌────────────────────────────────┐            ┌────────────────────────────────┐
 │     Peer A (PC / Laptop)       │            │     Peer B (Phone / Termux)    │
 │  - SSH Server (Port 2222)      │ ── SSH ──> │  - SSH Server (Port 2222)      │
 │  - UDP & mDNS Discovery        │ <─ Tunnel ─│  - UDP & mDNS Discovery        │
 │  - Local SQLite DB (chat.db)   │            │  - Local SQLite DB (chat.db)   │
 └────────────────────────────────┘            └────────────────────────────────┘
```

### Core Technologies:
1. **Encryption & Transport (`ssh2`)**: All peer communication is encrypted end-to-end using OpenSSH `Ed25519` key pairs over custom SSH `exec` channels.
2. **Terminal User Interface (`blessed`)**: A full-screen terminal UI split into Header/Status, Message History, and Input Box.
3. **Local Database (`sqlite3` / `sqlite`)**: Stores trusted peer public keys, IP addresses, ports, and complete message history locally on each device.
4. **Dual Auto-Discovery (`dgram` + `bonjour-service`)**:
   - **UDP Subnet Broadcast**: Broadcasts presence every 4s to all active LAN IPv4 subnet addresses (`255.255.255.255`, `192.168.x.255`).
   - **mDNS (Bonjour)**: Multicast DNS broadcasting and discovery service.

---

## 📁 2. File & Component Breakdown

| File | Responsibilities |
|---|---|
| [`index.js`](file:///d:/Collage/AAAAAAAAAAAAAAA/EncryptChat/p2p-ssh/index.js) | Main application logic: CLI command parsing, SSH server/client engine, auto-discovery worker, and message outbox retry. |
| [`ui.js`](file:///d:/Collage/AAAAAAAAAAAAAAA/EncryptChat/p2p-ssh/ui.js) | Blessed terminal screen management, key bindings (PgUp/PgDn, Ctrl+C), auto-scrolling, and formatted message append helpers. |
| [`db.js`](file:///d:/Collage/AAAAAAAAAAAAAAA/EncryptChat/p2p-ssh/db.js) | SQLite schema initialization (`peers` and `messages` tables). |

---

## 🔄 3. How the Message Flow Works

### Outbound Flow (Sending a Message):
1. **User Input**: User types a message in the Blessed text box and presses `Enter`.
2. **Local Storage**: Message is inserted into local SQLite `messages` table with initial `Status = 'sent'` or `'pending'`.
3. **Local Render**: Rendered immediately on your own terminal screen as `{green-fg}You{/green-fg}: message`.
4. **Parallel SSH Transmission**:
   - Queries `peers` table for trusted remote public keys.
   - Fires `sendMessage()` to all active peer IP addresses **in parallel** using `Promise.all`.
   - Opens an SSH channel using your private key (`id_ed25519`) with a **3-second timeout**.

### Inbound Flow (Receiving a Message):
1. **SSH Handshake**: Incoming SSH client connects. The server inspects the incoming OpenSSH public key (`ctx.key`).
2. **Strict Public Key Lookup**: The server extracts the raw base64 key hash and matches it against your local SQLite `peers` database.
3. **Authentication**: If the key is found in your `peers` database, the connection is accepted (`ctx.accept()`). Otherwise, rejected.
4. **Name Resolution**: The receiver resolves the sender's display name **100% strictly from its local `peers` table** (`phone`, `pc`, etc.).
5. **UI & DB Update**: Message is stored in local SQLite DB and appended to your Blessed terminal screen in real-time.

---

## 🚀 4. Summary of All Important Changes & Improvements Made

Here is a chronological summary of all key fixes and architectural enhancements added to the codebase:

### 1️⃣ Dynamic Multi-Instance & Configurable Ports/Directories
- **Before**: Data directory (`.myapp`) and SSH port (`2222`) were hardcoded. Running two instances on one PC caused port collision (`EADDRINUSE`) and SQLite file lock conflicts.
- **After**: Added support for CLI arguments and environment variables:
  ```bash
  node index.js [dataDir] [port] [name]
  # Example: node index.js .myapp1 2222 PC
  ```

### 2️⃣ Robust Dual Auto-Discovery (UDP Broadcast + mDNS)
- **Fixed `Buffer.trim()` Crash Bug**: `bonjour-service` returned TXT keys as Node `Buffer` instances. Calling `.trim()` directly threw a `TypeError` and silently killed mDNS discovery. Added safe base64 key extraction (`getRawKeyData`).
- **UDP Subnet Broadcast**: Added a native UDP broadcast beacon (`dgram` on port `22222`) that calculates exact interface subnet broadcast IPs (`getBroadcastAddresses`).
- **Discovered Device Notifications**: Displays real-time notices (`[Discovered Device] Active node found at 192.168.x.x:2222`) whenever a node appears on your Wi-Fi.

### 3️⃣ Strict Peer Name Resolution (Eliminated `localhost` / `myapp` / `You`)
- **Before**: Inbound messages displayed `You: message` or `localhost: message` because remote payloads sent default folder names (`myapp` or `os.hostname()`).
- **After**: The SSH server captures the authenticated incoming SSH public key (`client.incomingRawKey`) and queries the local SQLite `peers` database. The name you assigned via `/addpeer <name> <pubkey>` is **100% strictly used** as the sender name.

### 4️⃣ Blessed UI Buffer Protection
- **Before**: Raw `console.log` statements inside the SSH transmission stream (`sendMessage`) output directly to `process.stdout`, breaking terminal box borders and spilling text into the chat input line.
- **After**: Removed raw `console.log` calls from active networking loops to keep the terminal screen perfectly rendered.

### 5️⃣ High-Speed Parallel Transmission
- **Before**: Sending messages used a sequential `for...of` loop with `await sendMessage(...)`. If an offline IP was in the database, `ssh2` waited for the default 20-second connection timeout per offline peer before reaching active devices.
- **After**: 
  - Converted transmission to **`Promise.all` parallel sending**.
  - Set **`readyTimeout: 3000`** (3s max connection timeout).
  - Messages now deliver in **milliseconds**!

---

## ⌨️ 5. Complete CLI Slash Commands Reference

Inside the chat interface input box, you can run the following slash commands:

| Command | Usage | Description |
|---|---|---|
| `/help` | `/help` | Displays available CLI slash commands. |
| `/mykey` | `/mykey` | Displays your OpenSSH Public Key to easily copy and share. |
| `/setname` | `/setname <new_name>` | Dynamically updates your device's display name. |
| `/addpeer` | `/addpeer <name> <pubkey> [ip] [port]` | Adds a trusted peer to your local database with optional IP and port. |
| `/setip` | `/setip <peer_name> <ip> [port]` | Manually updates a peer's IP address and port. |
| `/peers` | `/peers` | Lists all trusted & discovered peers stored in your local DB. |
| `/ping` | `/ping <peer_name>` | Pings a peer over SSH to measure round-trip latency (in ms). |
| `/removepeer`| `/removepeer <name>` | Removes a peer from your database. |
| `/search` | `/search <keyword>` | Searches past chat messages for a specific word. |
| `/outbox` | `/outbox` | Displays pending/undelivered messages. |
| `/export` | `/export <filename>` | Exports chat history to a JSON file. |
| `/clear` | `/clear` | Clears the current chat history screen. |
| `/quit` | `/quit` | Exits the application safely. |

---

## 🧪 6. How to Run & Test

### Testing on Same PC (2 Terminals):
```powershell
# Terminal 1 (Instance 1)
node index.js .myapp1 2222 PC1

# Terminal 2 (Instance 2)
node index.js .myapp2 2223 PC2
```

### Testing across Wi-Fi (PC & Termux Phone):
```bash
# On PC
node index.js .myapp 2222 PC

# On Termux Phone
node index.js .myapp 2222 Phone
```
1. Add each other via `/addpeer <name> <pubkey>`.
2. Auto-discovery will find the IP addresses within seconds!
3. Start chatting seamlessly!
