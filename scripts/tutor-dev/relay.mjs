// In-container TCP relay: 0.0.0.0:<relayPort> -> 127.0.0.1:<serverPort>.
// The bb Feature keeps BB loopback-only; Docker's published port reaches the
// container's bridge IP, so this relay is the only bridge between the two.
// Raw TCP, so HTTP, WebSocket and terminal upgrades pass through unchanged
// (the Host/Origin headers stay http://127.0.0.1:<serverPort>).
import net from "node:net";

const [relayPort, serverPort] = process.argv.slice(2).map(Number);
if (!relayPort || !serverPort) {
  console.error("usage: node relay.mjs <relayPort> <serverPort>");
  process.exit(2);
}

const server = net.createServer((client) => {
  const upstream = net.connect({ host: "127.0.0.1", port: serverPort });
  client.pipe(upstream).pipe(client);
  const close = () => { client.destroy(); upstream.destroy(); };
  client.on("error", close);
  upstream.on("error", close);
  client.on("close", close);
  upstream.on("close", close);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`relay: port ${relayPort} already bound (relay already running?); exiting`);
    process.exit(0);
  }
  console.error("relay:", err);
  process.exit(1);
});

server.listen(relayPort, "0.0.0.0", () => {
  console.error(`relay: 0.0.0.0:${relayPort} -> 127.0.0.1:${serverPort} (pid ${process.pid})`);
});
