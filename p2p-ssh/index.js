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

  const ownName = process.env.CHAT_NAME || os.userInfo().username || "Peer";

  // Add yourself as a trusted peer so you can test locally!
  await db.run("INSERT OR IGNORE INTO peers (public_key, name) VALUES (?, ?)", [
    existingPubKey.trim(),
    ownName,
  ]);

  // Add target peer public key
  const targetPubKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICFBBu0SYsnSxt4GwvkMn3ilvHrgphOSqFd9XublOBEK";
  await db.run("INSERT OR IGNORE INTO peers (public_key, name) VALUES (?, ?)", [
    targetPubKey.trim(),
    "Peer",
  ]);

  // Declare appendMessage variable so it can be referenced in callbacks
  let appendMessage;

  // Start the UI and handle outbound user typing
  const uiElements = initUI(async (text) => {
    const localMessage = {
      Message_Id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      Sender: "You",
      Receiver: "Peer",
      Content: text,
      Timestamp: Date.now(),
      Status: "sent",
    };

    const networkPayload = {
      ...localMessage,
      Sender: ownName, // Send actual identity to remote peer
    };

    try {
      // 1. Insert into local SQLite database
      await db.run(
        "INSERT INTO messages (Message_Id, Sender, Receiver, Content, Timestamp, Status) VALUES (?, ?, ?, ?, ?, ?)",
        [
          localMessage.Message_Id,
          localMessage.Sender,
          localMessage.Receiver,
          localMessage.Content,
          localMessage.Timestamp,
          localMessage.Status,
        ],
      );

      // 2. Display in local UI box
      if (appendMessage) {
        appendMessage("You", text, localMessage.Timestamp);
      }

      // 3. Transmit outbound message over SSH connection to known peers (excluding self)
      const trustedPeers = await db.all(
        "SELECT * FROM peers WHERE public_key NOT LIKE ?",
        [`${existingPubKey.trim()}%`],
      );

      let sentToPeer = false;
      if (trustedPeers && trustedPeers.length > 0) {
        for (const peer of trustedPeers) {
          if (!peer.ip) {
            if (appendMessage) {
              appendMessage("System", `Cannot send to ${peer.name || "Peer"}: IP address not discovered yet.`);
            }
            continue;
          }
          const host = peer.ip;
          const port = peer.port || 2222;
          await sendMessage(host, port, existingPrivKey, networkPayload);
          sentToPeer = true;
        }
      }
      if (!sentToPeer && trustedPeers.length === 0) {
        if (appendMessage) {
          appendMessage("System", "No remote peers registered in database.");
        }
      }
    } catch (err) {
      if (appendMessage) {
        appendMessage("System", `Failed to send: ${err.message}`);
      }
    }
  });

  // Extract the appendMessage function so we can use it
  appendMessage = uiElements.appendMessage;

  // Load past chat history from SQLite DB
  try {
    const history = await db.all("SELECT * FROM messages ORDER BY Timestamp ASC");
    for (const msg of history) {
      appendMessage(msg.Sender, msg.Content, msg.Timestamp);
    }
  } catch (err) {
    appendMessage("System", `Failed to load chat history: ${err.message}`);
  }

  appendMessage("System", "P2P SSH Chat Engine online.");

  // Pass appendMessage to the SSH engine so incoming network payloads update the UI
  await startSSHEngine(existingPrivKey, db, appendMessage);

  // Start mDNS peer broadcasting and listening
  startDiscovery(db, existingPubKey, appendMessage);
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
          const incomingKey = `${ctx.key.algo} ${ctx.key.data.toString("base64")}`.trim();

          // 3. Ask SQLite if this key (or prefix) exists in our 'peers' table
          const peer = await db.get(
            "SELECT * FROM peers WHERE public_key LIKE ?",
            [`${incomingKey}%`],
          );

          // 4. Make the decision
          if (peer) {
            if (appendMessage) {
              appendMessage("System", `Authenticated connection from peer "${peer.name || "Unknown"}"`);
            }
            return ctx.accept(); // Let them in!
          } else {
            if (appendMessage) {
              appendMessage("System", `Rejected connection from unknown key: ${incomingKey.substring(0, 30)}...`);
            }
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

function startDiscovery(db, ownPubKey, appendMessage) {
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

      const cleanDiscoveredKey = service.txt.pubkey.trim();
      const cleanOwnKey = ownPubKey.trim();

      // Ignore self broadcast
      if (cleanDiscoveredKey === cleanOwnKey) return;

      let peerIp = null;
      if (service.addresses && service.addresses.length > 0) {
        const ipv4s = service.addresses.filter((addr) => !addr.includes(":"));
        const realIps = ipv4s.filter(
          (addr) => !addr.startsWith("169.254.") && !addr.startsWith("192.168.56.")
        );
        peerIp = realIps.length > 0 ? realIps[0] : ipv4s[0];
      }
      if (!peerIp && service.referer && service.referer.address) {
        peerIp = service.referer.address;
      }

      if (!peerIp) return;

      const peerPort = service.port || parseInt(service.txt.port, 10) || 2222;

      let peer = await db.get(
        "SELECT * FROM peers WHERE public_key LIKE ?",
        [`${cleanDiscoveredKey}%`],
      );

      if (!peer) {
        await db.run(
          "INSERT INTO peers (public_key, name, ip, port) VALUES (?, ?, ?, ?)",
          [cleanDiscoveredKey, "Discovered Peer", peerIp, peerPort],
        );
        peer = { name: "Discovered Peer" };
      } else {
        // Automatically update peer's current local IP address and port in DB
        await db.run(
          "UPDATE peers SET ip = ?, port = ? WHERE public_key LIKE ?",
          [peerIp, peerPort, `${cleanDiscoveredKey}%`],
        );
      }

      if (appendMessage) {
        appendMessage(
          "System",
          `Discovered peer "${peer.name || "Unknown"}" at ${peerIp}:${peerPort}`,
        );
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
