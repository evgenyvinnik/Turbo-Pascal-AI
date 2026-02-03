import { useEffect, useRef } from 'react';
import * as stylex from '@stylexjs/stylex';
import { dosColors, dosFonts } from '../../styles/tokens.stylex';
import { useCompilerStore } from '@stores/compilerStore';

const styles = stylex.create({
  container: {
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: dosColors.terminalBackground,
    color: dosColors.white,
    fontFamily: dosFonts.mono,
    fontSize: '14px',
    lineHeight: '16px',
    height: '150px',
    borderTop: `2px solid ${dosColors.gray}`,
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
    padding: '4px 8px',
    whiteSpace: 'pre-wrap',
  },
  line: {
    minHeight: '16px',
  },
  lineError: {
    color: dosColors.errorColor,
  },
  lineWarning: {
    color: dosColors.warningColor,
  },
  lineSuccess: {
    color: dosColors.successColor,
  },
  lineInfo: {
    color: dosColors.cyan,
  },
});

export function Terminal() {
  const outputLines = useCompilerStore((state) => state.outputLines);
  const status = useCompilerStore((state) => state.status);
  const contentRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new output appears
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [outputLines]);

  const getLineStyle = (line: string) => {
    if (line.toLowerCase().includes('error')) {
      return styles.lineError;
    }
    if (line.toLowerCase().includes('warning')) {
      return styles.lineWarning;
    }
    if (line.toLowerCase().includes('success') || line.toLowerCase().includes('compiled')) {
      return styles.lineSuccess;
    }
    return undefined;
  };

  return (
    <div {...stylex.props(styles.container)}>
      <div {...stylex.props(styles.header)}>
        Output - {status === 'idle' ? 'Ready' : status}
      </div>
      <div {...stylex.props(styles.content)} ref={contentRef}>
        {outputLines.length === 0 ? (
          <div {...stylex.props(styles.line, styles.lineInfo)}>
            Ready. Press F9 to compile.
          </div>
        ) : (
          outputLines.map((line, index) => (
            <div key={index} {...stylex.props(styles.line, getLineStyle(line))}>
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
