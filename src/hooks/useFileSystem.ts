import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createFile,
  readFile,
  updateFile,
  deleteFile,
  createDirectory,
  deleteDirectory,
  listDirectory,
  moveNode,
  renameNode,
  getRecentFiles,
  searchFiles,
  initializeRootDirectory,
  type FileRecord,
  type DirectoryRecord,
  type FileSystemNode,
} from '../services/db';

// Query keys for cache management
export const fileSystemKeys = {
  all: ['fileSystem'] as const,
  directory: (path: string) => [...fileSystemKeys.all, 'directory', path] as const,
  file: (path: string) => [...fileSystemKeys.all, 'file', path] as const,
  recentFiles: () => [...fileSystemKeys.all, 'recent'] as const,
  search: (pattern: string) => [...fileSystemKeys.all, 'search', pattern] as const,
};

/**
 * Hook to initialize the file system root directory
 */
export function useInitializeFileSystem() {
  return useQuery({
    queryKey: ['fileSystem', 'init'],
    queryFn: async () => {
      await initializeRootDirectory();
      return true;
    },
    staleTime: Infinity,
  });
}

/**
 * Hook to list contents of a directory
 */
export function useDirectory(parentPath: string) {
  return useQuery({
    queryKey: fileSystemKeys.directory(parentPath),
    queryFn: () => listDirectory(parentPath),
  });
}

/**
 * Hook to read a single file
 */
export function useFile(path: string | null) {
  return useQuery({
    queryKey: fileSystemKeys.file(path ?? ''),
    queryFn: () => (path ? readFile(path) : Promise.resolve(undefined)),
    enabled: !!path,
  });
}

/**
 * Hook to get recent files
 */
export function useRecentFiles(limit: number = 10) {
  return useQuery({
    queryKey: fileSystemKeys.recentFiles(),
    queryFn: () => getRecentFiles(limit),
  });
}

/**
 * Hook to search files by pattern
 */
export function useSearchFiles(pattern: string) {
  return useQuery({
    queryKey: fileSystemKeys.search(pattern),
    queryFn: () => searchFiles(pattern),
    enabled: pattern.length > 0,
  });
}

/**
 * Hook to create a new file
 */
export function useCreateFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      path,
      name,
      content = '',
    }: {
      path: string;
      name: string;
      content?: string;
    }): Promise<FileRecord> => {
      return createFile(path, name, content);
    },
    onSuccess: (file) => {
      // Invalidate the parent directory cache
      void queryClient.invalidateQueries({
        queryKey: fileSystemKeys.directory(file.parentPath),
      });
      // Set the file in cache
      queryClient.setQueryData(fileSystemKeys.file(file.path), file);
    },
  });
}

/**
 * Hook to update file content
 */
export function useUpdateFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      path,
      content,
    }: {
      path: string;
      content: string;
    }): Promise<FileRecord | undefined> => {
      return updateFile(path, content);
    },
    onSuccess: (file, variables) => {
      if (file) {
        // Update the file in cache
        queryClient.setQueryData(fileSystemKeys.file(variables.path), file);
        // Invalidate recent files
        void queryClient.invalidateQueries({
          queryKey: fileSystemKeys.recentFiles(),
        });
      }
    },
  });
}

/**
 * Hook to delete a file
 */
export function useDeleteFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (path: string): Promise<void> => {
      return deleteFile(path);
    },
    onSuccess: (_, path) => {
      // Get parent path for cache invalidation
      const parentPath = path.substring(0, path.lastIndexOf('/')) || '/';
      // Remove file from cache
      queryClient.removeQueries({
        queryKey: fileSystemKeys.file(path),
      });
      // Invalidate parent directory
      void queryClient.invalidateQueries({
        queryKey: fileSystemKeys.directory(parentPath),
      });
      // Invalidate recent files
      void queryClient.invalidateQueries({
        queryKey: fileSystemKeys.recentFiles(),
      });
    },
  });
}

/**
 * Hook to create a new directory
 */
export function useCreateDirectory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      path,
      name,
    }: {
      path: string;
      name: string;
    }): Promise<DirectoryRecord> => {
      return createDirectory(path, name);
    },
    onSuccess: (directory) => {
      // Invalidate the parent directory cache
      const parentPath = directory.parentPath ?? '/';
      void queryClient.invalidateQueries({
        queryKey: fileSystemKeys.directory(parentPath),
      });
    },
  });
}

/**
 * Hook to delete a directory
 */
export function useDeleteDirectory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (path: string): Promise<void> => {
      return deleteDirectory(path);
    },
    onSuccess: (_, path) => {
      // Get parent path for cache invalidation
      const parentPath = path.substring(0, path.lastIndexOf('/')) || '/';
      // Invalidate parent directory
      void queryClient.invalidateQueries({
        queryKey: fileSystemKeys.directory(parentPath),
      });
      // Invalidate all directory queries (subdirectories may be affected)
      void queryClient.invalidateQueries({
        queryKey: fileSystemKeys.all,
      });
    },
  });
}

/**
 * Hook to move a file or directory
 */
export function useMoveNode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sourcePath,
      destPath,
    }: {
      sourcePath: string;
      destPath: string;
    }): Promise<void> => {
      return moveNode(sourcePath, destPath);
    },
    onSuccess: () => {
      // Invalidate all file system queries as move affects multiple locations
      void queryClient.invalidateQueries({
        queryKey: fileSystemKeys.all,
      });
    },
  });
}

/**
 * Hook to rename a file or directory
 */
export function useRenameNode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ path, newName }: { path: string; newName: string }): Promise<void> => {
      return renameNode(path, newName);
    },
    onSuccess: (_, variables) => {
      // Get parent path
      const parentPath = variables.path.substring(0, variables.path.lastIndexOf('/')) || '/';
      // Invalidate parent directory
      void queryClient.invalidateQueries({
        queryKey: fileSystemKeys.directory(parentPath),
      });
      // Remove old file cache
      queryClient.removeQueries({
        queryKey: fileSystemKeys.file(variables.path),
      });
    },
  });
}

/**
 * Combined hook providing all file system operations
 */
export function useFileSystem() {
  const queryClient = useQueryClient();

  const createFileMutation = useCreateFile();
  const updateFileMutation = useUpdateFile();
  const deleteFileMutation = useDeleteFile();
  const createDirectoryMutation = useCreateDirectory();
  const deleteDirectoryMutation = useDeleteDirectory();
  const moveNodeMutation = useMoveNode();
  const renameNodeMutation = useRenameNode();

  return {
    // Mutations
    createFile: createFileMutation.mutateAsync,
    updateFile: updateFileMutation.mutateAsync,
    deleteFile: deleteFileMutation.mutateAsync,
    createDirectory: createDirectoryMutation.mutateAsync,
    deleteDirectory: deleteDirectoryMutation.mutateAsync,
    moveNode: moveNodeMutation.mutateAsync,
    renameNode: renameNodeMutation.mutateAsync,

    // Loading states
    isCreatingFile: createFileMutation.isPending,
    isUpdatingFile: updateFileMutation.isPending,
    isDeletingFile: deleteFileMutation.isPending,
    isCreatingDirectory: createDirectoryMutation.isPending,
    isDeletingDirectory: deleteDirectoryMutation.isPending,
    isMovingNode: moveNodeMutation.isPending,
    isRenamingNode: renameNodeMutation.isPending,

    // Error states
    createFileError: createFileMutation.error,
    updateFileError: updateFileMutation.error,
    deleteFileError: deleteFileMutation.error,
    createDirectoryError: createDirectoryMutation.error,
    deleteDirectoryError: deleteDirectoryMutation.error,
    moveNodeError: moveNodeMutation.error,
    renameNodeError: renameNodeMutation.error,

    // Utilities
    invalidateAll: () => queryClient.invalidateQueries({ queryKey: fileSystemKeys.all }),
    invalidateDirectory: (path: string) =>
      queryClient.invalidateQueries({
        queryKey: fileSystemKeys.directory(path),
      }),
  };
}

export type { FileRecord, DirectoryRecord, FileSystemNode };
