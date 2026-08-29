import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CustomMarker } from '../../shared/api-types';

type CustomMarkerInfoDialogProps = {
  marker: CustomMarker;
  onEdit: () => void;
  close: () => void;
};

export function CustomMarkerInfoDialog({ marker, onEdit, close }: CustomMarkerInfoDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{marker.name}</DialogTitle>
          <DialogDescription>{marker.description || 'No description.'}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onEdit}>
            <Pencil /> Edit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
