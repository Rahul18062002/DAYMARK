"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { ErrorNotice, InfoNotice } from "@/components/ui/states";
import { ListField } from "./list-field";
import { formatDay } from "@/lib/dates";

type Sections = { workedOn: string[]; completed: string[]; pending: string[]; blockers: string[]; nextPriorities: string[] };
type LinkRow = { url: string; label: string };

export type FormProps = {
  mode: "create" | "edit";
  id?: string;
  status?: "DRAFT" | "SUBMITTED" | "EDITED";
  updateDate: string;
  minDate: string;
  maxDate: string;
  initial: Sections;
  initialLinks: LinkRow[];
  editableUntilLabel?: string | null;
};

const clean = (v: string[]) => v.map((s) => s.trim()).filter(Boolean);

export function UpdateForm(p: FormProps) {
  const router = useRouter();
  const [date, setDate] = useState(p.updateDate);
  const [s, setS] = useState<Sections>(p.initial);
  const [links, setLinks] = useState<LinkRow[]>(p.initialLinks);
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);

  const isLive = p.status === "SUBMITTED" || p.status === "EDITED";
  const set = (k: keyof Sections) => (v: string[]) => setS((prev) => ({ ...prev, [k]: v }));

  function payload(submit: boolean) {
    return {
      sections: { workedOn: clean(s.workedOn), completed: clean(s.completed), pending: clean(s.pending), blockers: clean(s.blockers), nextPriorities: clean(s.nextPriorities) },
      links: links.map((l) => ({ url: l.url.trim(), label: l.label.trim() || undefined })).filter((l) => l.url),
      submit,
    };
  }

  async function save(submit: boolean) {
    setError(null);
    setExistingId(null);
    if (submit && clean(s.workedOn).length === 0) {
      setError("Tell us what you worked on today before submitting.");
      document.getElementById("workedOn-0")?.focus();
      return;
    }
    setBusy(submit ? "submit" : "draft");
    try {
      if (p.mode === "create") {
        const r = await api<{ id: string; status: string }>("/api/updates", { body: { ...payload(submit), updateDate: date } });
        if (submit) { router.push(`/my-updates/${r.id}?submitted=1`); }
        else { toast.success("Draft saved"); router.push(`/my-updates/${r.id}/edit`); }
      } else {
        const r = await api<{ status: string; changed: boolean }>(`/api/updates/${p.id}`, { method: "PATCH", body: isLive ? { sections: payload(true).sections, links: payload(true).links } : payload(submit) });
        if (submit && !isLive) router.push(`/my-updates/${p.id}?submitted=1`);
        else if (isLive) { if (r.changed) router.push(`/my-updates/${p.id}?edited=1`); else { toast.message("No changes to save"); setBusy(null); } }
        else { toast.success("Draft saved"); setBusy(null); }
      }
      router.refresh();
    } catch (e) {
      setBusy(null);
      if (e instanceof ApiError) {
        if (e.code === "UPDATE_EXISTS") setExistingId((e.fields as unknown as { id?: string }).id ?? null);
        setError(e.message);
      } else setError("Something went wrong. Please try again.");
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); save(true); }} noValidate className="space-y-6">
      {error && (
        <ErrorNotice>
          {error}{" "}
          {existingId && <Link className="font-medium underline" href={`/my-updates/${existingId}`}>Open that update</Link>}
        </ErrorNotice>
      )}
      {isLive && p.editableUntilLabel && <InfoNotice>You can edit this update until <strong className="text-foreground">{p.editableUntilLabel}</strong>. Earlier versions are kept in its history.</InfoNotice>}

      <Card>
        <CardBody className="space-y-6">
          {p.mode === "create" ? (
            <Field label="Date" htmlFor="updateDate" hint="Today by default. You can add an update for a recent day you missed.">
              <Input id="updateDate" type="date" value={date} min={p.minDate} max={p.maxDate} onChange={(e) => setDate(e.target.value)} className="max-w-48" required />
            </Field>
          ) : (
            <div><div className="text-sm font-medium">Date</div><div className="text-sm text-muted">{formatDay(p.updateDate)}</div></div>
          )}

          <ListField id="workedOn" label="What did you work on today?" required values={s.workedOn} onChange={set("workedOn")}
            hint="Write it your own way — a short paragraph or several items both work."
            placeholder="e.g. Screened 8 candidates, shortlisted 3 and scheduled interviews with 2." />
          <ListField id="completed" label="What work did you complete?" values={s.completed} onChange={set("completed")} />
          <ListField id="pending" label="What work is still pending?" values={s.pending} onChange={set("pending")} />
          <ListField id="blockers" label="What challenges or blockers did you face?" values={s.blockers} onChange={set("blockers")} hint="Leave empty if there were none." />
          <ListField id="nextPriorities" label="What are your priorities for tomorrow?" values={s.nextPriorities} onChange={set("nextPriorities")} />

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Supporting links <span className="font-normal text-muted">(optional)</span></legend>
            <p className="text-xs text-muted">Add links to documents, tickets or pages that support your update. Links only for now.</p>
            {links.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[2fr_1fr_auto]">
                <Input aria-label={`Link ${i + 1} URL`} type="url" inputMode="url" placeholder="https://…" value={l.url} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} className="col-span-1" />
                <Input aria-label={`Link ${i + 1} label`} placeholder="Label (optional)" maxLength={100} value={l.label} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="order-3 col-span-2 sm:order-none sm:col-span-1" />
                <Button type="button" size="icon" variant="ghost" aria-label={`Remove link ${i + 1}`} onClick={() => setLinks(links.filter((_, j) => j !== i))}><X className="h-4 w-4" /></Button>
              </div>
            ))}
            {links.length < 10 && <Button type="button" size="sm" variant="ghost" onClick={() => setLinks([...links, { url: "", label: "" }])}><Plus className="h-3.5 w-3.5" /> Add a link</Button>}
          </fieldset>
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button asChild variant="ghost"><Link href={p.mode === "edit" && p.id ? `/my-updates/${p.id}` : "/my-updates"}>Cancel</Link></Button>
        {!isLive && <Button type="button" variant="secondary" loading={busy === "draft"} disabled={busy !== null} onClick={() => save(false)}>Save draft</Button>}
        <Button type="submit" loading={busy === "submit"} disabled={busy !== null}>{isLive ? "Save changes" : "Submit update"}</Button>
      </div>
    </form>
  );
}
