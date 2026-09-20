import { useEffect } from 'react';
import { useDesktopStore } from '@stores/desktopStore';
import { useDialogStore } from '@stores/dialogStore';
import { messageDialog } from '@components/Dialogs/dialogDefs';
import { importProgramFiles, programDisk } from './programFiles';

/** Native file drops add no controls or overlays to the original DOS screen. */
export function ProgramFileDrop() {
  useEffect(() => {
    let active = true;
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files');
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      const files = Array.from(event.dataTransfer?.files ?? []);
      void (async () => {
        try {
          // Opening an existing editor path would focus its old contents. Keep
          // unsaved buffers intact and make that conflict explicit before import.
          const buffers = Object.values(useDesktopStore.getState().buffers);
          for (const file of files) {
            const path = programDisk.normalize(file.name);
            if (
              /\.pas$/i.test(path) &&
              buffers.some((buffer) => programDisk.normalize(buffer.path) === path)
            )
              throw new Error(
                `${path} is already open. Rename the dropped source to keep both versions. No files were imported.`
              );
          }
          const result = await importProgramFiles(files);
          if (!active) return;
          for (const source of result.sources)
            useDesktopStore.getState().openFile(source.name, source.path, source.text);
        } catch (error) {
          if (!active) return;
          const detail = error instanceof Error ? error.message : String(error);
          useDialogStore
            .getState()
            .open(
              messageDialog(
                'File import',
                detail.match(/.{1,34}(?:\s|$)|.{1,34}/g)?.map((line) => line.trim()) ?? [detail]
              )
            );
        }
      })();
    };
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);
    return () => {
      active = false;
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
    };
  }, []);
  return null;
}
