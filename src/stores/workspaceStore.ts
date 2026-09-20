import { create } from 'zustand';

interface WorkspaceState {
  ready: boolean;
  status: 'loading' | 'saving' | 'saved' | 'error';
  error: string | null;
  conflict: boolean;
  notice: string | null;
  lastSavedAt: number | null;
}

/** Persistence feedback is separate from the DOS editor's modified-file flag. */
export const useWorkspaceStore = create<WorkspaceState>(() => ({
  ready: false,
  status: 'loading',
  error: null,
  conflict: false,
  notice: null,
  lastSavedAt: null,
}));
