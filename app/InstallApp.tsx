"use client";

// Registers the service worker (needed to install Jarvis on a phone's home screen).
// Browsers refuse it while the certificate isn't trusted; that's harmless, the site still works.

import { useEffect } from "react";

export default function InstallApp() {
  useEffect(() => {
    navigator.serviceWorker?.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
