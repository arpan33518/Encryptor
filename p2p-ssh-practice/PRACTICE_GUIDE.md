# 🧪 P2P Networking Hands-On Workshop & Practice Guide

Welcome to your standalone practice project folder: **`p2p-ssh-practice`**!

This directory contains the full **UI (`ui.js`)**, **SQLite DB (`db.js`)**, and **CLI Slash Commands framework (`index.js`)**.

Your goal is to build, test, and master the **6 Networking Functions** in `index.js` yourself.

---

## 📂 Practice Directory Structure

```
d:\Collage\AAAAAAAAAAAAAAA\EncryptChat\p2p-ssh-practice\
├── package.json        (Dependencies ready: blessed, ssh2, sqlite3, bonjour-service)
├── db.js              (SQLite database schema ready)
├── ui.js              (Blessed Terminal canvas ready)
├── index.js           (Starter script with task stubs & CLI commands)
└── PRACTICE_GUIDE.md  (This step-by-step learning guide)
```

---

## 🏃 How to Run your Practice Code

Open your terminal in `p2p-ssh-practice` and run:

```powershell
cd d:\Collage\AAAAAAAAAAAAAAA\EncryptChat\p2p-ssh-practice
npm install
node index.js .myapp1 2222 PC1
```

---

## 📝 The 6 Networking Tasks to Complete in `index.js`

### 1️⃣ Task 1: `getRawKeyData(pubKeyStr)`
* **Objective**: Convert OpenSSH public keys (`"ssh-ed25519 AAAAC3N... user@pc\n"`) into clean cryptographic base64 strings (`"AAAAC3N..."`).
* **Why**: Prevents hostname mismatches during discovery and database lookups.

---

### 2️⃣ Task 2: `getBroadcastAddresses()`
* **Objective**: Use `require('os').networkInterfaces()` to find all non-internal IPv4 interfaces and calculate their broadcast IPs (e.g. `192.168.1.255`).
* **Why**: Router boundaries block `255.255.255.255`. Subnet broadcast guarantees UDP reachability.

---

### 3️⃣ Task 3: `updatePeerAddress(db, pubKey, ip, port, appendMessage)`
* **Objective**: Search `peers` table in SQLite using `getRawKeyData()`. If a matching peer is found, update `ip` and `port` columns and announce auto-discovery in UI.
* **Why**: Auto-resolves peer IP address changes on Wi-Fi without hardcoding.

---

### 4️⃣ Task 4: `sendMessage(host, port, privateKey, messageObject)`
* **Objective**: Use `require('ssh2').Client` to open an encrypted SSH connection to a remote peer. Pass `readyTimeout: 3000` to prevent 20-second connection hangs.
* **Why**: Delivers end-to-end encrypted message payloads over custom `exec` channels.

---

### 5️⃣ Task 5: `startSSHEngine(privateKey, db, appendMessage, port)`
* **Objective**: Start an SSH server (`ssh2.Server`). On `client.on('authentication')`, check incoming key against local `peers` DB. When payload arrives, query DB by `client.incomingRawKey` to strictly resolve the sender display name (`phone`, `pc`).
* **Why**: Guarantees end-to-end authentication and ensures local database assigns the sender display name.

---

### 6️⃣ Task 6: `startDiscovery(db, ownPubKey, appendMessage, setStatus, port)`
* **Objective**: Create a UDP socket (`dgram` on port 22222) with `reuseAddr: true`. Broadcast node heartbeat beacons every 4s to all target broadcast addresses.
* **Why**: Enables automatic local network peer discovery without central servers.

---

## 💡 Quick Tips
* If you get stuck or want to check reference implementations, view the complete solution in `..\p2p-ssh\index.js`.
* Run two instances on your PC to test your practice code:
  * Terminal 1: `node index.js .myapp1 2222 Node1`
  * Terminal 2: `node index.js .myapp2 2223 Node2`
