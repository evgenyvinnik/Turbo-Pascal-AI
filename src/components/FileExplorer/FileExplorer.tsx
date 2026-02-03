import { useCallback } from 'react';
import * as stylex from '@stylexjs/stylex';
import { dosColors, dosFonts } from '../../styles/tokens.stylex';
import { useFileStore, type FileNode } from '@stores/fileStore';

const styles = stylex.create({
  container: {
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: dosColors.darkBlue,
    color: dosColors.white,
    fontFamily: dosFonts.mono,
    fontSize: '12px',
    width: '200px',
    borderRight: `2px solid ${dosColors.gray}`,
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
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '4px',
  },
  node: {
    display: 'flex',
    alignItems: 'center',
    padding: '2px 4px',
    cursor: 'pointer',
    userSelect: 'none',
    ':hover': {
      backgroundColor: dosColors.blue,
    },
  },
  nodeSelected: {
    backgroundColor: dosColors.lightBlue,
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
    color: dosColors.yellow,
  },
  nodeFile: {
    color: dosColors.white,
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

  const isExpanded = expandedDirs.has(node.path);
  const isSelected = selectedPath === node.path;
  const isDirectory = node.type === 'directory';

  const handleClick = useCallback(() => {
    setSelected(node.path);
    if (isDirectory) {
      toggleExpanded(node.path);
    }
  }, [isDirectory, node.path, setSelected, toggleExpanded]);

  const handleDoubleClick = useCallback(() => {
    if (!isDirectory) {
      // TODO: Open file in editor
      console.log('Open file:', node.path);
    }
  }, [isDirectory, node.path]);

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
