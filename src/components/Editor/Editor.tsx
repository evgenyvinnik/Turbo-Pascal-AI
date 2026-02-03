import { useCallback, useEffect, useRef, useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import { dosColors, dosFonts } from '../../styles/tokens.stylex';
import { useEditorStore } from '@stores/editorStore';

const CHAR_WIDTH = 8.4; // Approximate width of monospace character
const CHAR_HEIGHT = 16; // Line height

const styles = stylex.create({
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: dosColors.editorBackground,
    overflow: 'hidden',
  },
  editorWrapper: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
    position: 'relative',
  },
  lineNumbers: {
    width: '48px',
    backgroundColor: dosColors.darkBlue,
    color: dosColors.yellow,
    fontFamily: dosFonts.mono,
    fontSize: '14px',
    lineHeight: `${CHAR_HEIGHT}px`,
    textAlign: 'right',
    paddingRight: '8px',
    userSelect: 'none',
    overflow: 'hidden',
  },
  lineNumber: {
    height: `${CHAR_HEIGHT}px`,
  },
  lineNumberActive: {
    backgroundColor: dosColors.blue,
    color: dosColors.white,
  },
  content: {
    flex: 1,
    position: 'relative',
    overflow: 'auto',
    fontFamily: dosFonts.mono,
    fontSize: '14px',
    lineHeight: `${CHAR_HEIGHT}px`,
    color: dosColors.white,
    cursor: 'text',
  },
  textarea: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    padding: '0 4px',
    margin: 0,
    border: 'none',
    outline: 'none',
    backgroundColor: 'transparent',
    color: dosColors.white,
    fontFamily: dosFonts.mono,
    fontSize: '14px',
    lineHeight: `${CHAR_HEIGHT}px`,
    resize: 'none',
    whiteSpace: 'pre',
    overflowWrap: 'normal',
    caretColor: dosColors.yellow,
  },
  cursor: {
    position: 'absolute',
    width: `${CHAR_WIDTH}px`,
    height: `${CHAR_HEIGHT}px`,
    backgroundColor: dosColors.yellow,
    opacity: 0.7,
    pointerEvents: 'none',
    animation: 'blink 1s step-end infinite',
  },
  selection: {
    position: 'absolute',
    backgroundColor: dosColors.selectionBackground,
    opacity: 0.5,
    pointerEvents: 'none',
  },
});

// Pascal keywords for syntax highlighting (will be used for syntax highlighting)
const _KEYWORDS = new Set([
  'program', 'unit', 'uses', 'interface', 'implementation',
  'var', 'const', 'type', 'procedure', 'function',
  'begin', 'end', 'if', 'then', 'else', 'case', 'of',
  'while', 'do', 'repeat', 'until', 'for', 'to', 'downto',
  'array', 'record', 'set', 'file', 'string',
  'and', 'or', 'not', 'div', 'mod', 'in', 'nil',
  'true', 'false', 'exit', 'break', 'continue',
]);

interface EditorProps {
  fileId: string;
}

export function Editor({ fileId }: EditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [cursorVisible, setCursorVisible] = useState(true);

  const file = useEditorStore((state) => state.files.get(fileId));
  const updateContent = useEditorStore((state) => state.updateContent);
  const setCursorPosition = useEditorStore((state) => state.setCursorPosition);
  const insertMode = useEditorStore((state) => state.insertMode);
  const toggleInsertMode = useEditorStore((state) => state.toggleInsertMode);

  const content = file?.content ?? '';
  const cursorPosition = file?.cursorPosition ?? { line: 1, column: 1 };

  const lines = content.split('\n');

  // Cursor blink effect
  useEffect(() => {
    const interval = setInterval(() => {
      setCursorVisible((v) => !v);
    }, 530);
    return () => clearInterval(interval);
  }, []);

  // Reset cursor visibility on position change
  useEffect(() => {
    setCursorVisible(true);
  }, [cursorPosition]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateContent(fileId, e.target.value);
    },
    [fileId, updateContent]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Handle Insert key for insert/overwrite mode
      if (e.key === 'Insert') {
        e.preventDefault();
        toggleInsertMode();
        return;
      }

      // Handle Tab key
      if (e.key === 'Tab') {
        e.preventDefault();
        const target = e.currentTarget;
        const start = target.selectionStart;
        const end = target.selectionEnd;
        const newContent = content.slice(0, start) + '  ' + content.slice(end);
        updateContent(fileId, newContent);
        // Set cursor position after tab
        requestAnimationFrame(() => {
          target.selectionStart = target.selectionEnd = start + 2;
        });
      }
    },
    [content, fileId, toggleInsertMode, updateContent]
  );

  const handleSelect = useCallback(
    (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
      const target = e.currentTarget;
      const pos = target.selectionStart;
      const textBeforeCursor = content.slice(0, pos);
      const linesBeforeCursor = textBeforeCursor.split('\n');
      const line = linesBeforeCursor.length;
      const column = (linesBeforeCursor[linesBeforeCursor.length - 1]?.length ?? 0) + 1;
      setCursorPosition(fileId, { line, column });
    },
    [content, fileId, setCursorPosition]
  );

  const getCursorPixelPosition = (): { left: number; top: number } => {
    const line = cursorPosition.line - 1;
    const column = cursorPosition.column - 1;
    return {
      left: column * CHAR_WIDTH + 4,
      top: line * CHAR_HEIGHT,
    };
  };

  const cursorPos = getCursorPixelPosition();

  return (
    <div {...stylex.props(styles.container)}>
      <div {...stylex.props(styles.editorWrapper)}>
        <div {...stylex.props(styles.lineNumbers)}>
          {lines.map((_, index) => (
            <div
              key={index}
              {...stylex.props(
                styles.lineNumber,
                index + 1 === cursorPosition.line && styles.lineNumberActive
              )}
            >
              {index + 1}
            </div>
          ))}
        </div>
        <div {...stylex.props(styles.content)} ref={contentRef}>
          <textarea
            ref={textareaRef}
            {...stylex.props(styles.textarea)}
            value={content}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onSelect={handleSelect}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
          {cursorVisible && !insertMode && (
            <div
              {...stylex.props(styles.cursor)}
              style={{
                left: cursorPos.left,
                top: cursorPos.top,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
