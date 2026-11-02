// HTTPS for Jarvis (phones only allow the microphone over https).
// Makes a small private certificate authority ("Jarvis Local CA") once, then a server certificate signed by it
// for localhost + this PC's network addresses (re-made when the IP changes).
// Trust the CA once per device (Desktop\Trust Jarvis certificate.bat on the PC; public/jarvis-ca.crt on a phone)
// and the "Not private" warning goes away. The CA is name-constrained: it can only vouch for "localhost" and
// IP addresses, never for real websites, so trusting it can't be abused to impersonate other sites.
import fs from "fs";
import os from "os";
import forge from "node-forge";

const { pki, asn1, md } = forge;
const dir = "certificates";
const ips = Object.values(os.networkInterfaces())
  .flat()
  .filter((n) => n && n.family === "IPv4" && !n.internal)
  .map((n) => n.address);
const want = `ca-v1:${["127.0.0.1", ...ips].join(",")}`;
const stamp = `${dir}/ips.txt`;
fs.mkdirSync(dir, { recursive: true });

const serial = () => "01" + forge.util.bytesToHex(forge.random.getBytesSync(15));

// Name constraints (RFC 5280): permitted = dNSName "localhost" and every IPv4 address.
function nameConstraints() {
  const subtree = (tag, bytes) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [asn1.create(asn1.Class.CONTEXT_SPECIFIC, tag, false, bytes)]);
  const permitted = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [subtree(2, "localhost"), subtree(7, "\0".repeat(8))]);
  return { id: "2.5.29.30", critical: true, value: asn1.toDer(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [permitted])).getBytes() };
}

let caCert;
let caKey;
if (fs.existsSync(`${dir}/ca.pem`) && fs.existsSync(`${dir}/ca-key.pem`)) {
  caCert = pki.certificateFromPem(fs.readFileSync(`${dir}/ca.pem`, "utf8"));
  caKey = pki.privateKeyFromPem(fs.readFileSync(`${dir}/ca-key.pem`, "utf8"));
} else {
  const keys = pki.rsa.generateKeyPair(2048);
  caKey = keys.privateKey;
  caCert = pki.createCertificate();
  caCert.publicKey = keys.publicKey;
  caCert.serialNumber = serial();
  caCert.validity.notBefore = new Date(Date.now() - 86400e3);
  caCert.validity.notAfter = new Date(Date.now() + 10 * 365 * 86400e3);
  const attrs = [{ name: "commonName", value: "Jarvis Local CA" }, { name: "organizationName", value: "Jarvis (this PC only)" }];
  caCert.setSubject(attrs);
  caCert.setIssuer(attrs);
  caCert.setExtensions([
    { name: "basicConstraints", cA: true, pathLenConstraint: 0, critical: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
    { name: "subjectKeyIdentifier" },
    nameConstraints(),
  ]);
  caCert.sign(caKey, md.sha256.create());
  fs.writeFileSync(`${dir}/ca.pem`, pki.certificateToPem(caCert));
  fs.writeFileSync(`${dir}/ca-key.pem`, pki.privateKeyToPem(caKey));
}
// Phones download the CA from https://<ip>:3900/jarvis-ca.crt (public certificate only, never the key).
fs.writeFileSync("public/jarvis-ca.crt", pki.certificateToPem(caCert));

if (!fs.existsSync(`${dir}/key.pem`) || !fs.existsSync(stamp) || fs.readFileSync(stamp, "utf8") !== want) {
  const keys = pki.rsa.generateKeyPair(2048);
  const cert = pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(Date.now() - 86400e3);
  cert.validity.notAfter = new Date(Date.now() + 397 * 86400e3);
  cert.setSubject([{ name: "commonName", value: "localhost" }]);
  cert.setIssuer(caCert.subject.attributes);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
    { name: "extKeyUsage", serverAuth: true },
    { name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }, ...["127.0.0.1", ...ips].map((ip) => ({ type: 7, ip }))] },
    { name: "authorityKeyIdentifier", keyIdentifier: caCert.generateSubjectKeyIdentifier().getBytes() },
  ]);
  cert.sign(caKey, md.sha256.create());
  fs.writeFileSync(`${dir}/key.pem`, pki.privateKeyToPem(keys.privateKey));
  fs.writeFileSync(`${dir}/cert.pem`, pki.certificateToPem(cert) + pki.certificateToPem(caCert));
  fs.writeFileSync(stamp, want);
}

console.log("\n  JARVIS is starting. Open on this PC:  https://localhost:3900");
for (const ip of ips) console.log(`  On your phone (same Wi-Fi):          https://${ip}:3900`);
console.log("  No security warning once you trust the Jarvis certificate (Desktop\\Trust Jarvis certificate.bat).\n");
