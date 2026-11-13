import type { PoolClient } from "pg";
import { pool } from "./db.js";

// One database listener serves all browser streams. Polling in the SSE route
// remains the recovery path if a notification is missed during reconnect.
const subscribers = new Map<string, Set<() => void>>();
let client: PoolClient | null = null;
let connecting = false;
let retry: ReturnType<typeof setTimeout> | null = null;
let generation = 0;

function reconnect() {
  if (!subscribers.size || retry) return;
  retry = setTimeout(() => {
    retry = null;
    void listen();
  }, 1000);
  retry.unref();
}

async function listen() {
  if (client || connecting || !subscribers.size) return;
  connecting = true;
  const current = generation;
  let acquired: PoolClient | null = null;
  let released = false;
  const release = () => {
    if (!acquired || released) return;
    released = true;
    if (client === acquired) client = null;
    acquired.release(true);
  };
  try {
    acquired = await pool.connect();
    acquired.on("error", () => {
      release();
      reconnect();
    });
    acquired.on("notification", (event) => {
      if (event.channel !== "connect_notifications_changed" || !event.payload)
        return;
      for (const wake of subscribers.get(event.payload) || []) wake();
    });
    await acquired.query("LISTEN connect_notifications_changed");
    if (current !== generation || !subscribers.size || released) release();
    else client = acquired;
  } catch {
    release();
    reconnect();
  } finally {
    connecting = false;
    if (!client && subscribers.size) reconnect();
  }
}

export function subscribeNotificationChanges(userId: string, wake: () => void) {
  const callbacks = subscribers.get(userId) || new Set<() => void>();
  callbacks.add(wake);
  subscribers.set(userId, callbacks);
  void listen();
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    callbacks.delete(wake);
    if (!callbacks.size) subscribers.delete(userId);
    if (subscribers.size) return;
    generation++;
    if (retry) clearTimeout(retry);
    retry = null;
    if (client) {
      const old = client;
      client = null;
      old.removeAllListeners("notification");
      old.removeAllListeners("error");
      old.release(true);
    }
  };
}
