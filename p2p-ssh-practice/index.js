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
// 🛠️ NETWORKING TASK STUBS (YOUR LEARNING WORKSHOP)
// ============================================================================

/**
 * ✍️ TASK 1: Extract Base64 Key Hash from OpenSSH Key String
 * OpenSSH keys look like: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... user@host"
 * Write a function that returns strictly the base64 part ("AAAAC3Nza...").
 */
function getRawKeyData(pubKeyStr) {
  // TODO: Implement getRawKeyData(pubKeyStr)
  if (!pubKeyStr) return "";
  const parts = String(pubKeyStr).trim().split(/\s+/);
  if (parts.length >= 2 && parts[0].startsWith("ssh-")) {
    return parts[1];
  }
  return parts[0];
}

/**
 * ✍️ TASK 2: Calculate Active IPv4 Subnet Broadcast Addresses
 * Calculate all subnet broadcast IPs (e.g. 192.168.1.255) for all non-internal IPv4 interfaces.
 */
function getBroadcastAddresses() {
  // TODO: Implement getBroadcastAddresses()
  const broadcasts = new Set(["255.255.255.255"]);
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name]) {
        if (net.family === "IPv4" && !net.internal) {
          const ipParts = net.address.split(".").map(Number);
          const maskParts = net.netmask.split(".").map(Number);
          const broadcastParts = ipParts.map(
            (ip, i) => ip | (~maskParts[i] & 255),
          );
          broadcasts.add(broadcastParts.join("."));
        }
      }
    }
  } catch (e) {}
  return Array.from(broadcasts);
}

/**
 * ✍️ TASK 3: Update Peer IP & Port in SQLite DB
 * Given a discovered public key, IP, and Port, match against 'peers' table in DB
 * using getRawKeyData() and update IP and Port.
 */
async function updatePeerAddress(database, pubKey, ip, port, appendMessage) {
  // TODO: Practice writing updatePeerAddress logic
  try {
    if (!pubKey || !ip || ip === "127.0.0.1" || ip.startsWith("127.")) return;
    const rawDiscoveredKey = getRawKeyData(pubKey);
    if (!rawDiscoveredKey) return;

    const peers = await database.all("SELECT * FROM peers");
    let matchedPeer = null;

    if (peers && peers.length > 0) {
      for (const p of peers) {
        if (p.public_key && getRawKeyData(p.public_key) === rawDiscoveredKey) {
          matchedPeer = p;
          break;
        }
      }
    }

    if (matchedPeer) {
      if (matchedPeer.ip !== ip || matchedPeer.port !== port) {
        await database.run(
          "UPDATE peers SET ip = ?, port = ? WHERE public_key = ?",
          [ip, port, matchedPeer.public_key],
        );
        if (appendMessage) {
          appendMessage(
            "System",
            `[Auto-Discovered] Peer "${matchedPeer.name || "Unknown"}" active at ${ip}:${port}`,
          );
        }
      }
    }
  } catch (e) {}
}

/**
 * ✍️ TASK 4: Outbound SSH Client Transmission
 * Connect to host:port using ssh2 Client and execute "send_msg" channel payload.
 */
function sendMessage(host, port, privateKey, messageObject) {
  return new Promise((resolve, reject) => {
    const { Client } = require("ssh2");
    const conn = new Client();

    conn.on("ready", () => {
      conn.exec("send_msg", (err, stream) => {
        if (err) {
          conn.end();
          return reject(err);
        }
        let responsedata = "";
        stream.on("data", (chunk) => {
          responsedata += chunk.toString();
        });

        const payload = JSON.stringify(messageObject);
        stream.write(payload);
        stream.end();

        stream.on("close", () => {
          conn.end();
          let responseObj = null;
          if (responsedata) {
            try { responseObj = JSON.parse(responsedata); } catch (e) {}
          }
          resolve(responseObj);
        });
      });
    });

    conn.on("error", (err) => reject(err));

    conn.connect({
      host: host,
      port: port,
      username: "peer",
      privateKey: privateKey,
      readyTimeout: 3000,
    });
  });
}

/**
 * ✍️ TASK 5: Start Inbound SSH Server Engine
 * Listen for incoming SSH connections, verify public key against local SQLite DB,
 * and receive incoming message payload.
 */
async function startSSHEngine(privateKey, database, appendMessage, port = 2222) {
  const server = new ssh2.Server({ hostKeys: [privateKey] }, (client) => {
    client.on("authentication", async (ctx) => {
      if (ctx.method !== "publickey") return ctx.reject(["publickey"]);
      try {
        const incomingKey = `${ctx.key.algo} ${ctx.key.data.toString("base64")}`;
        const rawIncomingKey = getRawKeyData(incomingKey);
        client.incomingRawKey = rawIncomingKey;

        const peers = await database.all("SELECT * FROM peers");
        let matchedPeer = null;

        if (peers && peers.length > 0) {
          for (const p of peers) {
            if (p.public_key && getRawKeyData(p.public_key) === rawIncomingKey) {
              matchedPeer = p;
              break;
            }
          }
        }

        if (matchedPeer) {
          client.authenticatedPeerName = matchedPeer.name || "Peer";
          return ctx.accept();
        } else {
          return ctx.reject();
        }
      } catch (err) {
        return ctx.reject();
      }
    });

    client.on("ready", () => {
      client.on("session", (accept) => {
        const session = accept();
        session.once("exec", (accept) => {
          const stream = accept();
          let rawData = "";
          stream.on("data", (chunk) => { rawData += chunk.toString(); });
          stream.on("end", async () => {
            try {
              const dataObject = JSON.parse(rawData);
              let senderDisplayName = "Unknown Peer";
              if (client.incomingRawKey) {
                const currentPeers = await database.all("SELECT * FROM peers");
                if (currentPeers && currentPeers.length > 0) {
                  for (const p of currentPeers) {
                    if (p.public_key && getRawKeyData(p.public_key) === client.incomingRawKey) {
                      if (p.name) { senderDisplayName = p.name; break; }
                    }
                  }
                }
              }
              if (senderDisplayName === "Unknown Peer" && client.authenticatedPeerName) {
                senderDisplayName = client.authenticatedPeerName;
              }

              await database.run(
                "INSERT INTO messages (Message_Id, Sender, Receiver, Content, Timestamp, Status) VALUES (?, ?, ?, ?, ?, ?)",
                [dataObject.Message_Id, senderDisplayName, "You", dataObject.Content, dataObject.Timestamp, dataObject.Status || "received"]
              );

              if (appendMessage) {
                appendMessage(senderDisplayName, dataObject.Content, dataObject.Timestamp);
              }
              stream.exit(0);
            } catch (err) {} finally { stream.end(); }
          });
        });
      });
    });
  });

  server.listen(port, "0.0.0.0");
}

/**
 * ✍️ TASK 6: Dual UDP & mDNS Peer Auto-Discovery
 */
function startDiscovery(database, ownPubKey, appendMessage, setStatus, port = 2222) {
  const cleanOwnKey = String(ownPubKey).trim();
  const ownRawKey = getRawKeyData(cleanOwnKey);

  const dgram = require("dgram");
  const udpSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const BEACON_PORT = 22222;

  udpSocket.on("error", () => {});
  udpSocket.on("message", async (msg, rinfo) => {
    try {
      const payload = JSON.parse(msg.toString());
      if (payload && payload.type === "p2p-beacon" && payload.pubkey) {
        const remotePubKey = String(payload.pubkey).trim();
        const remotePort = payload.port || 2222;
        const remoteIp = rinfo.address;

        if (getRawKeyData(remotePubKey) === ownRawKey) return;
        if (remoteIp === "127.0.0.1" || remoteIp.startsWith("127.")) return;

        await updatePeerAddress(database, remotePubKey, remoteIp, remotePort, appendMessage);
      }
    } catch (e) {}
  });

  udpSocket.bind(BEACON_PORT, "0.0.0.0", () => {
    try { udpSocket.setBroadcast(true); } catch (e) {}
  });

  setInterval(() => {
    try {
      const beaconMsg = Buffer.from(
        JSON.stringify({ type: "p2p-beacon", pubkey: cleanOwnKey, port: port })
      );
      const targets = getBroadcastAddresses();
      for (const targetIp of targets) {
        udpSocket.send(beaconMsg, 0, beaconMsg.length, BEACON_PORT, targetIp, () => {});
      }
    } catch (e) {}
  }, 4000);

  if (appendMessage) {
    appendMessage("System", "Auto-Discovery active: broadcasting presence on local network.");
  }
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

  appendMessage("System", "P2P SSH Chat Practice Base online. Type /help for commands.");

  // Start networking services
  await startSSHEngine(existingPrivKey, db, appendMessage, PORT);
  startDiscovery(db, existingPubKey, appendMessage, uiElements.setStatus, PORT);
}

checkAppFiles();
