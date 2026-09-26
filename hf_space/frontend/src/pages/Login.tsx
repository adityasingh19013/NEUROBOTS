import { useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import { Logo } from "@/components/Layout";
import { Banner, Button } from "@/components/ui";
import { useAuth } from "@/lib/auth";

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signin") await login(email, password);
      else await register(name, email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full grid-cols-2 max-[900px]:grid-cols-1">
      <div className="flex flex-col bg-white px-12 py-10 max-[500px]:px-6">
        <Logo />
        <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center py-12">
          <h1 className="page-title">{mode === "signin" ? "Sign in" : "Create account"}</h1>
          <p className="mt-2 text-muted">
            {mode === "signin" ? "Welcome back. Sign in to continue your reports." : "Set up access for your organisation."}
          </p>
          <form onSubmit={submit} className="mt-8 space-y-4">
            {mode === "register" && (
              <label className="block">
                <span className="label">Name</span>
                <input className="input mt-1.5" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
              </label>
            )}
            <label className="block">
              <span className="label">Email</span>
              <input className="input mt-1.5" type="email" autoComplete="email" value={email}
                onChange={(e) => setEmail(e.target.value)} required autoFocus={mode === "signin"} />
            </label>
            <label className="block">
              <span className="label">Password</span>
              <input className="input mt-1.5" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === "register" ? 6 : 1} />
            </label>
            {mode === "signin" && (
              <div className="text-right">
                <button type="button" className="text-[13px] text-primary hover:underline"
                  onClick={() => setError("Ask your ImpactTrace administrator to reset your password.")}>
                  Forgot password?
                </button>
              </div>
            )}
            {error && <Banner tone="error">{error}</Banner>}
            <Button type="submit" className="w-full" loading={busy}>
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>
          <div className="mt-6 text-center text-[13px] text-muted">
            {mode === "signin" ? (
              <>No account? <button className="text-primary hover:underline" onClick={() => setMode("register")}>Create one</button></>
            ) : (
              <>Already have an account? <button className="text-primary hover:underline" onClick={() => setMode("signin")}>Sign in</button></>
            )}
          </div>
          {mode === "signin" && (
            <div className="mt-8 rounded-ctl border border-dashed border-line p-4 text-[13px] text-muted">
              Demo account: <span className="font-mono text-ink">demo@impacttrace.org</span> /{" "}
              <span className="font-mono text-ink">impact123</span>
              <button
                type="button"
                className="ml-2 text-primary hover:underline"
                onClick={() => { setEmail("demo@impacttrace.org"); setPassword("impact123"); }}
              >
                Fill in
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-col justify-center bg-primary px-16 py-12 text-white max-[900px]:hidden">
        <p className="max-w-md text-[32px] font-semibold leading-tight">Every number, traceable to its source.</p>
        <ul className="mt-10 space-y-4 text-[16px] text-white/90">
          {["Combine Excel and CSV files", "Catch duplicates and missing data", "Original records are never changed"].map((t) => (
            <li key={t} className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-primary-light" />
              {t}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
