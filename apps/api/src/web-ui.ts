import express, { type Request, type RequestHandler } from "express";
import path from "node:path";
import { root } from "./db.js";

export type WebUI = "connect" | "colabb";
const cookieName = "connect_web_ui";
export function selectedWebUI(req: Pick<Request, "headers">): WebUI {
  // Installed clients retain their existing bridge and layout until a native release.
  if (/ConnectMac\/|ConnectWindows\/|ConnectAndroid\//.test(req.headers["user-agent"] || "")) return "connect";
  const selected = (req.headers.cookie || "").split(";").map(v => v.trim()).find(v => v.startsWith(cookieName + "="))?.slice(cookieName.length + 1);
  if (selected === "connect" || selected === "colabb") return selected;
  return process.env.CONNECT_WEB_UI === "colabb" ? "colabb" : "connect";
}
export const webDist = (ui: WebUI) => path.join(root, ui === "colabb" ? "apps/colabb/dist" : "apps/web/dist");

// Company posts belong to the retained Connect interface. Keep this boundary
// on the social routers only: job activity and proof have separate APIs.
export const connectCompanyUpdatesOnly: RequestHandler = (req, res, next) => {
  if (selectedWebUI(req) === "connect") return next();
  res.status(404).json({ error: "Company updates are not available in Colabb." });
};

export function webUIRoutes() {
  const router = express.Router();
  router.get("/_interface/:ui", (req, res) => {
    if (req.params.ui !== "connect" && req.params.ui !== "colabb") return res.sendStatus(404);
    res.cookie(cookieName, req.params.ui, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 365 * 86400000 });
    res.set("Cache-Control", "no-store").redirect(303, "/");
  });
  router.get("/push-sw.js", (req, res, next) => {
    res.vary("Cookie");
    res.vary("User-Agent");
    res.set({"Cache-Control":"no-store, max-age=0", "CDN-Cache-Control":"no-store", "Cloudflare-CDN-Cache-Control":"no-store", "Service-Worker-Allowed":"/"});
    res.sendFile(path.join(webDist(selectedWebUI(req)), "push-sw.js"), {cacheControl:false,lastModified:false}, error => { if(error) next(error); });
  });
  const staticUI = {connect:express.static(webDist("connect"), {index:false}), colabb:express.static(webDist("colabb"), {index:false})};
  router.use("/brand", express.static(path.join(webDist("colabb"), "brand"), {index:false}));
  router.use((req,res,next) => {
    res.vary("Cookie");
    res.vary("User-Agent");
    const ui=selectedWebUI(req);
    staticUI[ui](req,res,() => {
      // Old open tabs can finish loading their immutable, hashed chunks after a switch.
      if (/^\/assets\/[\w.-]+-[\w-]{8,}\.(?:js|css)$/.test(req.path)) return staticUI[ui === "colabb" ? "connect" : "colabb"](req,res,next);
      next();
    });
  });
  return router;
}
