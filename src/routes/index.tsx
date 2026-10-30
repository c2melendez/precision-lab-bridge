import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { createKey, listAdmin, revokeKey } from "@/lib/bridge/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Precision Lab Bridge — Admin" },
      { name: "description", content: "Manage bridge keys that trigger the certification runner on GitHub Actions." },
      { property: "og:title", content: "Precision Lab Bridge" },
      { property: "og:description", content: "Trigger and read certification-runner runs for precision-lab-lite and plus." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Admin,
});

type Data = Awaited<ReturnType<typeof listAdmin>>;

function Admin() {
  const list = useServerFn(listAdmin);
  const create = useServerFn(createKey);
  const revoke = useServerFn(revokeKey);
  const [password, setPassword] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [label, setLabel] = useState("llm");
  const [days, setDays] = useState(30);
  const [scopePreset, setScopePreset] = useState<"read" | "read,dispatch">("read");
  const [fresh, setFresh] = useState("");

  const load = async () => {
    setErr("");
    try {
      setData(await list({ data: { password } }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  if (!data)
    return (
      <main className="mx-auto max-w-md p-8 font-mono">
        <h1 className="mb-4 text-xl font-bold">Precision Lab Bridge</h1>
        <form onSubmit={(e) => { e.preventDefault(); load(); }} className="space-y-3">
          <Input type="password" placeholder="Admin password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button type="submit">Enter</Button>
          {err && <p className="text-sm text-destructive">{err}</p>}
        </form>
      </main>
    );

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8 font-mono text-sm">
      <h1 className="text-xl font-bold">Precision Lab Bridge</h1>

      <section className="space-y-3">
        <h2 className="font-semibold">New key</h2>
        <div className="flex gap-2">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" />
          <Input type="number" className="w-28" value={days} onChange={(e) => setDays(Number(e.target.value))} />
          <span className="self-center text-muted-foreground">days</span>
          <select
            aria-label="Key permissions"
            className="rounded border border-border bg-background px-2"
            value={scopePreset}
            onChange={(e) => setScopePreset(e.target.value as "read" | "read,dispatch")}
          >
            <option value="read">Read only</option>
            <option value="read,dispatch">Read + dispatch</option>
          </select>
          <Button
            onClick={async () => {
              const scopes = scopePreset === "read" ? ["read"] : ["read", "dispatch"];
              const r = await create({ data: { password, label, days, scopes } });
              setFresh(r.key);
              load();
            }}
          >
            Create
          </Button>
        </div>
        {fresh && (
          <div className="rounded border border-border bg-muted p-3">
            <p className="mb-1 text-muted-foreground">Shown only once — copy it now:</p>
            <code className="break-all">{fresh}</code>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Keys</h2>
        <table className="w-full text-left">
          <thead className="text-muted-foreground"><tr><th>Label</th><th>Prefix</th><th>Scopes</th><th>Expires</th><th>Last used</th><th></th></tr></thead>
          <tbody>
            {data.keys.map((k) => (
              <tr key={k.id} className="border-t border-border">
                <td>{k.label}</td>
                <td>{k.key_prefix}…</td>
                <td>{Array.isArray(k.scopes) ? k.scopes.join(", ") : "read (legacy default)"}</td>
                <td>{new Date(k.expires_at).toLocaleDateString()}</td>
                <td>{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "—"}</td>
                <td>
                  {k.revoked_at ? <span className="text-muted-foreground">revoked</span> : (
                    <Button size="sm" variant="outline" onClick={async () => { await revoke({ data: { password, id: k.id } }); load(); }}>Revoke</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Recent calls</h2>
        <table className="w-full text-left">
          <thead className="text-muted-foreground"><tr><th>When</th><th>Endpoint</th><th>Key</th><th>Status</th><th>Params / result</th></tr></thead>
          <tbody>
            {data.calls.map((c) => (
              <tr key={c.id} className="border-t border-border align-top">
                <td className="whitespace-nowrap">{new Date(c.created_at).toLocaleString()}</td>
                <td>{c.endpoint}</td>
                <td>{c.key_prefix ?? "—"}</td>
                <td>{c.http_status}</td>
                <td className="break-all text-xs">{JSON.stringify(c.params)} → {JSON.stringify(c.result)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}