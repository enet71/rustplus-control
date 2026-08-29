import type { PointerEvent as ReactPointerEvent } from 'react';
import { Moon, User, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import type { DashboardState } from '../../shared/api-types';

type TeamVisibilityPanelProps = {
  members: DashboardState['teamMapMembers'];
  hiddenIds: Set<string>;
  onToggle: (id: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function TeamVisibilityPanel({
  members,
  hiddenIds,
  onToggle,
  open,
  onOpenChange,
}: TeamVisibilityPanelProps) {
  // Interactions inside the panel must not reach `.rust-map`'s own pointer/wheel
  // handlers, or checking a box would start a map pan and scrolling the list
  // would zoom the map instead; every pointer phase is stopped so a click's
  // matching pointerup doesn't reach `.rust-map`'s handler either.
  const stopPointer = (e: ReactPointerEvent) => e.stopPropagation();
  const stopMapGesture = {
    onPointerDown: stopPointer,
    onPointerUp: stopPointer,
    onPointerCancel: stopPointer,
  };

  if (!open)
    return (
      <Button
        variant="secondary"
        size="icon"
        className="absolute top-3 right-3 z-20 bg-card/85 backdrop-blur-sm"
        onClick={() => onOpenChange(true)}
        aria-label="Show team panel"
        {...stopMapGesture}
      >
        <Users />
      </Button>
    );

  return (
    <div
      className="absolute top-3 right-3 z-20 flex max-h-[calc(100%-1.5rem)] w-56 flex-col rounded-lg border border-border bg-card/85 shadow-lg backdrop-blur-sm"
      onWheel={(e) => e.stopPropagation()}
      {...stopMapGesture}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-sm font-semibold">Teammates</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={() => onOpenChange(false)}
          aria-label="Hide team panel"
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex flex-col gap-1 overflow-y-auto p-2">
        {members.length === 0 && (
          <p className="px-1 py-1 text-xs text-muted-foreground">No teammates nearby.</p>
        )}
        {members.map((member) => (
          <Label
            key={member.id}
            className="flex items-center gap-2 rounded-md px-1 py-1 font-normal text-foreground hover:bg-muted"
          >
            <Checkbox
              checked={!hiddenIds.has(member.id)}
              onCheckedChange={() => onToggle(member.id)}
            />
            {member.isOnline ? (
              <User className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <Moon className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 truncate text-sm">{member.name}</span>
          </Label>
        ))}
      </div>
    </div>
  );
}
