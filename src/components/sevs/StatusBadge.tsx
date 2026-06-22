import type { ElectionStatus } from "@/lib/sevs-types";
import { cn } from "@/lib/utils";

const map: Record<ElectionStatus, { label: string; cls: string }> = {
  open: { label: "Open", cls: "bg-success/15 text-success border-success/30" },
  closed: { label: "Closed", cls: "bg-muted text-muted-foreground border-border" },
  draft: { label: "Draft", cls: "bg-warning/15 text-warning-foreground border-warning/40" },
};

export function StatusBadge({ status }: { status: ElectionStatus }) {
  const m = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        m.cls,
      )}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
      {m.label}
    </span>
  );
}
