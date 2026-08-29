import type { PointerEvent as ReactPointerEvent } from 'react';
import { Flag, MapPin, MapPinPlus, MoreVertical, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import type { CustomMarker } from '../../shared/api-types';
import type { NoteSource } from './hidden-note-sources';

type CustomMarkersPanelProps = {
  markers: CustomMarker[];
  hiddenNoteSources: Set<NoteSource>;
  onToggleNoteSource: (source: NoteSource) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placing: boolean;
  onStartPlacing: () => void;
  onEdit: (marker: CustomMarker) => void;
  onDelete: (marker: CustomMarker) => void;
};

export function CustomMarkersPanel({
  markers,
  hiddenNoteSources,
  onToggleNoteSource,
  open,
  onOpenChange,
  placing,
  onStartPlacing,
  onEdit,
  onDelete,
}: CustomMarkersPanelProps) {
  // Interactions inside the panel must not reach `.rust-map`'s own pointer/wheel
  // handlers, or clicking a row would start a map pan (or register as a marker
  // placement click); every pointer phase is stopped so a click's matching
  // pointerup doesn't reach `.rust-map`'s handler either.
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
        className="absolute top-3 left-3 z-20 bg-card/85 backdrop-blur-sm"
        onClick={() => onOpenChange(true)}
        aria-label="Show markers panel"
        {...stopMapGesture}
      >
        <Flag />
      </Button>
    );

  return (
    <div
      className="absolute top-3 left-3 z-20 flex max-h-[calc(100%-1.5rem)] w-56 flex-col rounded-lg border border-border bg-card/85 shadow-lg backdrop-blur-sm"
      onWheel={(e) => e.stopPropagation()}
      {...stopMapGesture}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-sm font-semibold">Markers</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={() => onOpenChange(false)}
          aria-label="Hide markers panel"
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex shrink-0 flex-col gap-1 border-b border-border p-2">
        <p className="px-1 text-xs font-medium text-muted-foreground">Map markers</p>
        <Label className="flex items-center gap-2 rounded-md px-1 py-1 font-normal text-foreground hover:bg-muted">
          <Checkbox
            checked={!hiddenNoteSources.has('own')}
            onCheckedChange={() => onToggleNoteSource('own')}
          />
          <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate text-sm">My markers</span>
        </Label>
        <Label className="flex items-center gap-2 rounded-md px-1 py-1 font-normal text-foreground hover:bg-muted">
          <Checkbox
            checked={!hiddenNoteSources.has('leader')}
            onCheckedChange={() => onToggleNoteSource('leader')}
          />
          <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate text-sm">Leader's markers</span>
        </Label>
      </div>
      <div className="flex flex-col gap-1 overflow-y-auto p-2">
        <p className="px-1 text-xs font-medium text-muted-foreground">Custom markers</p>
        <Button
          variant="secondary"
          className="justify-start"
          onClick={onStartPlacing}
          disabled={placing}
        >
          <Plus /> {placing ? 'Click on the map…' : 'Add marker'}
        </Button>
        {markers.length === 0 && (
          <p className="px-1 py-1 text-xs text-muted-foreground">No custom markers yet.</p>
        )}
        {markers.map((marker) => (
          <div
            key={marker.id}
            className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted"
            title={marker.description || undefined}
          >
            <MapPinPlus className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm">{marker.name}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0"
                  aria-label={`More actions for ${marker.name}`}
                >
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onEdit(marker)}>
                  <Pencil /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => onDelete(marker)}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </div>
    </div>
  );
}
