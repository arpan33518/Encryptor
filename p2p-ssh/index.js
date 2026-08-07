const os = require("os");
const fs = require("fs").promises;
const path = require("path");
const util = require("util");
const crypto = require("crypto");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const { initDb } = require("./db");
const ssh2 = require("ssh2");
const { initUI } = require("./ui");
const { Bonjour } = require("bonjour-service");
const { startLibp2pEngine } = require("./p2p");

async function checkAppFiles() {
  const homeDir = os.homedir();

  // Construct the paths
  const appDir = path.join(homeDir, ".myapp");
  const keyFile = path.join(appDir, "id_ed25519");
  const pubKeyFile = path.join(appDir, "id_ed25519.pub");
  const dbPath = path.join(appDir, "chat.db");

  try {
    // Check if directory exists
    await fs.access(appDir);
    console.log(`Directory exists: ${appDir}`);
  } catch (err) {
    console.log("Directory does not exist : Creating it now...");
    // Create the Directory
    await fs.mkdir(appDir, { recursive: true });
    console.log(`Successfully created directory: ${appDir}`);
  }

  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });
  console.log(`Connected to the SQLite database at ${dbPath}`);

  // Initialize DB tables
  await initDb(db);

  let existingPrivKey;
  let existingPubKey;
  try {
    // Check if key file exists
    await fs.access(keyFile);
    console.log(`Key file exists: ${keyFile}`);

    // Read and print the existing public key (safe to print)
    existingPubKey = await fs.readFile(pubKeyFile, "utf8");
    console.log("\n--- YOUR PUBLIC KEY ---");
    console.log(existingPubKey);

    // Read and print the existing public key (safe to print)
    existingPrivKey = await fs.readFile(keyFile, "utf8");
    console.log("\n--- YOUR PRIVATE KEY ---");
    console.log(existingPrivKey);
  } catch (err) {
    console.log("Key file does not exist : Generating new Ed25519 key pair...");

    const generateKeyPair = util.promisify(ssh2.utils.generateKeyPair);
    const keys = await generateKeyPair("ed25519");

    existingPrivKey = keys.private;
    existingPubKey = keys.public;

    // Write private key with strict permissions (0o600)
    await fs.writeFile(keyFile, existingPrivKey, { mode: 0o600 });
    // Write public key
    await fs.writeFile(pubKeyFile, existingPubKey);

    console.log(`Private key created: ${keyFile}`);
    console.log(`Public key created:  ${pubKeyFile}`);
  }

  // Add yourself as a trusted peer sow you can test locally!
  await db.run("INSERT OR IGNORE INTO peers (public_key, name) VALUES (?, ?)", [
    existingPubKey,
    "Arpan",
  ]);

  // Declare appendMessage variable so it can be referenced in callbacks
  let appendMessage;

  // Start the UI and handle outbound user typing
  const uiElements = initUI(async (text) => {
    // 0. Handle CLI Slash Commands
    if (text.startsWith("/")) {
      const parts = text.trim().split(" ");
      const cmd = parts[0].toLowerCase();

      if (cmd === "/help") {
        if (appendMessage) {
          appendMessage("System", "Available CLI Commands:");
          appendMessage("System", "  /help                    - Show command help");
          appendMessage("System", "  /peers                   - List all trusted & discovered peers");
          appendMessage("System", "  /addpeer <name> <pubkey> - Manually add a trusted peer");
          appendMessage("System", "  /clear                   - Clear screen history");
          appendMessage("System", "  /quit                    - Exit application");
        }
        return;
      }

      if (cmd === "/clear") {
        uiElements.clearHistory();
        return;
      }

      if (cmd === "/quit") {
        process.exit(0);
      }

      if (cmd === "/peers") {
        const peers = await db.all("SELECT * FROM peers");
        if (!peers || peers.length === 0) {
          if (appendMessage) appendMessage("System", "No peers currently stored in database.");
        } else {
          if (appendMessage) {
            appendMessage("System", "--- Known Peers ---");
            for (const p of peers) {
              const shortKey = p.public_key ? p.public_key.substring(0, 25) + "..." : "N/A";
              appendMessage("System", `Name: ${p.name || 'Unknown'} | IP: ${p.ip || '127.0.0.1'}:${p.port || 2222} | Key: ${shortKey}`);
            }
          }
        }
        return;
      }

      if (cmd === "/addpeer") {
        const name = parts[1];
        const pubkey = parts.slice(2).join(" ");
        if (!name || !pubkey) {
          if (appendMessage) appendMessage("System", "Usage: /addpeer <name> <ssh-ed25519 AAA...>");
          return;
        }
        await db.run("INSERT OR REPLACE INTO peers (public_key, name) VALUES (?, ?)", [pubkey, name]);
        if (appendMessage) appendMessage("System", `Successfully added peer "${name}".`);
        return;
      }

      if (appendMessage) appendMessage("System", `Unknown command "${cmd}". Type /help for available commands.`);
      return;
    }

    const messageObject = {
      Message_Id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      Sender: "You",
      Receiver: "Arpan",
      Content: text,
      Timestamp: Date.now(),
      Status: "pending",
    };

    try {
      // 1. Insert into local SQLite database with initial status 'pending'
      await db.run(
        "INSERT INTO messages (Message_Id, Sender, Receiver, Content, Timestamp, Status) VALUES (?, ?, ?, ?, ?, ?)",
        [
          messageObject.Message_Id,
          messageObject.Sender,
          messageObject.Receiver,
          messageObject.Content,
          messageObject.Timestamp,
          messageObject.Status,
        ],
      );

      // 2. Display in local UI box
      if (appendMessage) {
        appendMessage("You", text, messageObject.Timestamp);
      }

      // 3. Transmit outbound message over SSH connection to known peers
      const trustedPeers = await db.all(
        "SELECT * FROM peers WHERE public_key != ?",
        [existingPubKey],
      );

      let sentToPeer = false;
      if (trustedPeers && trustedPeers.length > 0) {
        for (const peer of trustedPeers) {
          const host = peer.ip || "127.0.0.1";
          const port = peer.port || 2222;
          try {
            await sendMessage(host, port, existingPrivKey, messageObject);
            sentToPeer = true;
          } catch (err) {
            // If individual peer fails, log and keep in outbox
          }
        }
      }

      if (sentToPeer) {
        // Update database status to 'sent' once successfully pushed
        await db.run("UPDATE messages SET Status = 'sent' WHERE Message_Id = ?", [
          messageObject.Message_Id,
        ]);
      } else {
        if (appendMessage) {
          appendMessage("System", "Peer unavailable. Message saved in Outbox for automatic retry.");
        }
      }
    } catch (err) {
      if (appendMessage) {
        appendMessage("System", `Failed to store message: ${err.message}`);
      }
    }
  });

  // Extract the appendMessage function so we can use it
  appendMessage = uiElements.appendMessage;
  uiElements.setStatus("{green-fg}Status: Online (Listening on port 2222){/green-fg}");

  // Load past chat history from SQLite DB
  try {
    const history = await db.all("SELECT * FROM messages ORDER BY Timestamp ASC");
    for (const msg of history) {
      appendMessage(msg.Sender, msg.Content, msg.Timestamp);
    }
  } catch (err) {
    appendMessage("System", `Failed to load chat history: ${err.message}`);
  }

  appendMessage("System", "P2P SSH Chat Engine online. Type /help to view available commands.");

  // Start the Outbox Worker to attempt re-delivering pending messages in the background
  startOutboxWorker(db, existingPrivKey, existingPubKey, appendMessage);

  // Pass appendMessage to the SSH engine so incoming network payloads update the UI
  await startSSHEngine(existingPrivKey, db, appendMessage);

  // Start mDNS peer broadcasting and listening
  startDiscovery(db, existingPubKey, appendMessage, uiElements.setStatus);

  // Start libp2p Internet Routing & DHT Discovery Engine (Phase 6B)
  await startLibp2pEngine(existingPubKey, appendMessage, async (peerId, ip, port) => {
    try {
      if (!ip || !port) return;
      // Auto-update peer addresses found via global P2P network
      const existing = await db.all("SELECT * FROM peers");
      if (existing && existing.length > 0) {
        for (const p of existing) {
          if (p.public_key !== existingPubKey) {
            await db.run("UPDATE peers SET ip = ?, port = ? WHERE public_key = ?", [ip, port, p.public_key]);
          }
        }
      }
    } catch (e) {
      // Ignore DB callback errors
    }
  });
}

checkAppFiles();

async function startSSHEngine(privateKey, db, appendMessage) {
  const server = new ssh2.Server(
    {
      hostKeys: [privateKey], // The server's identity
    },
    (client) => {
      // The authentication event fires when someone tries to log in
      client.on("authentication", async (ctx) => {
        // 1. Block anything that isn't a public key (like passwords)
        if (ctx.method !== "publickey") return ctx.reject(["publickey"]);

        try {
          // 2. Reconstruct incoming OpenSSH public key string
          const incomingKey = `${ctx.key.algo} ${ctx.key.data.toString("base64")}`;

          // 3. Ask SQLite if this key exists in our 'peers' table
          const peer = await db.get(
            "SELECT * FROM peers WHERE public_key = ?",
            [incomingKey],
          );

          // 4. Make the decision
          if (peer) {
            return ctx.accept(); // Let them in!
          } else {
            return ctx.reject(); // Kick them out!
          }
        } catch (err) {
          return ctx.reject(); // If the DB fails, fail securely by rejecting
        }
      });

      // 2. Ready Event (Triggered if ctx.accept() is called above)
      client.on("ready", () => {
        // 1. Listen for the client requesting a session
        client.on("session", (accept, reject) => {
          const session = accept();

          // 2. Listen for the client requesting to 'exec' (send data)
          session.once("exec", (accept, reject, info) => {
            const stream = accept(); // Open the data pipeline!

            let rawData = "";

            // 3. As data flows through the tunnel, piece it together
            stream.on("data", (chunk) => {
              rawData += chunk.toString();
            });

            // 4. The client has finished sending the message
            stream.on("end", async () => {
              try {
                // Converting raw data to JSON
                const dataObject = JSON.parse(rawData);
                
                // Inserting to database
                const query =
                  "INSERT INTO messages (Message_Id, Sender, Receiver, Content, Timestamp, Status) VALUES (?, ?, ?, ?, ?, ?)";
                const values = [
                  dataObject.Message_Id,
                  dataObject.Sender,
                  dataObject.Receiver,
                  dataObject.Content,
                  dataObject.Timestamp,
                  dataObject.Status,
                ];

                await db.run(query, values);

                // Instantly update the Terminal UI upon receiving message
                if (appendMessage) {
                  appendMessage(
                    dataObject.Sender,
                    dataObject.Content,
                    dataObject.Timestamp,
                  );
                }

                // Tell the client we received it successfully, then close the stream
                stream.exit(0);
              } catch (err) {
                // If it was already inserted locally, ignore duplicate constraint; otherwise display error
                if (err.message && !err.message.includes("UNIQUE constraint failed")) {
                  if (appendMessage) {
                    appendMessage("System", `Incoming message error: ${err.message}`);
                  }
                }
              } finally {
                stream.end();
              }
            });
          });
        });
      });

      client.on("error", (err) => {
        if (appendMessage) {
          appendMessage("System", `SSH Client error: ${err.message}`);
        }
      });
    },
  );

  // Start listening on port 2222 across all local network interfaces
  server.listen(2222, "0.0.0.0");
}

const { Client } = require("ssh2");

//For Becoming the Client
function sendMessage(host, port, privateKey, messageObject) {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    conn.on("ready", () => {
      console.log("Client connected to peer! Opening channel...");

      // Request an 'exec' session to stream data
      conn.exec("send_msg", (err, stream) => {
        if (err) {
          conn.end();
          return reject(err);
        }

        // Convert our JavaScript object into a raw JSON string
        const payload = JSON.stringify(messageObject);

        // Send the payload through the SSH stream
        stream.write(payload);
        stream.end(); // Close stream to notify server we're done sending

        stream.on("close", () => {
          console.log("Message stream closed by server.");
          conn.end(); // Close the connection
          resolve();
        });
      });
    });

    conn.on("error", (err) => reject(err));

    // Connect using your SSH private key
    conn.connect({
      host: host,
      port: port,
      username: "peer", // SSH requires a username field, can be any string
      privateKey: privateKey,
    });
  });
}

function startDiscovery(db, ownPubKey, appendMessage, setStatus) {
  const bonjour = new Bonjour();
  const PORT = 2222;

  const nodeName = `p2p-node-${crypto
    .createHash("md5")
    .update(ownPubKey)
    .digest("hex")
    .substring(0, 8)}`;

  // 1. Continuously broadcast presence on local network
  bonjour.publish({
    name: nodeName,
    type: "p2p-chat",
    port: PORT,
    txt: {
      pubkey: ownPubKey.trim(),
      port: String(PORT),
    },
  });

  if (appendMessage) {
    appendMessage(
      "System",
      "mDNS Discovery active: broadcasting presence on local network.",
    );
  }

  // 2. Listen for broadcasts from other peers
  const browser = bonjour.find({ type: "p2p-chat" });

  const handleDiscoveredService = async (service) => {
    try {
      if (!service.txt || !service.txt.pubkey) return;

      const discoveredPubKey = service.txt.pubkey.trim();

      // Ignore self broadcast
      if (discoveredPubKey === ownPubKey.trim()) return;

      let peerIp = null;
      if (service.addresses && service.addresses.length > 0) {
        peerIp = service.addresses.find((addr) => !addr.includes(":"));
      }
      if (!peerIp && service.referer && service.referer.address) {
        peerIp = service.referer.address;
      }

      if (!peerIp) return;

      const peerPort = service.port || parseInt(service.txt.port, 10) || 2222;

      const peer = await db.get(
        "SELECT * FROM peers WHERE public_key = ?",
        [discoveredPubKey],
      );

      if (peer) {
        // Automatically update peer's current local IP address and port in DB
        await db.run(
          "UPDATE peers SET ip = ?, port = ? WHERE public_key = ?",
          [peerIp, peerPort, discoveredPubKey],
        );

        if (appendMessage) {
          appendMessage(
            "System",
            `Discovered trusted peer "${peer.name || "Unknown"}" at ${peerIp}:${peerPort}`,
          );
        }
      }
    } catch (err) {
      if (appendMessage) {
        appendMessage("System", `mDNS discovery error: ${err.message}`);
      }
    }
  };

  browser.on("up", handleDiscoveredService);
  browser.on("update", handleDiscoveredService);
}

function startOutboxWorker(db, privateKey, existingPubKey, appendMessage) {
  // Background interval: poll SQLite every 15 seconds for pending messages
  setInterval(async () => {
    try {
      const pendingMessages = await db.all(
        "SELECT * FROM messages WHERE Status = 'pending' ORDER BY Timestamp ASC"
      );

      if (!pendingMessages || pendingMessages.length === 0) return;

      const trustedPeers = await db.all(
        "SELECT * FROM peers WHERE public_key != ?",
        [existingPubKey]
      );

      if (!trustedPeers || trustedPeers.length === 0) return;

      for (const msg of pendingMessages) {
        let delivered = false;

        const payload = {
          Message_Id: msg.Message_Id,
          Sender: msg.Sender,
          Receiver: msg.Receiver,
          Content: msg.Content,
          Timestamp: msg.Timestamp,
          Status: "sent",
        };

        for (const peer of trustedPeers) {
          const host = peer.ip || "127.0.0.1";
          const port = peer.port || 2222;

          try {
            await sendMessage(host, port, privateKey, payload);
            delivered = true;
          } catch (err) {
            // Peer still offline or unreachable, ignore error & try next peer/cycle
          }
        }

        if (delivered) {
          await db.run("UPDATE messages SET Status = 'sent' WHERE Message_Id = ?", [
            msg.Message_Id,
          ]);

          if (appendMessage) {
            appendMessage("System", `[Outbox Retry] Message "${msg.Content}" delivered successfully!`);
          }
        }
      }
    } catch (err) {
      console.error("Outbox retry error:", err.message);
    }
  }, 15000);
}

