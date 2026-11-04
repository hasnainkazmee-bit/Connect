import { useState } from "react";
import { Sun, Leaf, Building2 } from "lucide-react";
import type { Company } from "./types";
const initials = (s: string) =>
  s
    .split(" ")
    .map((x) => x[0])
    .slice(0, 2)
    .join("");
export function Logo({
  company: c,
  size = "",
}: {
  company: Company;
  size?: string;
}) {
  const [failedUrl, setFailedUrl] = useState("");
  const imageUrl = c.logo_url && c.logo_url !== failedUrl ? c.logo_url : "";
  return (
    <span
      className={
        "company-logo " +
        (c.logo_style === "panel" ? "photo" : c.logo_style) +
        " " +
        size
      }
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(imageUrl)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            background: "white",
            borderRadius: "inherit",
          }}
        />
      ) : c.logo_style === "leaf" ? (
        <Leaf />
      ) : c.logo_style === "building" ? (
        <Building2 />
      ) : c.logo_style === "panel" ? (
        <img src="/assets/solar.jpg" alt="" />
      ) : (
        <span className="helio-mark">
          <Sun />
          <i />
        </span>
      )}
    </span>
  );
}
export function Avatar({ name }: { name: string }) {
  return <span className="avatar">{initials(name)}</span>;
}
