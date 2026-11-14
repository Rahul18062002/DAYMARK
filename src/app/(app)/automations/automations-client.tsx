"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, ChevronRight, Info, RefreshCw, Send } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { EmptyState, InfoNotice } from "@/components/ui/states";
import type { FieldDoc } from "@/server/integrations/viasocket/event-docs";

type Flow = { id: string; title: string; description: string | null; status: string; eventType: string | null; lastSyncedAt: string };
type Delivery = {
  id: string; status: "PENDING" | "DELIVERED" | "FAILED" | "SKIPPED"; attemptCount: number; nextAttemptAt: string; lastHttpStatus: number | null; lastError: string | null;
  createdAt: string; deliveredAt: string | null; eventId: string; eventLabel: string; isTest: boolean; flowTitle: string;
};
type Attempt = { attemptNumber: number; startedAt: string; durationMs: number; outcome: string; httpStatus: number | null; errorCode: string | null; errorMessage: string | null };
type EventDoc = { key: string; label: string; description: string; name: string; fields: FieldDoc[] };

const EMBED_ORIGIN = "https://embedfrontend.viasocket.com";
const EMBED_SCRIPT = "https://embed.viasocket.com/prod-embedcomponent.js";

declare global {
  interface Window {
    viaSocket?: { mount: (o: Record<string, unknown>) => { on: (e: string, fn: (d: unknown) => void) => void; update: (c: Record<string, unknown>) => void; destroy: () => void } };
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`) && window.viaSocket) return resolve();
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("script"));
    document.head.appendChild(s);
  });
}

const statusTone = { active: "success", paused: "warning", unknown: "neutral" } as const;
const deliveryTone = { DELIVERED: "success", PENDING: "warning", FAILED: "danger", SKIPPED: "neutral" } as const;
const deliveryLabel = { DELIVERED: "Accepted by viaSocket", PENDING: "Pending / retrying", FAILED: "Failed", SKIPPED: "Skipped" } as const;
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function AutomationsClient(p: {
  configured: boolean; isAdmin: boolean; settings: { managerAccess: boolean; includeBlockerText: boolean };
  initialFlows: Flow[]; initialDeliveries: Delivery[]; events: EventDoc[];
}) {
  const [flows, setFlows] = useState(p.initialFlows);
  const [deliveries, setDeliveries] = useState(p.initialDeliveries);
  const [settings, setSettings] = useState(p.settings);

  if (!p.configured) {
    return (
      <Card>
        <EmptyState icon={<Info className="h-5 w-5" />} title="Automations aren't set up on this server"
          description={p.isAdmin ? "Daymark works fully without them. To enable Automations, the server needs VIASOCKET_ORG_ID, VIASOCKET_PROJECT_ID and VIASOCKET_EMBED_SECRET (and CRON_SECRET for scheduled checks). See the README." : "Ask your administrator to set up Automations for this workspace."} />
      </Card>
    );
  }
  return <Configured {...p} flows={flows} setFlows={setFlows} deliveries={deliveries} setDeliveries={setDeliveries} settings={settings} setSettings={setSettings} />;
}

function Configured(p: {
  isAdmin: boolean; events: EventDoc[]; flows: Flow[]; setFlows: (f: Flow[]) => void; deliveries: Delivery[]; setDeliveries: (d: Delivery[]) => void;
  settings: { managerAccess: boolean; includeBlockerText: boolean }; setSettings: (s: { managerAccess: boolean; includeBlockerText: boolean }) => void;
}) {
  const [embedState, setEmbedState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped by every local change (e.g. linking a flow). A server response that was requested BEFORE the
  // latest change is stale and must not overwrite what the admin just did.
  const mutation = useRef(0);

  const refresh = useCallback(async () => {
    const seen = mutation.current;
    const r = await api<{ flows: Flow[]; deliveries: Delivery[] }>("/api/automations");
    p.setDeliveries(r.deliveries);
    if (seen === mutation.current) p.setFlows(r.flows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sync = useCallback(async (manual = false): Promise<void> => {
    setSyncing(true);
    const seen = mutation.current;
    try {
      const r = await api<{ flows: Flow[] }>("/api/automations/sync", { method: "POST", body: {} });
      if (seen === mutation.current) {
        p.setFlows(r.flows);
        if (manual) toast.success("Automations refreshed");
      } else {
        // Overtaken by a local change: discard this answer and ask again.
        setTimeout(() => void sync(manual), 300);
      }
    } catch (e) {
      if (manual) toast.error(e instanceof ApiError ? e.message : "Couldn't refresh automations.");
    } finally { setSyncing(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let embed: { destroy: () => void } | undefined;
    let cancelled = false;
    // Attached BEFORE mounting, origin-checked. The message content is never trusted: it only tells
    // the server "something changed", and the server re-reads the flows itself.
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== EMBED_ORIGIN) return;
      const flow = e.data as { id?: string } | null;
      if (!flow?.id) return;
      if (syncTimer.current) clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => void sync(), 700);
    };
    window.addEventListener("message", onMessage);
    (async () => {
      try {
        setEmbedState("loading");
        await loadScript(EMBED_SCRIPT);
        const { token } = await api<{ token: string }>("/api/viasocket/token");
        if (cancelled || !window.viaSocket) return;
        const e = window.viaSocket.mount({
          embedToken: token,
          parent: "#viasocket-embed",
          config: { pageheading: "Automation", pagesubheading: "Connect an app, then build what should happen.", themeJson: { "--primary-color": "#4f46e5" } },
        });
        embed = e;
        e.on("ready", () => !cancelled && setEmbedState("ready"));
        e.on("error", () => !cancelled && setEmbedState("error"));
        setTimeout(() => !cancelled && setEmbedState((s) => (s === "loading" ? "ready" : s)), 6000);
        void sync();
      } catch {
        if (!cancelled) setEmbedState("error");
      }
    })();
    return () => {
      cancelled = true;
      window.removeEventListener("message", onMessage);
      if (syncTimer.current) clearTimeout(syncTimer.current);
      try { embed?.destroy(); } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Build an automation" description="Connect an app, choose a starting point, map the Daymark fields into the message, test it and publish. Then link it to a Daymark event below." />
        <div className="relative">
          <div id="viasocket-embed" data-testid="viasocket-embed" className="h-[640px] w-full" />
          {embedState === "loading" && <div className="absolute inset-0 flex items-center justify-center bg-surface/70 text-sm text-muted" role="status">Loading automation builder…</div>}
          {embedState === "error" && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface p-6">
              <div className="max-w-sm text-center">
                <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-warning" aria-hidden />
                <p className="text-sm font-medium">The automation builder couldn&apos;t load</p>
                <p className="mt-1 text-sm text-muted">viaSocket may be unreachable. Daymark itself is unaffected, and automations you already built keep running.</p>
                <Button className="mt-4" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      <FlowsCard events={p.events} flows={p.flows} setFlows={p.setFlows} syncing={syncing} onSync={() => sync(true)} onTested={refresh} onMutate={() => { mutation.current++; }} />
      {p.isAdmin && <SettingsCard settings={p.settings} setSettings={p.setSettings} />}
      <DeliveriesCard deliveries={p.deliveries} onRefresh={refresh} />
      <EventDocs events={p.events} />
    </div>
  );
}

function FlowsCard(p: { events: EventDoc[]; flows: Flow[]; setFlows: (f: Flow[]) => void; syncing: boolean; onSync: () => void; onTested: () => Promise<void>; onMutate: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function link(flow: Flow, eventType: string) {
    p.onMutate();
    setBusy(flow.id);
    try {
      await api(`/api/automations/flows/${flow.id}`, { method: "PATCH", body: { eventType: eventType || null } });
      p.setFlows(p.flows.map((f) => (f.id === flow.id ? { ...f, eventType: eventType || null } : f)));
      toast.success(eventType ? "Automation linked" : "Automation unlinked");
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "Couldn't save that."); } finally { setBusy(null); }
  }
  async function test(flow: Flow) {
    setBusy(flow.id);
    try {
      const r = await api<{ results: { status: string; httpStatus?: number; errorCode?: string }[] }>(`/api/automations/flows/${flow.id}/test`, { method: "POST", body: {} });
      const res = r.results[0];
      if (res?.status === "DELIVERED") toast.success("Test event accepted by viaSocket. Check the automation's run history there to see what it did next.");
      else toast.error(`Test event not delivered (${res?.errorCode ?? res?.status ?? "unknown"}). It will be retried automatically if that makes sense.`);
      await p.onTested();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "Couldn't send the test event."); } finally { setBusy(null); }
  }

  return (
    <Card>
      <CardHeader title="Your automations" description="Choose which Daymark event starts each one. An automation that isn't linked never receives anything."
        action={<Button size="sm" variant="secondary" loading={p.syncing} onClick={p.onSync}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>} />
      {p.flows.length === 0 ? (
        <EmptyState icon={<Info className="h-5 w-5" />} title="No automations yet" description="Build one above. Once it's published it appears here, and you can link it to a Daymark event." />
      ) : (
        <ul className="divide-y divide-border">
          {p.flows.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4" data-testid="flow-row">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{f.title}</span><Badge tone={statusTone[f.status as keyof typeof statusTone] ?? "neutral"}>{f.status}</Badge></div>
                {f.status !== "active" && <p className="mt-0.5 text-xs text-muted">Paused or unavailable in viaSocket — it won&apos;t receive events until it&apos;s active again.</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select aria-label={`Starts when — ${f.title}`} className="w-auto min-w-56" value={f.eventType ?? ""} disabled={busy === f.id} onChange={(e) => link(f, e.target.value)}>
                  <option value="">Not linked</option>
                  {p.events.map((ev) => <option key={ev.key} value={ev.key}>{ev.label}</option>)}
                </Select>
                <Button size="sm" variant="secondary" loading={busy === f.id} disabled={!f.eventType || f.status !== "active"} onClick={() => test(f)}><Send className="h-3.5 w-3.5" /> Send test event</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SettingsCard(p: { settings: { managerAccess: boolean; includeBlockerText: boolean }; setSettings: (s: { managerAccess: boolean; includeBlockerText: boolean }) => void }) {
  const [saving, setSaving] = useState(false);
  async function save(patch: Partial<{ managerAccess: boolean; includeBlockerText: boolean }>) {
    const previous = p.settings;
    p.setSettings({ ...previous, ...patch }); // optimistic: the checkbox responds at once
    setSaving(true);
    try {
      const r = await api<{ settings: { managerAccess: boolean; includeBlockerText: boolean } }>("/api/automations/settings", { method: "PATCH", body: patch });
      p.setSettings(r.settings); toast.success("Settings saved");
    } catch (e) {
      p.setSettings(previous); // revert if the server refused or was unreachable
      toast.error(e instanceof ApiError ? e.message : "Couldn't save settings.");
    } finally { setSaving(false); }
  }
  return (
    <Card>
      <CardHeader title="Settings" description="Only admins can change these." />
      <CardBody className="space-y-3">
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
          <input type="checkbox" className="mt-1" checked={p.settings.managerAccess} disabled={saving} onChange={(e) => save({ managerAccess: e.target.checked })} />
          <span><span className="text-sm font-medium">Allow managers to manage Automations</span><span className="block text-xs text-muted">Off by default. When on, managers can open this page, build automations and link them. Employees never can.</span></span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
          <input type="checkbox" className="mt-1" checked={p.settings.includeBlockerText} disabled={saving} onChange={(e) => save({ includeBlockerText: e.target.checked })} />
          <span><span className="text-sm font-medium">Include blocker text in “Employee Reports a Blocker”</span><span className="block text-xs text-muted">Off by default: the event then carries who, when and a link only. When on, the first blocker (up to 280 characters) is sent to your connected apps too.</span></span>
        </label>
      </CardBody>
    </Card>
  );
}

function DeliveriesCard(p: { deliveries: Delivery[]; onRefresh: () => Promise<void> }) {
  const [open, setOpen] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<Record<string, Attempt[] | "error">>({});

  async function toggle(id: string) {
    if (open === id) return setOpen(null);
    setOpen(id);
    if (!attempts[id]) {
      try { const r = await api<{ attempts: Attempt[] }>(`/api/automations/deliveries/${id}`); setAttempts((a) => ({ ...a, [id]: r.attempts })); }
      catch { setAttempts((a) => ({ ...a, [id]: "error" })); }
    }
  }
  return (
    <Card>
      <CardHeader title="Delivery history" description="Recent events sent to your automations, with every attempt."
        action={<Button size="sm" variant="ghost" onClick={() => void p.onRefresh()}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>} />
      <InfoNotice className="mx-5 mt-4">“Accepted by viaSocket” means viaSocket received the event. It doesn&apos;t guarantee the app step (for example a Slack message) succeeded — check the automation&apos;s run history in viaSocket. Delivery is <strong className="text-foreground">at-least-once</strong>: after a retry the same event can arrive twice, so use the event&apos;s <code>eventId</code> to ignore duplicates.</InfoNotice>
      {p.deliveries.length === 0 ? (
        <EmptyState title="Nothing sent yet" description="Events appear here once an automation is linked and something happens — or when you press “Send test event”." />
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {p.deliveries.map((d) => (
            <li key={d.id} data-testid="delivery-row">
              <button type="button" onClick={() => void toggle(d.id)} aria-expanded={open === d.id} className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-2 px-5 py-3 text-left hover:bg-surface-muted/50">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  {open === d.id ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />}
                  <span className="font-medium">{d.eventLabel}</span>{d.isTest && <Badge>Test</Badge>}
                  <span className="truncate text-muted">→ {d.flowTitle}</span>
                </span>
                <span className="flex items-center gap-2 text-xs text-muted">
                  <Badge tone={deliveryTone[d.status]}>{deliveryLabel[d.status]}</Badge>
                  <span>{d.attemptCount} attempt{d.attemptCount === 1 ? "" : "s"}</span><time dateTime={d.createdAt}>{when(d.createdAt)}</time>
                </span>
              </button>
              {open === d.id && (
                <div className="space-y-3 bg-surface-muted/40 px-5 py-4 text-xs">
                  <div className="text-muted">Event ID <code className="text-foreground">{d.eventId}</code>{d.status === "PENDING" && d.attemptCount > 0 && <> · next attempt after {when(d.nextAttemptAt)}</>}{d.lastError && <> · {d.lastError}</>}</div>
                  {attempts[d.id] === "error" ? <p className="text-danger">Couldn&apos;t load the attempts.</p> : !attempts[d.id] ? <p className="text-muted">Loading…</p> : (attempts[d.id] as Attempt[]).length === 0 ? <p className="text-muted">No attempts yet.</p> : (
                    <table className="w-full text-left"><thead className="text-muted"><tr><th className="py-1 pr-3 font-medium">#</th><th className="py-1 pr-3 font-medium">When</th><th className="py-1 pr-3 font-medium">Result</th><th className="py-1 pr-3 font-medium">HTTP</th><th className="py-1 font-medium">Took</th></tr></thead>
                      <tbody>{(attempts[d.id] as Attempt[]).map((a) => (
                        <tr key={a.attemptNumber} className="border-t border-border"><td className="py-1.5 pr-3">{a.attemptNumber}</td><td className="py-1.5 pr-3">{when(a.startedAt)}</td>
                          <td className="py-1.5 pr-3">{a.outcome === "SUCCESS" ? "Accepted" : a.errorMessage ?? a.outcome}</td><td className="py-1.5 pr-3">{a.httpStatus ?? "—"}</td><td className="py-1.5">{a.durationMs} ms</td></tr>
                      ))}</tbody></table>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function EventDocs({ events }: { events: EventDoc[] }) {
  return (
    <Card>
      <CardHeader title="What each event sends" description="These are the fields available when you map values in your automation. Nothing the employee wrote and no employee email is sent except where listed." />
      <div className="divide-y divide-border">
        {events.map((ev) => (
          <details key={ev.key} className="group px-5 py-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm"><span className="font-medium">{ev.label} <code className="ml-1 text-xs text-muted">{ev.name}</code></span><ChevronRight className="h-4 w-4 text-muted transition-transform group-open:rotate-90" aria-hidden /></summary>
            <p className="mt-2 text-sm text-muted">{ev.description}</p>
            <table className="mt-3 w-full text-left text-xs"><thead className="text-muted"><tr><th className="py-1 pr-3 font-medium">Field</th><th className="py-1 pr-3 font-medium">From</th><th className="py-1 font-medium">Notes</th></tr></thead>
              <tbody>{ev.fields.map((f) => <tr key={f.path} className="border-t border-border"><td className="py-1.5 pr-3 font-mono">{f.path}{f.optional && <span className="text-muted"> (optional)</span>}</td><td className="py-1.5 pr-3">{f.source}</td><td className="py-1.5 text-muted">{f.note ?? ""}</td></tr>)}</tbody></table>
          </details>
        ))}
      </div>
    </Card>
  );
}

