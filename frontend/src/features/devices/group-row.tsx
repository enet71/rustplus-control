import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Toggle } from '../../shared/ui/toggle';
import type { Device, DeviceGroup } from '../../shared/api-types';

type GroupRowProps = {
  group: DeviceGroup;
  members: Device[];
  switchCount: number;
  enabled: boolean;
  collapsed: boolean;
  pending: boolean;
  onToggle: (group: DeviceGroup, enabled: boolean) => void;
  onToggleCollapsed: (groupId: string) => void;
  onEdit: (group: DeviceGroup) => void;
};

export function GroupRow({
  group,
  members,
  switchCount,
  enabled,
  collapsed,
  pending,
  onToggle,
  onToggleCollapsed,
  onEdit,
}: GroupRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.id,
  });
  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-4 rounded-lg border border-border border-l-[3px] bg-card p-3.5 transition-colors hover:bg-muted',
        switchCount === 0
          ? 'border-l-border'
          : enabled
            ? 'border-l-success'
            : 'border-l-destructive',
        isDragging && 'opacity-60',
      )}
    >
      <button
        type="button"
        className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label={`Reorder ${group.name}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold">{group.name}</h3>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {members.length} device{members.length === 1 ? '' : 's'}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="secondary" onClick={() => onEdit(group)}>
          Edit
        </Button>
        <Button
          variant="secondary"
          size="icon"
          onClick={() => onToggleCollapsed(group.id)}
          aria-label="Collapse group"
          aria-expanded={!collapsed}
        >
          <ChevronDown className={cn('size-4 transition-transform', collapsed && '-rotate-90')} />
        </Button>
        {switchCount > 0 && (
          <Toggle
            name={group.name}
            enabled={enabled}
            disabled={pending}
            onClick={() => onToggle(group, !enabled)}
          />
        )}
      </div>
    </article>
  );
}
