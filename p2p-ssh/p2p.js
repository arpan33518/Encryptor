const crypto = require("crypto");

let libp2pNode = null;

async function startLibp2pEngine(ownPubKey, appendMessage, onPeerDiscovered) {
  try {
    // Dynamic ESM imports for libp2p packages in CommonJS environment
    const { createLibp2p } = await import("libp2p");
    const { tcp } = await import("@libp2p/tcp");
    const { noise } = await import("@libp2p/noise");
    const { yamux } = await import("@libp2p/yamux");
    const { kadDHT } = await import("@libp2p/kad-dht");
    const { bootstrap } = await import("@libp2p/bootstrap");

    // Public IPFS/libp2p bootstrap multiaddresses for global internet discovery
    const bootstrapList = [
      "/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTmo7JhqiM1VJb1VT4C3NFSC5GQnGQnGJ37",
      "/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcwbSmroamTxUdJB5X2aEAcB56nvEVsmouM6RYrE",
      "/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ"
    ];

    const node = await createLibp2p({
      addresses: {
        listen: ["/ip4/0.0.0.0/tcp/0"] // Binds to any available ephemeral TCP port for P2P routing
      },
      transports: [tcp()],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      peerDiscovery: [
        bootstrap({
          list: bootstrapList
        })
      ],
      services: {
        dht: kadDHT({
          clientMode: false
        })
      }
    });

    await node.start();
    libp2pNode = node;

    const peerIdStr = node.peerId.toString();

    if (appendMessage) {
      appendMessage(
        "System",
        `libp2p Engine online! PeerID: ${peerIdStr.substring(0, 15)}... | KadDHT active.`
      );
    }

    // Listen for peer discovery on global DHT / bootstrap network
    node.addEventListener("peer:discovery", async (evt) => {
      const discoveredPeer = evt.detail;
      const discoveredPeerId = discoveredPeer.id.toString();

      if (discoveredPeer.multiaddrs && discoveredPeer.multiaddrs.length > 0) {
        for (const ma of discoveredPeer.multiaddrs) {
          const maStr = ma.toString();
          // Extract IPv4 and TCP port from multiaddr string e.g. /ip4/192.168.1.50/tcp/2222/...
          const ipMatch = maStr.match(/\/ip4\/([^\/]+)/);
          const portMatch = maStr.match(/\/tcp\/(\d+)/);

          if (ipMatch && portMatch) {
            const ip = ipMatch[1];
            const port = parseInt(portMatch[1], 10);

            if (onPeerDiscovered) {
              onPeerDiscovered(discoveredPeerId, ip, port);
            }
          }
        }
      }
    });

    node.addEventListener("peer:connect", (evt) => {
      const connPeerId = evt.detail.toString();
      if (appendMessage) {
        appendMessage("System", `Connected to P2P peer: ${connPeerId.substring(0, 15)}...`);
      }
    });

    return node;
  } catch (err) {
    if (appendMessage) {
      appendMessage("System", `libp2p Engine info: ${err.message}`);
    }
    return null;
  }
}

function getLibp2pNode() {
  return libp2pNode;
}

module.exports = {
  startLibp2pEngine,
  getLibp2pNode
};
