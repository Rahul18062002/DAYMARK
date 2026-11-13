export function AuthHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
    </div>
  );
}

/** Only same-site relative paths are accepted as post-login destinations. */
export function safeNext(next: string | string[] | undefined): string {
  const v = Array.isArray(next) ? next[0] : next;
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "/dashboard";
}
