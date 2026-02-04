import { useCallback } from 'react';
import * as stylex from '@stylexjs/stylex';
import { dosColors, dosFonts, dosShadows } from '../../styles/tokens.stylex';
import { useFileStore, type FileNode } from '@stores/fileStore';
import { useEditorStore } from '@stores/editorStore';

const styles = stylex.create({
  container: {
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: dosColors.cyan,
    color: dosColors.black,
    fontFamily: dosFonts.mono,
    fontSize: '12px',
    width: '200px',
    borderRight: `2px solid ${dosColors.black}`,
    boxShadow: dosShadows.panel,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    backgroundColor: dosColors.blue,
    color: dosColors.white,
    padding: '2px 8px',
    fontWeight: 'bold',
    userSelect: 'none',
    borderBottom: `1px solid ${dosColors.black}`,
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '4px',
    backgroundColor: dosColors.cyan,
  },
  node: {
    display: 'flex',
    alignItems: 'center',
    padding: '2px 4px',
    cursor: 'pointer',
    userSelect: 'none',
    ':hover': {
      backgroundColor: dosColors.blue,
      color: dosColors.white,
    },
  },
  nodeSelected: {
    backgroundColor: dosColors.blue,
    color: dosColors.white,
  },
  nodeIcon: {
    marginRight: '4px',
    width: '12px',
    textAlign: 'center',
  },
  nodeName: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  nodeDirectory: {
    color: dosColors.black,
  },
  nodeFile: {
    color: dosColors.black,
  },
  indent: {
    width: '12px',
    display: 'inline-block',
  },
});

interface TreeNodeProps {
  node: FileNode;
  depth: number;
}

function TreeNode({ node, depth }: TreeNodeProps) {
  const selectedPath = useFileStore((state) => state.selectedPath);
  const expandedDirs = useFileStore((state) => state.expandedDirs);
  const fileTree = useFileStore((state) => state.fileTree);
  const toggleExpanded = useFileStore((state) => state.toggleExpanded);
  const setSelected = useFileStore((state) => state.setSelected);
  const readFile = useFileStore((state) => state.readFile);
  const openFile = useEditorStore((state) => state.openFile);

  const isExpanded = expandedDirs.has(node.path);
  const isSelected = selectedPath === node.path;
  const isDirectory = node.type === 'directory';

  const handleClick = useCallback(() => {
    setSelected(node.path);
    if (isDirectory) {
      toggleExpanded(node.path);
    }
  }, [isDirectory, node.path, setSelected, toggleExpanded]);

  const handleDoubleClick = useCallback(async () => {
    if (!isDirectory) {
      // Read file content and open in editor
      try {
        const content = await readFile(node.path);
        openFile(node.path, node.name, content || `{ File: ${node.name} }`);
      } catch {
        // Open with placeholder content if read fails
        openFile(node.path, node.name, `program ${node.name.replace('.PAS', '')};\nbegin\n  \nend.\n`);
      }
    }
  }, [isDirectory, node.path, node.name, readFile, openFile]);

  const children = isDirectory && node.children
    ? node.children
        .map((childId) => fileTree.get(childId))
        .filter((child): child is FileNode => child !== undefined)
    : [];

  return (
    <>
      <div
        {...stylex.props(
          styles.node,
          isSelected && styles.nodeSelected,
          isDirectory ? styles.nodeDirectory : styles.nodeFile
        )}
        style={{ paddingLeft: depth * 12 + 4 }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <span {...stylex.props(styles.nodeIcon)}>
          {isDirectory ? (isExpanded ? '[-]' : '[+]') : ' '}
        </span>
        <span {...stylex.props(styles.nodeName)}>{node.name}</span>
      </div>
      {isDirectory && isExpanded && children.map((child) => (
        <TreeNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

export function FileExplorer() {
  const fileTree = useFileStore((state) => state.fileTree);
  const rootId = useFileStore((state) => state.rootId);
  const rootNode = fileTree.get(rootId);

  return (
    <div {...stylex.props(styles.container)}>
      <div {...stylex.props(styles.header)}>Files</div>
      <div {...stylex.props(styles.content)}>
        {rootNode && <TreeNode node={rootNode} depth={0} />}
      </div>
    </div>
  );
}
