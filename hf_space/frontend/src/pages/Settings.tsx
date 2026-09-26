import { KeyRound, Lock, ShieldCheck, UserRound } from "lucide-react";
import { Card, PageHeader, Pill } from "@/components/ui";
import { useAuth } from "@/lib/auth";

export default function SettingsPage() {
  const { user } = useAuth();
  return (
    <div className="mx-auto max-w-content px-8 py-8">
      <PageHeader title="Settings" subtitle="Account and privacy defaults for your organisation." />
      <div className="grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">
        <Card>
          <div className="flex items-center gap-2 font-semibold"><UserRound className="h-5 w-5 text-primary" />Account</div>
          <dl className="mt-4 space-y-3 text-[14px]">
            <div className="flex justify-between"><dt className="text-muted">Name</dt><dd>{user?.name}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Email</dt><dd className="font-mono text-[13px]">{user?.email}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Organisation</dt><dd>Single organisation (MVP)</dd></div>
          </dl>
        </Card>
        <Card>
          <div className="flex items-center gap-2 font-semibold"><Lock className="h-5 w-5 text-primary" />Privacy defaults</div>
          <ul className="mt-4 space-y-3 text-[14px]">
            <li className="flex items-center justify-between gap-3">Personal data masked in screens and exports <Pill tone="success">Always on by default</Pill></li>
            <li className="flex items-center justify-between gap-3">Showing personal data is logged <Pill tone="success">On</Pill></li>
            <li className="flex items-center justify-between gap-3">Exports use pseudonymous IDs (HMAC-SHA256) <Pill tone="success">On</Pill></li>
          </ul>
        </Card>
        <Card>
          <div className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-5 w-5 text-primary" />Data integrity</div>
          <p className="mt-4 text-[14px] text-muted">
            Uploaded files are stored read-only with a SHA-256 fingerprint and checked every time a report is built.
            Raw rows cannot be edited or deleted – the database rejects any attempt. Re-uploading a file creates a new version.
          </p>
        </Card>
        <Card>
          <div className="flex items-center gap-2 font-semibold"><KeyRound className="h-5 w-5 text-primary" />Matching rules</div>
          <ul className="mt-4 space-y-1.5 text-[14px] text-muted">
            <li>Phone exactly equal: <span className="font-mono text-ink">+50</span></li>
            <li>Name similarity × 0.4: <span className="font-mono text-ink">up to +40</span></li>
            <li>Same village: <span className="font-mono text-ink">+10</span></li>
            <li>Different phones: <span className="font-mono text-ink">−30</span></li>
            <li>Exact name, phone missing: <span className="font-mono text-ink">+35</span> (capped at 89 → always reviewed)</li>
            <li>90+ suggested merge · 70–89 human review · below 70 separate</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
