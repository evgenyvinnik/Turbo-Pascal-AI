import { useEffect, useRef, useState } from 'react';
import { closeDosSession, discardDosSession, dosExitIsPending, exportDosFiles, getDosMachine, importFilesToDos, openDosDebugger, syncDosFiles, useDosStore } from '../../services/dos/dosSession';
import { dosKeyCode } from '../../services/dos/dosRuntime';
import { DOS_EXAMPLES } from '../../services/dos/fixtures';
import { stringToBytes } from '../../services/dos/dosFiles';
import { openNativePascalSession } from '../../services/dos/nativePascal';
import './dosWorkspace.css';

export function DosWorkspace() {
  const state = useDosStore();
  const canvas = useRef<HTMLCanvasElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const act = async (operation: () => Promise<unknown>, message = '') => {
    setBusy(true);
    try { await operation(); setNotice(message); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); canvas.current?.focus(); }
  };

  const { frame, frameWidth, frameHeight } = state;
  useEffect(() => {
    // Paint at the frame's own size: the screen may already have been resized
    // for a mode this frame predates, and ImageData throws on a mismatch.
    if (!frame || !canvas.current || frame.length !== frameWidth * frameHeight * 4) return;
    canvas.current.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(frame), frameWidth, frameHeight), 0, 0);
  }, [frame, frameWidth, frameHeight]);

  useEffect(() => {
    if (!state.visible) return;
    canvas.current?.focus();
    const held = new Set<number>();
    const release = () => { for (const code of held) getDosMachine()?.sendKeyEvent(code, false); held.clear(); };
    const onKey = (event: KeyboardEvent) => {
      event.stopImmediatePropagation();
      if (event.ctrlKey && event.altKey && event.code === 'Escape') {
        event.preventDefault();
        if (event.type === 'keydown') void closeDosSession();
        return;
      }
      const element = event.target;
      if (element instanceof HTMLInputElement || element instanceof HTMLButtonElement) return;
      event.preventDefault();
      const code = dosKeyCode(event.code);
      if (code === null || event.repeat) return;
      const pressed = event.type === 'keydown';
      // Submitting EXIT tears down the DOS layer, after which the drive can no
      // longer be read. Close here instead, while the files are still readable.
      if (code === 257 && dosExitIsPending()) {
        if (pressed) void closeDosSession();
        return;
      }
      if (code < 340) {
        const shiftedCharacter = event.key.length === 1 && ('~!@#$%^&*()_+{}|:"<>?'.includes(event.key) || /[A-Z]/.test(event.key));
        for (const [modifier, active] of [[340, event.shiftKey || shiftedCharacter], [341, event.ctrlKey], [342, event.altKey]] as const) {
          getDosMachine()?.sendKeyEvent(modifier, active);
          if (active) held.add(modifier); else held.delete(modifier);
        }
      }
      if (pressed) held.add(code); else held.delete(code);
      getDosMachine()?.sendKeyEvent(code, pressed);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keyup', onKey, true);
    window.addEventListener('blur', release);
    return () => { release(); document.removeEventListener('keydown', onKey, true); document.removeEventListener('keyup', onKey, true); window.removeEventListener('blur', release); };
  }, [state.visible]);

  if (!state.visible) return null;
  const ready = state.status === 'running' && !busy;
  return <section className="dos-workspace" aria-label="DOS workspace" onDrop={(event) => {
    event.preventDefault(); event.stopPropagation();
    void act(() => importFilesToDos(Array.from(event.dataTransfer.files)), 'Files imported.');
  }} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }}>
    <div className="dos-toolbar">
      <strong>{state.nativePascal ? 'Pascal / 32-bit DOS' : 'DOS workspace'}</strong>
      <button onClick={() => void closeDosSession()} disabled={busy}>Return to IDE</button>
      <button disabled={!ready} onClick={() => void act(syncDosFiles, 'DOS files saved to the browser drive.')}>Save files</button>
      <button disabled={!ready} onClick={() => input.current?.click()}>Import files / ZIP</button>
      <button disabled={state.status === 'loading' || busy} onClick={() => void act(async () => {
        const bytes = await exportDosFiles();
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/zip' }));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'DOS-WORKSPACE.zip'; anchor.click();
        setTimeout(() => { URL.revokeObjectURL(url); }, 1000);
      }, 'DOS files exported.')}>Export ZIP</button>
      <button disabled={!ready} onClick={() => void act(openDosDebugger, 'DEBUG: R registers, U disassembly, D memory, A assemble, T step, P step over, G run, Q quit.')}>CPU debugger</button>
      <button disabled={!ready} onClick={() => void act(() => openNativePascalSession(true))}>Run Pascal</button>
      <button disabled={!ready} onClick={() => void act(() => importFilesToDos(Object.entries(DOS_EXAMPLES).map(([name, data]) => new File([new Uint8Array(stringToBytes(data))], name))), 'Try HELLO, or DEBUG < X86TEST.SCR to assemble and trace REGTEST.COM.')}>Examples</button>
      {state.error && <button onClick={() => void discardDosSession()}>Discard DOS changes</button>}
      <input ref={input} type="file" multiple hidden aria-label="Import DOS files" onChange={(event) => {
        const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = '';
        void act(() => importFilesToDos(files), 'Files imported.');
      }} />
    </div>
    <div className="dos-display">
      <canvas ref={canvas} width={frameWidth || state.width} height={frameHeight || state.height} tabIndex={0} aria-label="DOS screen" onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        getDosMachine()?.sendMouseMotion((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
      }} onMouseDown={(event) => { canvas.current?.focus(); getDosMachine()?.sendMouseButton(event.button, true); }} onMouseUp={(event) => getDosMachine()?.sendMouseButton(event.button, false)} onContextMenu={(event) => { event.preventDefault(); }} />
      {state.status === 'loading' && <p className="dos-loading">Starting DOS...</p>}
    </div>
    <div className="dos-status" role="status">{state.error ?? (notice || 'EXIT or Ctrl+Alt+Esc returns to the IDE and saves files. Import your DOS programs to run them here.')}</div>
    <pre className="dos-transcript" aria-label="DOS output">{state.transcript}</pre>
  </section>;
}
