// Production HTTPS server for Jarvis (what runs in the background). Unlike `next dev`, it serves only the
// built app: no source code, no dev tools, no hot-reload socket exposed to the network.
// It also stamps each request with the caller's real address (x-jarvis-ip) for passcode rate limiting,
// replacing anything a client tried to send in that header.
import fs from "fs";
import https from "https";
import next from "next";

const port = 3900;
const app = next({ dev: false, hostname: "0.0.0.0", port });
const handle = app.getRequestHandler();
await app.prepare();

https
  .createServer({ key: fs.readFileSync("certificates/key.pem"), cert: fs.readFileSync("certificates/cert.pem") }, (req, res) => {
    for (const h of ["x-jarvis-ip", "x-jarvis-https", "x-forwarded-for", "x-real-ip"]) delete req.headers[h];
    req.headers["x-jarvis-ip"] = (req.socket.remoteAddress || "unknown").replace(/^::ffff:/, "");
    req.headers["x-jarvis-https"] = "1";
    handle(req, res);
  })
  .listen(port, "0.0.0.0", () => console.log(`  Jarvis (production) listening on https://localhost:${port}`));
