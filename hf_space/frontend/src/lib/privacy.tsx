import { createContext, useContext, useState, type ReactNode } from "react";
import { api } from "@/api/client";

/** "Show personal data" switch. Off by default; switching it on is written to the audit log. */
interface PrivacyState {
  reveal: boolean;
  setReveal: (on: boolean, projectId?: number) => Promise<void>;
}

const PrivacyContext = createContext<PrivacyState | null>(null);

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [reveal, setRevealState] = useState(false);
  const setReveal = async (on: boolean, projectId?: number) => {
    if (on && projectId) await api.unmask(projectId, "Show personal data switched on");
    setRevealState(on);
  };
  return <PrivacyContext.Provider value={{ reveal, setReveal }}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy() {
  const ctx = useContext(PrivacyContext);
  if (!ctx) throw new Error("usePrivacy outside PrivacyProvider");
  return ctx;
}
