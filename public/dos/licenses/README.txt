Local DOS runtime distribution
==============================

emulators 8.4.2 / DOSBox
License: GNU GPL version 2 (see emulators-GPL-2.0.txt).
Upstream source and build instructions: https://github.com/js-dos/emulators
DOSBox source: https://github.com/js-dos/dosbox
Pinned npm distribution: https://www.npmjs.com/package/emulators/v/8.4.2
The npm package is installed by the project lockfile. The Vite plugin serves or
copies its unmodified emulators.js, wdosbox.js/wasm and wlibzip.js/wasm files.

FreeDOS Debug/X 2.51
License: MIT; Paul Vojta copyright and full terms in debug-MIT.txt.
Japheth's extensions are public domain as stated in src/DEBUG.ASM.
Upstream: https://github.com/Baron-von-Riedesel/DOS-debug
Original distribution:
https://ibiblio.org/pub/micro/pc-stuff/freedos/files/repositories/latest/base/debug/20250621.0/debug.zip
The unmodified DEBUG.COM and DEBUG.TXT are in ../tools/.
The corresponding original source is included as debug-2.51-source.zip.

HELLO.COM, HELLO.ASM and X86TEST.SCR are original examples maintained as source
in src/services/dos/fixtures.ts. They contain no Borland executable code.

No original Turbo Pascal installation, DOS operating-system disk image or
other proprietary tool is included. Imported files remain local to this app.

Free Pascal 3.2.2 native DOS compiler
==================================
Official release: https://www.freepascal.org/down/i386/go32v2-hungary.var
The local fpc-3.2.2-dos.zip contains the unmodified PPC386 compiler, RTL units,
GNU assembler/linker, CWSDPMI and DebugX selected from these distributions:
https://downloads.freepascal.org/fpc/dist/3.2.2/i386-go32v2/separate/basedos.zip
https://downloads.freepascal.org/fpc/dist/3.2.2/i386-go32v2/separate/aslddos.zip
Their original license notices are in the bundle's __TPTOOLS/LICENSES directory.
Compiler source: fpc-3.2.2-compiler-source.zip in this directory.
Runtime library source: fpc-3.2.2-rtl-source.zip in this directory.
Compiler GPL and RTL modified LGPL licensing is described by Free Pascal at
https://www.freepascal.org/faq.html#general-license

The selected files and download checksums are reproducible with
bun scripts/prepare-native-dos.ts from the project root.
The compiler is a 32-bit GO32v2/DPMI compiler with Turbo Pascal language mode.
It does not produce original Borland 16-bit executables or TPU files.
