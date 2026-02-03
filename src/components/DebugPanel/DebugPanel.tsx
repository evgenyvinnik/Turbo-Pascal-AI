import * as stylex from '@stylexjs/stylex';
import { dosColors, dosFonts } from '@styles/tokens.stylex';
import { useDebugStore } from '@stores/debugStore';

const styles = stylex.create({
  container: {
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: dosColors.darkBlue,
    color: dosColors.white,
    fontFamily: dosFonts.mono,
    fontSize: '12px',
    width: '250px',
    borderLeft: `2px solid ${dosColors.gray}`,
    overflow: 'hidden',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    borderBottom: `1px solid ${dosColors.blue}`,
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    backgroundColor: dosColors.blue,
    color: dosColors.white,
    padding: '2px 8px',
    fontWeight: 'bold',
    userSelect: 'none',
  },
  sectionContent: {
    flex: 1,
    overflow: 'auto',
    padding: '4px',
    maxHeight: '120px',
  },
  row: {
    display: 'flex',
    padding: '1px 4px',
    ':hover': {
      backgroundColor: dosColors.blue,
    },
  },
  rowLabel: {
    flex: 1,
    color: dosColors.yellow,
  },
  rowValue: {
    color: dosColors.white,
    textAlign: 'right',
  },
  registerGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '4px',
    padding: '4px',
  },
  register: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '2px 4px',
    backgroundColor: dosColors.darkBlue,
  },
  registerName: {
    color: dosColors.cyan,
  },
  registerValue: {
    color: dosColors.white,
    fontFamily: dosFonts.mono,
  },
  emptyMessage: {
    color: dosColors.gray,
    fontStyle: 'italic',
    padding: '8px',
  },
});

export function DebugPanel() {
  const status = useDebugStore((state) => state.status);
  const watches = useDebugStore((state) => state.watches);
  const callStack = useDebugStore((state) => state.callStack);
  const registers = useDebugStore((state) => state.registers);

  return (
    <div {...stylex.props(styles.container)}>
      {/* Watches Section */}
      <div {...stylex.props(styles.section)}>
        <div {...stylex.props(styles.sectionHeader)}>Watches</div>
        <div {...stylex.props(styles.sectionContent)}>
          {watches.length === 0 ? (
            <div {...stylex.props(styles.emptyMessage)}>No watches</div>
          ) : (
            watches.map((watch) => (
              <div key={watch.id} {...stylex.props(styles.row)}>
                <span {...stylex.props(styles.rowLabel)}>{watch.expression}</span>
                <span {...stylex.props(styles.rowValue)}>
                  {String(watch.value ?? 'undefined')}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Call Stack Section */}
      <div {...stylex.props(styles.section)}>
        <div {...stylex.props(styles.sectionHeader)}>Call Stack</div>
        <div {...stylex.props(styles.sectionContent)}>
          {callStack.length === 0 ? (
            <div {...stylex.props(styles.emptyMessage)}>
              {status === 'stopped' ? 'Not running' : 'No stack frames'}
            </div>
          ) : (
            callStack.map((frame, index) => (
              <div key={frame.id} {...stylex.props(styles.row)}>
                <span {...stylex.props(styles.rowLabel)}>
                  {index === 0 ? '>' : ' '} {frame.name}
                </span>
                <span {...stylex.props(styles.rowValue)}>:{frame.line}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Registers Section */}
      <div {...stylex.props(styles.section)}>
        <div {...stylex.props(styles.sectionHeader)}>Registers</div>
        <div {...stylex.props(styles.registerGrid)}>
          <div {...stylex.props(styles.register)}>
            <span {...stylex.props(styles.registerName)}>PC</span>
            <span {...stylex.props(styles.registerValue)}>
              {registers.pc.toString(16).padStart(4, '0').toUpperCase()}
            </span>
          </div>
          <div {...stylex.props(styles.register)}>
            <span {...stylex.props(styles.registerName)}>SP</span>
            <span {...stylex.props(styles.registerValue)}>
              {registers.sp.toString(16).padStart(4, '0').toUpperCase()}
            </span>
          </div>
          <div {...stylex.props(styles.register)}>
            <span {...stylex.props(styles.registerName)}>MP</span>
            <span {...stylex.props(styles.registerValue)}>
              {registers.mp.toString(16).padStart(4, '0').toUpperCase()}
            </span>
          </div>
          <div {...stylex.props(styles.register)}>
            <span {...stylex.props(styles.registerName)}>NP</span>
            <span {...stylex.props(styles.registerValue)}>
              {registers.np.toString(16).padStart(4, '0').toUpperCase()}
            </span>
          </div>
          <div {...stylex.props(styles.register)}>
            <span {...stylex.props(styles.registerName)}>EP</span>
            <span {...stylex.props(styles.registerValue)}>
              {registers.ep.toString(16).padStart(4, '0').toUpperCase()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
