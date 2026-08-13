# 🎯 P2P Networking & Architecture Interview Masterclass

Welcome! This guide is designed to transform you from feeling unsure about networking to being **100% confident** in technical interviews when explaining this Peer-to-Peer Encrypted SSH Chat application.

Below are **5 Core Technical Modules**, each explaining the real-world engineering concepts we solved, the interview questions you will face, and hands-on tasks to solidify your understanding.

---

## 🛰️ Module 1: Computer Networking Basics (IPs, Ports, & Sockets)

### Concept:
* **IP Address**: Unique address of a device on a network.
  * **Loopback (`127.0.0.1` / `localhost`)**: Refers *only* to the current local machine itself.
  * **Private LAN IP (`192.168.x.x`, `10.x.x.x`)**: Address inside a Wi-Fi / Local Area Network.
  * **Public WAN IP**: External address assigned by an Internet Service Provider (ISP).
* **Port**: A virtual doorway (0–65535) for network services (e.g. HTTP=80, SSH=22, Our P2P SSH=2222, UDP Beacon=22222).

### Real Bug We Solved:
Initially, when a peer's IP wasn't set, the app defaulted to `127.0.0.1`. The PC tried connecting to `127.0.0.1:2222`—which was **itself**! The PC's own SSH server received the connection, rejected the key, and printed `Message stream closed by server`.

### 💡 Interview Questions You Can Answer:
1. **"What is the difference between `127.0.0.1` and a LAN IP like `192.168.1.15`?"**
   * *Answer*: `127.0.0.1` is loopback, routing packets inside the local TCP/IP stack without touching any network adapter. `192.168.1.15` routes packets through the network card across the physical Wi-Fi/Ethernet network to other devices.
2. **"What causes an `EADDRINUSE` error in Node.js?"**
   * *Answer*: Another process is already bound to that IP and Port combination.

### ✍️ Hands-On Task 1:
Write a small Node.js function using `require('os').networkInterfaces()` that loops through all network interfaces and prints **only** the active IPv4 LAN addresses, excluding loopback (`127.0.0.1`).

---

## 📢 Module 2: UDP Broadcasting vs mDNS Auto-Discovery

### Concept:
* **Unicast**: Message sent to 1 specific IP address.
* **Broadcast**: Message sent to ALL devices on the subnet (`255.255.255.255` or `192.168.1.255`).
* **Multicast (mDNS / Bonjour)**: Special multicast group (`224.0.0.251:5353`) used for service discovery.

### Real Bug We Solved:
1. **Buffer `.trim()` Crash**: `bonjour-service` returned TXT record public keys as Node `Buffer` objects (`<Buffer 73 73 68 ...>`). Calling `service.txt.pubkey.trim()` threw `TypeError: trim is not a function`, silently killing discovery!
2. **Subnet Calculation**: Some Wi-Fi routers drop `255.255.255.255` broadcasts. We wrote bitwise math (`ip | (~mask & 255)`) to send to explicit subnet broadcasts like `192.168.1.255`.

### 💡 Interview Questions You Can Answer:
1. **"How does automatic device discovery work without a central server?"**
   * *Answer*: Nodes broadcast lightweight heartbeat beacons containing their public key and port over UDP broadcast (`dgram` on port 22222) and mDNS. Receiving nodes extract the sender's IP from `rinfo.address` and update their local peer table automatically.

### ✍️ Hands-On Task 2:
Explain how to calculate a subnet broadcast IP given:
* IP Address: `192.168.1.50`
* Subnet Mask: `255.255.255.0`
*(Hint: `192.168.1.50` combined with `0.0.0.255` inverted mask equals `192.168.1.255`)*.

---

## 🔑 Module 3: OpenSSH Public Key Cryptography & Identity Verification

### Concept:
OpenSSH `Ed25519` key pairs:
* **Private Key (`id_ed25519`)**: Kept secret on your device. Used to authenticate outbound SSH connections.
* **Public Key (`id_ed25519.pub`)**: Shared with peers. Formatted as `ssh-ed25519 <base64_hash> <optional_comment>`.

### Real Bug We Solved:
1. **Full String Matching Mismatch**: `ssh-ed25519 AAA... user@pc` didn't match `ssh-ed25519 AAA... user@termux`. We created `getRawKeyData()` to isolate the `<base64_hash>` part for 100% reliable cryptographic matching.
2. **Local DB Name Resolution**: The receiver extracts `client.incomingRawKey` on SSH handshake and looks up the exact name assigned in its local SQLite `peers` database.

### 💡 Interview Questions You Can Answer:
1. **"How do you ensure end-to-end identity verification in your P2P app?"**
   * *Answer*: SSH Public Key Authentication. During the SSH handshake (`client.on('authentication')`), the server verifies that the client possesses the matching private key corresponding to a trusted public key in the receiver's SQLite `peers` table.

### ✍️ Hands-On Task 3:
Write a JavaScript function `getRawKeyData(pubKeyStr)` that takes string `"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... user@desktop\n"` and returns strictly `"AAAAC3NzaC1lZDI1NTE5AAAAI..."`.

---

## ⚡ Module 4: Asynchronous Execution, Concurrency & Timeouts

### Concept:
* **Sequential Loop (`for...of` + `await`)**: Processes items one after another. If item 1 takes 20 seconds, item 2 waits 20 seconds.
* **Parallel Execution (`Promise.all`)**: Triggers all asynchronous operations simultaneously.

### Real Bug We Solved:
In `ssh2`, `readyTimeout` defaults to **20,000 ms (20 seconds)**. The old code used a sequential loop. If an offline IP was listed first in the database, sending a message from PC waited 20 seconds before attempting to send to the phone!
We fixed it by using `Promise.all` + setting `readyTimeout: 3000` (3s max).

### 💡 Interview Questions You Can Answer:
1. **"Why did you switch from a `for` loop to `Promise.all` when sending messages to multiple peers?"**
   * *Answer*: A sequential `for` loop blocks each network call sequentially. If one peer is offline, the entire loop halts until the connection times out. `Promise.all` fires network requests to all active peers concurrently in parallel, reducing latency from 20 seconds to milliseconds.

### ✍️ Hands-On Task 4:
Write a mock code snippet demonstrating `Promise.all(peers.map(async (peer) => { ... }))` that sends network requests concurrently and collects results.

---

## 🖥️ Module 5: Terminal Output & Stdout Stream Protection

### Concept:
Full-screen terminal libraries (like `blessed` or `ncurses`) take full control of terminal ANSI escape sequences to draw borders and boxes. Calling standard `console.log()` outputs raw characters directly to `process.stdout`, which corrupts screen buffers.

### Real Bug We Solved:
Raw `console.log("Client connected...")` calls inside `sendMessage()` were outputting text directly to `stdout`, breaking Blessed box boundaries and spilling raw text into the user's chat input field.

### 💡 Interview Questions You Can Answer:
1. **"Why avoid `console.log` in a terminal UI application built with Blessed?"**
   * *Answer*: `console.log` writes directly to `process.stdout`, bypassing Blessed's internal screen renderer. This corrupts ANSI cursor positioning, breaking layout borders and input fields. All text must pass through Blessed UI update methods (`appendMessage` / `screen.render()`).

---

## 🚀 Recommended Next Steps to Master Everything:

1. Read through `p2p-ssh/PROJECT_GUIDE.md` and `p2p-ssh/INTERVIEW_PREP_TASKS.md`.
2. Try completing **Task 1, Task 3, and Task 4** in a small test script (`scratch/test.js`)!
3. Ask me any clarifying question on any module above—I am here to guide you step by step until you feel 100% invincible for your interviews!
