import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandInterface } from 'emulators';
import type { DosFiles } from '../../src/services/dos/dosFiles';
import { DOS_EXIT_SIGNAL } from '../../src/services/dos/dosRuntime';

/** A stand-in for the js-dos emulator, driven by the test instead of DOSBox. */
interface FakeDos {
  ci: CommandInterface;
  /** What DOS sees on drive C:, starting with what the session copied in. */
  drive: DosFiles;
  /** Real DOSBox never answers a drive read once DOS itself has stopped. */
  readable: boolean;
  width: number;
  height: number;
  exit: Mock<() => Promise<void>>;
  stdout: (text: string) => void;
  frame: (rgb: Uint8Array | null, rgba: Uint8Array | null) => void;
  frameSize: (width: number, height: number) => void;
  unload: () => Promise<void>;
  exited: () => void;
}

const emulator = vi.hoisted(() => ({
  machines: [] as FakeDos[],
  reads: 0,
  /** Holds startup open, to close a session while it is still starting. */
  starting: null as Promise<void> | null,
}));

function fakeDos(files: DosFiles): FakeDos {
  const on: Record<string, (...args: never[]) => unknown> = {};
  const fake: FakeDos = {
    drive: { ...files },
    readable: true,
    width: 640,
    height: 400,
    exit: vi.fn(() => Promise.resolve()),
    ci: {
      events: () =>
        new Proxy(
          {},
          {
            get: (_target, name: string) => (handler: (...args: never[]) => unknown) => {
              on[name] = handler;
            },
          }
        ),
      width: () => fake.width,
      height: () => fake.height,
      screenshot: () => Promise.reject(new Error('No frame yet.')),
      exit: () => fake.exit(),
    } as unknown as CommandInterface,
    stdout: (text) => {
      on.onStdout!(text as never);
    },
    frame: (rgb, rgba) => {
      on.onFrame!(rgb as never, rgba as never);
    },
    frameSize: (width, height) => {
      on.onFrameSize!(width as never, height as never);
    },
    unload: () => on.onUnload!() as Promise<void>,
    exited: () => {
      on.onExit!();
    },
  };
  return fake;
}

vi.mock('../../src/services/dos/dosRuntime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/dos/dosRuntime')>()),
  startDosRuntime: async (files: DosFiles) => {
    await emulator.starting;
    const fake = fakeDos(files);
    emulator.machines.push(fake);
    return fake.ci;
  },
  readDosFiles: (ci: CommandInterface) => {
    const fake = emulator.machines.find((machine) => machine.ci === ci)!;
    emulator.reads += 1;
    return fake.readable ? Promise.resolve({ ...fake.drive }) : new Promise<never>(() => undefined);
  },
  typeDosCommand: () => Promise.resolve(),
}));

const DISK_KEY = 'turbo-pascal.virtual-disk.v1';

/** Fresh modules over a browser drive holding `disk`, as a page load would see. */
async function load(disk: DosFiles = {}) {
  vi.resetModules();
  const stored = new Map([[DISK_KEY, JSON.stringify(disk)]]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      stored.set(key, value);
    },
  });
  const session = await import('../../src/services/dos/dosSession');
  const files = await import('../../src/components/IDE/programFiles');
  const state = () => session.useDosStore.getState();
  const saved = () => JSON.parse(stored.get(DISK_KEY) ?? '{}') as DosFiles;
  return { session, files, state, saved };
}

async function launch(disk: DosFiles = {}) {
  const loaded = await load(disk);
  await loaded.session.openDosSession();
  return { ...loaded, dos: emulator.machines.at(-1)! };
}

afterEach(() => {
  vi.unstubAllGlobals();
  emulator.machines.length = 0;
  emulator.reads = 0;
  emulator.starting = null;
});

describe('leaving the DOS workspace', () => {
  it('EXIT saves the files DOS changed, then shuts the emulator down', async () => {
    const { dos, files, state, saved } = await launch({ 'NOTES.TXT': 'old' });
    dos.drive['NOTES.TXT'] = 'new';
    dos.drive['MADE.DAT'] = '\0ÿ';
    dos.stdout('C:\\>exit\r\n');
    dos.stdout(`${DOS_EXIT_SIGNAL}\r\n`);
    await vi.waitFor(() => {
      expect(state().visible).toBe(false);
    });
    expect(files.programDisk.snapshot()).toEqual({ 'NOTES.TXT': 'new', 'MADE.DAT': '\0ÿ' });
    expect(saved()).toEqual({ 'NOTES.TXT': 'new', 'MADE.DAT': '\0ÿ' });
    expect(dos.exit).toHaveBeenCalledOnce();
  });

  it('recognises the exit signal when its output arrives split', async () => {
    const { dos, state } = await launch();
    dos.stdout(DOS_EXIT_SIGNAL.slice(0, 9));
    expect(state().visible).toBe(true);
    dos.stdout(`${DOS_EXIT_SIGNAL.slice(9)}\r\n`);
    await vi.waitFor(() => {
      expect(state().visible).toBe(false);
    });
  });

  it('keeps the exit signal out of the transcript the user reads', async () => {
    const { dos, state } = await launch();
    dos.stdout('Hello from DOS\r\n');
    dos.stdout(`${DOS_EXIT_SIGNAL}\r\n`);
    expect(state().transcript).toContain('Hello from DOS');
    expect(state().transcript).not.toContain(DOS_EXIT_SIGNAL);
  });

  it('only the exit signal leaves: output that mentions EXIT does not', async () => {
    const { dos, state } = await launch();
    dos.stdout('DOS workspace. Type EXIT to return to the IDE.\r\n');
    // The shell echoes a typed EXIT before the child shell ends; the signal follows.
    dos.stdout('C:\\>exit\r\n');
    expect(state().visible).toBe(true);
    expect(emulator.reads).toBe(0);
  });

  it('a failed save keeps the workspace open with the reason, and DOS running', async () => {
    const { dos, files, state } = await launch({ 'A.TXT': 'a' });
    files.writeVirtualFile('A.TXT', 'browser');
    dos.drive['A.TXT'] = 'dos';
    dos.stdout(`${DOS_EXIT_SIGNAL}\r\n`);
    await vi.waitFor(() => {
      expect(state().status).toBe('error');
    });
    expect(state().visible).toBe(true);
    expect(state().error).toMatch(/both DOS and the browser/);
    expect(files.programDisk.read('A.TXT')).toBe('browser');
    expect(dos.exit).not.toHaveBeenCalled();
  });

  it('leaving twice, or an emulator exit after leaving, saves and shuts down once', async () => {
    const { dos, state } = await launch();
    dos.stdout(`${DOS_EXIT_SIGNAL}\r\n${DOS_EXIT_SIGNAL}\r\n`);
    dos.stdout(`${DOS_EXIT_SIGNAL}\r\n`);
    await vi.waitFor(() => {
      expect(state().visible).toBe(false);
    });
    dos.exited();
    await dos.unload();
    expect(emulator.reads).toBe(1);
    expect(dos.exit).toHaveBeenCalledOnce();
  });

  it('DOS unloading on its own saves the files and returns to the IDE', async () => {
    const { dos, files, state } = await launch();
    dos.drive['LOG.TXT'] = 'written before unload';
    await dos.unload();
    expect(state().visible).toBe(false);
    expect(files.programDisk.read('LOG.TXT')).toBe('written before unload');
  });

  it('a session closed while starting never adopts its emulator', async () => {
    const { session, state } = await load();
    let started!: () => void;
    emulator.starting = new Promise((resolve) => {
      started = resolve;
    });
    const opening = session.openDosSession();
    await session.discardDosSession();
    started();
    await opening;
    expect(emulator.machines[0]!.exit).toHaveBeenCalledOnce();
    expect(session.getDosMachine()).toBeNull();
    expect(state().visible).toBe(false);
  });
});

describe('DOS screen frames', () => {
  const rgba = (width: number, height: number) => new Uint8Array(width * height * 4).fill(7);
  const paintable = (frame: Uint8ClampedArray | null, width: number, height: number) =>
    frame !== null && frame.length === width * height * 4;

  it('a mode change alone leaves the last frame paintable at its own size', async () => {
    const { dos, state } = await launch();
    dos.frame(null, rgba(640, 400));
    dos.frameSize(320, 200);
    const { frame, frameWidth, frameHeight, width } = state();
    expect(width).toBe(320);
    expect([frameWidth, frameHeight]).toEqual([640, 400]);
    expect(paintable(frame, frameWidth, frameHeight)).toBe(true);
  });

  it('a stale frame from the previous mode is cropped or padded to the current one', async () => {
    const { dos, state } = await launch();
    dos.width = 320;
    dos.height = 200;
    dos.frame(null, rgba(640, 400));
    expect(paintable(state().frame, 320, 200)).toBe(true);
    dos.width = 800;
    dos.height = 600;
    dos.frame(null, rgba(320, 200));
    expect(paintable(state().frame, 800, 600)).toBe(true);
    expect([state().frameWidth, state().frameHeight]).toEqual([800, 600]);
  });

  it('RGB frames become opaque RGBA', async () => {
    const { dos, state } = await launch();
    dos.width = 2;
    dos.height = 1;
    dos.frame(new Uint8Array([1, 2, 3, 4, 5, 6]), null);
    expect(Array.from(state().frame!)).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
  });
});
