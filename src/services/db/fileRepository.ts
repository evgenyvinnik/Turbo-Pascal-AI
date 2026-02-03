import { db, type FileRecord, type DirectoryRecord } from './database';

export type FileSystemNode = FileRecord | DirectoryRecord;

/**
 * Create a new file in the database
 */
export async function createFile(
  path: string,
  name: string,
  content: string = ''
): Promise<FileRecord> {
  const now = Date.now();
  const parentPath = path.substring(0, path.lastIndexOf('/')) || '/';

  const fileRecord: FileRecord = {
    path,
    name,
    content,
    type: 'file',
    parentPath,
    createdAt: now,
    modifiedAt: now,
    size: new Blob([content]).size,
  };

  await db.files.put(fileRecord);
  return fileRecord;
}

/**
 * Read a file from the database
 */
export async function readFile(path: string): Promise<FileRecord | undefined> {
  return db.files.get(path);
}

/**
 * Update the content of an existing file
 */
export async function updateFile(
  path: string,
  content: string
): Promise<FileRecord | undefined> {
  const file = await db.files.get(path);
  if (!file) {
    return undefined;
  }

  const updatedFile: FileRecord = {
    ...file,
    content,
    modifiedAt: Date.now(),
    size: new Blob([content]).size,
  };

  await db.files.put(updatedFile);

  // Update recent files
  await db.recentFiles.put({
    path,
    accessedAt: Date.now(),
  });

  return updatedFile;
}

/**
 * Delete a file from the database
 */
export async function deleteFile(path: string): Promise<void> {
  await db.files.delete(path);
  await db.recentFiles.delete(path);
  // Also delete any breakpoints associated with this file
  await db.breakpoints.where('filePath').equals(path).delete();
}

/**
 * Create a new directory in the database
 */
export async function createDirectory(
  path: string,
  name: string
): Promise<DirectoryRecord> {
  const now = Date.now();
  const parentPath = path.substring(0, path.lastIndexOf('/')) || null;

  const directoryRecord: DirectoryRecord = {
    path,
    name,
    type: 'directory',
    parentPath,
    createdAt: now,
    modifiedAt: now,
  };

  await db.directories.put(directoryRecord);
  return directoryRecord;
}

/**
 * Delete a directory and all its contents recursively
 */
export async function deleteDirectory(path: string): Promise<void> {
  // Delete all files in this directory and subdirectories
  await db.files.where('parentPath').startsWith(path).delete();

  // Delete all subdirectories
  await db.directories.where('parentPath').startsWith(path).delete();

  // Delete the directory itself
  await db.directories.delete(path);
}

/**
 * List all files and directories in a given parent path
 */
export async function listDirectory(
  parentPath: string
): Promise<FileSystemNode[]> {
  const files = await db.files.where('parentPath').equals(parentPath).toArray();
  const directories = await db.directories
    .where('parentPath')
    .equals(parentPath)
    .toArray();

  return [...directories, ...files].sort((a, b) => {
    // Directories first, then files
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    // Then alphabetically by name
    return a.name.localeCompare(b.name);
  });
}

/**
 * Move a file or directory to a new location
 */
export async function moveNode(
  sourcePath: string,
  destPath: string
): Promise<void> {
  // Check if source is a file
  const file = await db.files.get(sourcePath);
  if (file) {
    const newParentPath = destPath.substring(0, destPath.lastIndexOf('/')) || '/';
    const newName = destPath.substring(destPath.lastIndexOf('/') + 1);

    await db.files.delete(sourcePath);
    await db.files.put({
      ...file,
      path: destPath,
      name: newName,
      parentPath: newParentPath,
      modifiedAt: Date.now(),
    });

    // Update recent files reference
    await db.recentFiles.delete(sourcePath);
    await db.recentFiles.put({
      path: destPath,
      accessedAt: Date.now(),
    });

    // Update breakpoints
    const breakpoints = await db.breakpoints.where('filePath').equals(sourcePath).toArray();
    for (const bp of breakpoints) {
      await db.breakpoints.put({
        ...bp,
        filePath: destPath,
      });
    }

    return;
  }

  // Source is a directory
  const directory = await db.directories.get(sourcePath);
  if (directory) {
    const newParentPath = destPath.substring(0, destPath.lastIndexOf('/')) || null;
    const newName = destPath.substring(destPath.lastIndexOf('/') + 1);

    // Get all items that need to be moved (files and subdirectories)
    const filesToMove = await db.files
      .where('parentPath')
      .startsWith(sourcePath)
      .toArray();
    const dirsToMove = await db.directories
      .where('parentPath')
      .startsWith(sourcePath)
      .toArray();

    // Update all files
    for (const f of filesToMove) {
      const newFilePath = f.path.replace(sourcePath, destPath);
      const newFileParentPath = f.parentPath.replace(sourcePath, destPath);
      await db.files.delete(f.path);
      await db.files.put({
        ...f,
        path: newFilePath,
        parentPath: newFileParentPath,
        modifiedAt: Date.now(),
      });

      // Update breakpoints for moved files
      const breakpoints = await db.breakpoints.where('filePath').equals(f.path).toArray();
      for (const bp of breakpoints) {
        await db.breakpoints.put({
          ...bp,
          filePath: newFilePath,
        });
      }
    }

    // Update all subdirectories
    for (const d of dirsToMove) {
      const newDirPath = d.path.replace(sourcePath, destPath);
      const newDirParentPath = d.parentPath
        ? d.parentPath.replace(sourcePath, destPath)
        : null;
      await db.directories.delete(d.path);
      await db.directories.put({
        ...d,
        path: newDirPath,
        parentPath: newDirParentPath,
        modifiedAt: Date.now(),
      });
    }

    // Update the directory itself
    await db.directories.delete(sourcePath);
    await db.directories.put({
      ...directory,
      path: destPath,
      name: newName,
      parentPath: newParentPath,
      modifiedAt: Date.now(),
    });
  }
}

/**
 * Rename a file or directory
 */
export async function renameNode(
  path: string,
  newName: string
): Promise<void> {
  const parentPath = path.substring(0, path.lastIndexOf('/')) || '/';
  const newPath = parentPath === '/' ? `/${newName}` : `${parentPath}/${newName}`;

  await moveNode(path, newPath);
}

/**
 * Check if a path exists (either as file or directory)
 */
export async function pathExists(path: string): Promise<boolean> {
  const file = await db.files.get(path);
  if (file) return true;

  const directory = await db.directories.get(path);
  return !!directory;
}

/**
 * Get recent files ordered by access time
 */
export async function getRecentFiles(limit: number = 10): Promise<FileRecord[]> {
  const recentRecords = await db.recentFiles
    .orderBy('accessedAt')
    .reverse()
    .limit(limit)
    .toArray();

  const files: FileRecord[] = [];
  for (const record of recentRecords) {
    const file = await db.files.get(record.path);
    if (file) {
      files.push(file);
    }
  }

  return files;
}

/**
 * Add a file to recent files list
 */
export async function addToRecentFiles(path: string): Promise<void> {
  await db.recentFiles.put({
    path,
    accessedAt: Date.now(),
  });
}

/**
 * Search files by name pattern
 */
export async function searchFiles(pattern: string): Promise<FileRecord[]> {
  const lowerPattern = pattern.toLowerCase();
  return db.files
    .filter((file) => file.name.toLowerCase().includes(lowerPattern))
    .toArray();
}

/**
 * Get all files in the database
 */
export async function getAllFiles(): Promise<FileRecord[]> {
  return db.files.toArray();
}

/**
 * Get all directories in the database
 */
export async function getAllDirectories(): Promise<DirectoryRecord[]> {
  return db.directories.toArray();
}

/**
 * Initialize the root directory if it doesn't exist
 */
export async function initializeRootDirectory(): Promise<void> {
  const root = await db.directories.get('/');
  if (!root) {
    await createDirectory('/', 'Projects');
  }
}
