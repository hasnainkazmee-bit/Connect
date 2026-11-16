import { useEffect, useState } from "react";
import { api } from "./api";
import { isMacApp, isWindowsApp } from "./mac-app";
export type DesktopUpdate = {
  platform: "macos" | "windows";
  current: string;
  version: string;
  available: boolean;
  downloads: { arch: string; url: string; sha256: string }[];
};
let cached: DesktopUpdate | null = null,
  checkedAt = 0,
  checking: Promise<DesktopUpdate | null> | null = null;
const event = "connect:desktop-update";
export function desktopVersion(): {
  platform: "macos" | "windows";
  current: string;
} | null {
  const platform = isMacApp() ? "macos" : isWindowsApp() ? "windows" : null;
  const match = navigator.userAgent.match(
    /Connect(?:Mac|Windows)\/(\d+\.\d+(?:\.\d+)?)/,
  );
  return platform && match ? { platform, current: match[1] } : null;
}
function newer(next: string, current: string) {
  const a = next.split(".").map(Number),
    b = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}
export async function checkDesktopUpdate(
  force = false,
): Promise<DesktopUpdate | null> {
  const device = desktopVersion();
  if (!device) return null;
  if (checking) return checking;
  if (!force && cached && Date.now() - checkedAt < 6 * 60 * 60 * 1000)
    return cached;
  checking = (async () => {
    const manifest = await api<Record<string, any>>("/mobile/releases/desktop");
    const release = manifest[device.platform];
    if (
      !release ||
      !/^\d+\.\d+\.\d+$/.test(release.versionName) ||
      !Array.isArray(release.downloads)
    )
      throw new Error(
        "Update information is not available yet. Try again shortly.",
      );
    const downloads = release.downloads.filter(
      (item: any) =>
        item &&
        ["universal", "x64", "arm64"].includes(item.arch) &&
        /^[a-f0-9]{64}$/i.test(item.sha256) &&
        typeof item.url === "string" &&
        /^https:\/\/github\.com\/hasnainkazmee-bit\/Connect\/releases\/download\/v[\d.]+\/[A-Za-z0-9._-]+$/.test(
          item.url,
        ),
    );
    cached = {
      ...device,
      version: release.versionName,
      available:
        downloads.length > 0 && newer(release.versionName, device.current),
      downloads,
    };
    checkedAt = Date.now();
    window.dispatchEvent(new Event(event));
    return cached;
  })();
  try {
    return await checking;
  } finally {
    checking = null;
  }
}
export function useDesktopUpdate() {
  const [value, setValue] = useState(cached);
  useEffect(() => {
    if (!desktopVersion()) return;
    const update = () => setValue(cached);
    const check = () => {
      if (!document.hidden) void checkDesktopUpdate().catch(() => {});
    };
    window.addEventListener(event, update);
    window.addEventListener("focus", check);
    const timer = setInterval(check, 6 * 60 * 60 * 1000);
    check();
    return () => {
      clearInterval(timer);
      window.removeEventListener(event, update);
      window.removeEventListener("focus", check);
    };
  }, []);
  return value;
}
