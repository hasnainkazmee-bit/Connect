import { createContext, useContext, type ReactNode } from "react";
import type { Company, Session, Network } from "./types";
export type Context = {
  session: Session;
  company?: Company;
  network: Network;
  revision: number;
  setJobSection: (section: "jobs" | "mine" | null) => void;
  refresh: () => void;
  setSession: (s: Session) => void;
  open: (c: ReactNode) => void;
  close: () => void;
  toast: (s: string) => void;
  admin: boolean;
  signIn: () => void;
  createCompany: () => void;
};
export const AppContext = createContext<Context>(null!);
export const useApp = () => useContext(AppContext);
