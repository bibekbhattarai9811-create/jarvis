// Login: owner vs guest, brute-force lockout per address, signed cookies.
import fs from "fs";
import os from "os";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-auth-"));
process.env.JARVIS_DATA = dir;
process.env.JARVIS_PIN = "424242";
let auth: typeof import("@/lib/auth");
beforeAll(async () => {
  auth = await import("@/lib/auth");
});

const req = (headers: Record<string, string> = {}, ip = "10.0.0.1") => new Request("https://localhost/api/ask", { headers: { "x-jarvis-ip": ip, ...headers } });

describe("login", () => {
  it("knows the owner and refuses everyone else", () => {
    expect(auth.roleOf(req({ "x-jarvis-pin": "424242" }))).toBe("owner");
    expect(auth.roleOf(req())).toBeNull();
    expect(auth.roleOf(req({ "x-jarvis-pin": "000000" }, "10.0.0.9"))).toBeNull();
  });

  it("locks an address out after 5 wrong guesses, even for the right passcode", () => {
    const ip = "10.0.0.2";
    for (let n = 0; n < 5; n++) auth.roleOf(req({ "x-jarvis-pin": "111111" }, ip));
    expect(auth.roleOf(req({ "x-jarvis-pin": "424242" }, ip))).toBeNull();
    expect(auth.denied(req({}, ip)).status).toBe(429);
    // other addresses are unaffected
    expect(auth.roleOf(req({ "x-jarvis-pin": "424242" }, "10.0.0.3"))).toBe("owner");
  });

  it("keeps a logged-in owner (signed cookie) working during a lockout", () => {
    const res = auth.json(req({ "x-jarvis-pin": "424242" }), { ok: true });
    const cookie = res.headers.get("set-cookie")!.split(";")[0];
    expect(cookie).toMatch(/^jarvis_auth=owner\.[0-9a-f]{64}$/);
    expect(auth.roleOf(req({ cookie }, "10.0.0.2"))).toBe("owner");
    expect(auth.roleOf(req({ cookie: "jarvis_auth=owner.forged" }, "10.0.0.4"))).toBeNull();
  });

  it("has guest access off until the owner turns it on, and a new code kicks guests out", () => {
    const g = auth.getGuest();
    expect(g.enabled).toBe(false);
    expect(g.code).toMatch(/^[a-z2-9]{8}$/);
    expect(auth.roleOf(req({ "x-jarvis-pin": g.code }, "10.0.0.5"))).toBeNull();
    auth.updateGuest({ enabled: true });
    expect(auth.roleOf(req({ "x-jarvis-pin": g.code }, "10.0.0.6"))).toBe("guest");
    const g2 = auth.updateGuest({ newCode: true });
    expect(auth.roleOf(req({ "x-jarvis-pin": g.code }, "10.0.0.7"))).toBeNull();
    expect(auth.roleOf(req({ "x-jarvis-pin": g2.code }, "10.0.0.8"))).toBe("guest");
  });

  it("only accepts real JPEG uploads", () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200)]);
    expect(auth.jpegFromDataUrl(`data:image/jpeg;base64,${jpeg.toString("base64")}`)).not.toBeNull();
    const html = Buffer.from("<!DOCTYPE html><html>not an image</html>".repeat(5));
    expect(auth.jpegFromDataUrl(`data:image/jpeg;base64,${html.toString("base64")}`)).toBeNull();
  });
});
