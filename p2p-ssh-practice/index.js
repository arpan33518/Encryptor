const os = require("os");
const fs = require("fs").promises;
const path = require("path");
const util = require("util");
const crypto = require("crypto");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const ssh2 = require("ssh2");
const { initDb } = require("./db");
const { initUI } = require("./ui");

// Configurable settings via CLI arguments or Environment Variables
const customFolder = process.env.APP_DIR || process.argv[2] || ".myapp";
const appDir = path.isAbsolute(customFolder)
  ? customFolder
  : path.join(os.homedir(), customFolder);
const PORT = parseInt(process.env.PORT || process.argv[3] || "2222", 10);
let myName = process.env.PEER_NAME || process.argv[4] || "Node";

// Global variables for keys and DB
let db;
let existingPrivKey;
let existingPubKey;

// ============================================================================
// 🛠️ NETWORKING WORKSHOP - YOUR HANDS-ON TASKS
// ============================================================================

/**
 * ✍️ TASK 1: Extract Base64 Key Hash from OpenSSH Key String
 * @param {string} pubKeyStr - e.g. "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... user@host"
 * @returns {string} - strictly the base64 portion ("AAAAC3NzaC1lZDI1NTE5AAAAI...")
 */
function getRawKeyData(pubKeyStr) {
  // TODO: Write your code here
  return "";
}

/**
 * ✍️ TASK 2: Calculate Active IPv4 Subnet Broadcast Addresses
 * @returns {Array<string>} - Array of target broadcast IPs, e.g. ["255.255.255.255", "192.168.1.255"]
 */
function getBroadcastAddresses() {
  // TODO: Write your code here to calculate subnet broadcasts using os.networkInterfaces()
  return ["255.255.255.255"];
}

/**
 * ✍️ TASK 3: Update Peer IP & Port in SQLite DB
 * Search 'peers' table in database using getRawKeyData().
 * If matched, update IP and Port columns in SQLite database and notify UI.
 */
async function updatePeerAddress(database, pubKey, ip, port, appendMessage) {
  // TODO: Write your code here
}

/**
 * ✍️ TASK 4: Outbound SSH Client Transmission
 * Connect to host:port using ssh2.Client with a readyTimeout: 3000.
 * Open an 'exec' session for "send_msg", write messageObject JSON payload, and resolve response.
 */
function sendMessage(host, port, privateKey, messageObject) {
  return new Promise((resolve, reject) => {
    // TODO: Write your ssh2.Client outbound connection code here
    reject(new Error("sendMessage not implemented yet"));
  });
}

/**
 * ✍️ TASK 5: Start Inbound SSH Server Engine
 * Create an ssh2.Server listening on `port`.
 * On 'authentication', check incoming key (ctx.key) against 'peers' table in database using getRawKeyData().
 * On 'ready' -> 'session' -> 'exec', receive JSON payload, resolve peer name strictly from database, insert into messages table, and call appendMessage().
 */
async function startSSHEngine(privateKey, database, appendMessage, port = 2222) {
  // TODO: Write your ssh2.Server inbound listener code here
}

/**
 * ✍️ TASK 6: Dual Peer Auto-Discovery (UDP Subnet Broadcast + mDNS)
 * 1. Create a UDP socket (dgram) listening on port 22222 with reuseAddr: true.
 * 2. Broadcast beacon JSON payloads every 4s to all target broadcast addresses from getBroadcastAddresses().
 * 3. Handle incoming UDP messages and call updatePeerAddress().
 * 4. Also publish and browse mDNS service using Bonjour.
 */
function startDiscovery(database, ownPubKey, appendMessage, setStatus, port = 2222) {
  // TODO: Write your UDP dgram beacon & Bonjour discovery code here
}

// ============================================================================
// 🚀 APPLICATION INITIALIZATION & CLI COMMAND HANDLERS
// ============================================================================

async function checkAppFiles() {
  const keyFile = path.join(appDir, "id_ed25519");
  const pubKeyFile = path.join(appDir, "id_ed25519.pub");
  const dbPath = path.join(appDir, "chat.db");

  try { await fs.access(appDir); } catch (err) { await fs.mkdir(appDir, { recursive: true }); }

  db = await open({ filename: dbPath, driver: sqlite3.Database });
  await initDb(db);

  try {
    existingPrivKey = await fs.readFile(keyFile, "utf8");
    existingPubKey = await fs.readFile(pubKeyFile, "utf8");
  } catch (err) {
    const generateKeyPair = util.promisify(ssh2.utils.generateKeyPair);
    const keys = await generateKeyPair("ed25519");
    existingPrivKey = keys.private;
    existingPubKey = keys.public;
    await fs.writeFile(keyFile, existingPrivKey, { mode: 0o600 });
    await fs.writeFile(pubKeyFile, existingPubKey);
  }

  let appendMessage;

  const uiElements = initUI(async (text) => {
    if (text.startsWith("/")) {
      const parts = text.trim().split(" ");
      const cmd = parts[0].toLowerCase();

      if (cmd === "/help") {
        if (appendMessage) {
          appendMessage("System", "Available CLI Commands:");
          appendMessage("System", "  /help                    - Show command help");
          appendMessage("System", "  /mykey                   - Display your public key");
          appendMessage("System", "  /setname <name>          - Change your display name");
          appendMessage("System", "  /peers                   - List all trusted peers");
          appendMessage("System", "  /addpeer <name> <pubkey> - Manually add trusted peer");
          appendMessage("System", "  /setip <peer> <ip>       - Manually set peer IP");
          appendMessage("System", "  /ping <peer_name>        - Ping a peer");
          appendMessage("System", "  /clear                   - Clear screen");
          appendMessage("System", "  /quit                    - Exit application");
        }
        return;
      }

      if (cmd === "/mykey" || cmd === "/key") {
        if (appendMessage) {
          appendMessage("System", "Your Public Key:");
          appendMessage("System", existingPubKey.trim());
        }
        return;
      }

      if (cmd === "/setname" || cmd === "/name") {
        const newName = parts.slice(1).join(" ");
        if (!newName) {
          if (appendMessage) appendMessage("System", `Your name is: "${myName}"`);
          return;
        }
        myName = newName;
        if (appendMessage) appendMessage("System", `Display name set to: "${myName}"`);
        return;
      }

      if (cmd === "/addpeer") {
        const name = parts[1];
        if (!name || parts.length < 3) {
          if (appendMessage) appendMessage("System", "Usage: /addpeer <name> <ssh-ed25519 AAA...> [ip] [port]");
          return;
        }
        let ip = null;
        let port = 2222;
        let keyParts = parts.slice(2);
        if (keyParts.length >= 3 && !isNaN(keyParts[keyParts.length - 1]) && keyParts[keyParts.length - 2].includes(".")) {
          port = parseInt(keyParts.pop(), 10);
          ip = keyParts.pop();
        } else if (keyParts.length >= 2 && keyParts[keyParts.length - 1].includes(".")) {
          ip = keyParts.pop();
        }
        const pubkey = keyParts.join(" ");

        await db.run("INSERT OR REPLACE INTO peers (public_key, name, ip, port) VALUES (?, ?, ?, ?)", [pubkey, name, ip, port]);
        if (appendMessage) appendMessage("System", `Added peer "${name}"${ip ? ` (${ip}:${port})` : ""}`);
        return;
      }

      if (cmd === "/setip") {
        const name = parts[1];
        const ip = parts[2];
        const port = parts[3] ? parseInt(parts[3], 10) : 2222;
        if (!name || !ip) {
          if (appendMessage) appendMessage("System", "Usage: /setip <peer_name> <ip_address> [port]");
          return;
        }
        await db.run("UPDATE peers SET ip = ?, port = ? WHERE LOWER(name) = LOWER(?)", [ip, port, name]);
        if (appendMessage) appendMessage("System", `Updated ${name}'s IP to ${ip}:${port}`);
        return;
      }

      if (cmd === "/peers") {
        const peers = await db.all("SELECT * FROM peers");
        if (!peers || peers.length === 0) {
          if (appendMessage) appendMessage("System", "No peers currently stored.");
        } else {
          if (appendMessage) {
            appendMessage("System", "--- Known Peers ---");
            for (const p of peers) {
              const shortKey = p.public_key ? p.public_key.substring(0, 25) + "..." : "N/A";
              appendMessage("System", `Name: ${p.name || "Unknown"} | IP: ${p.ip || "N/A"}:${p.port || 2222} | Key: ${shortKey}`);
            }
          }
        }
        return;
      }

      if (cmd === "/ping") {
        const peerName = parts[1];
        if (!peerName) {
          if (appendMessage) appendMessage("System", "Usage: /ping <peer_name>");
          return;
        }
        try {
          const peer = await db.get("SELECT * FROM peers WHERE LOWER(name) = LOWER(?)", [peerName]);
          if (!peer || !peer.ip) {
            if (appendMessage) appendMessage("System", `Peer "${peerName}" IP unknown.`);
            return;
          }
          const pingPayload = { type: "ping", Timestamp: Date.now() };
          const response = await sendMessage(peer.ip, peer.port || 2222, existingPrivKey, pingPayload);
          if (response && response.type === "pong") {
            const latency = Date.now() - pingPayload.Timestamp;
            if (appendMessage) appendMessage("System", `Ping to ${peer.name}: ${latency}ms`);
          } else {
            if (appendMessage) appendMessage("System", `Ping to ${peer.name}: No response.`);
          }
        } catch (err) {
          if (appendMessage) appendMessage("System", `Ping error: ${err.message}`);
        }
        return;
      }

      if (cmd === "/clear") { uiElements.clearHistory(); return; }
      if (cmd === "/quit") { process.exit(0); }
      return;
    }

    // Handle outbound user typing
    const messageObject = {
      Message_Id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      Sender: myName,
      Receiver: "Peer",
      Content: text,
      Timestamp: Date.now(),
      Status: "sent",
    };

    try {
      await db.run(
        "INSERT INTO messages (Message_Id, Sender, Receiver, Content, Timestamp, Status) VALUES (?, ?, ?, ?, ?, ?)",
        [messageObject.Message_Id, messageObject.Sender, messageObject.Receiver, messageObject.Content, messageObject.Timestamp, messageObject.Status]
      );

      if (appendMessage) appendMessage("You", text, messageObject.Timestamp);

      const trustedPeers = await db.all("SELECT * FROM peers WHERE public_key != ?", [existingPubKey]);

      if (trustedPeers && trustedPeers.length > 0) {
        const sendPromises = trustedPeers.map(async (peer) => {
          if (!peer.ip || peer.ip === "127.0.0.1") return false;
          try {
            await sendMessage(peer.ip, peer.port || 2222, existingPrivKey, messageObject);
            return true;
          } catch (err) { return false; }
        });
        await Promise.all(sendPromises);
      }
    } catch (err) {
      if (appendMessage) appendMessage("System", `Failed to store message: ${err.message}`);
    }
  });

  appendMessage = uiElements.appendMessage;
  uiElements.setStatus(`{green-fg}Status: Online (Listening on port ${PORT}){/green-fg}`);

  appendMessage("System", "P2P SSH Chat Practice Workshop. Complete your networking functions to get online!");

  // Call networking functions
  await startSSHEngine(existingPrivKey, db, appendMessage, PORT);
  startDiscovery(db, existingPubKey, appendMessage, uiElements.setStatus, PORT);
}

checkAppFiles();
