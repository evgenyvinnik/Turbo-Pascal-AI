import type { ReferenceCase } from './corpus';

/** Programs Turbo Pascal rejects while compiling, which the browser compiler
 * must reject too rather than leave to run time. Free Pascal only works out
 * constant ranges under {$R+}, so those cases set it; Turbo Pascal rejects
 * them either way, which the unit tests cover. */
export const diagnosticCases: ReferenceCase[] = [
  {
    name: 'reject-case-label-of-another-type',
    source: `program T; var c: Char; begin case c of 1: ; #2: ; end end.`,
    reject: true,
  },
  {
    name: 'reject-for-counter-from-another-block',
    source: `program T;
procedure Outer; var x: Byte;
  procedure Inner; begin for x := 1 to 3 do WriteLn(x) end;
begin Inner end;
begin Outer end.`,
    reject: true,
  },
  {
    name: 'reject-constructor-outside-an-object',
    source: `program T; destructor Done; begin end; begin end.`,
    reject: true,
  },
  {
    name: 'reject-method-of-an-unknown-object',
    source: `program T; procedure Missing.Method; begin end; begin end.`,
    reject: true,
  },
  {
    name: 'reject-object-field-after-a-method',
    source: `program T;
type Thing = object F: LongInt; procedure P; G: LongInt end;
procedure Thing.P; begin end;
begin end.`,
    reject: true,
  },
  {
    name: 'reject-constant-that-cannot-fit',
    source: `{$R+} program T; var b: Byte; begin b := 256 end.`,
    reject: true,
  },
  {
    name: 'reject-constant-string-index-no-string-has',
    source: `{$R+} program T; var s: string; c: Char; begin s := ''; c := s[257] end.`,
    reject: true,
  },
  {
    name: 'reject-goto-a-label-that-is-never-set',
    source: `program T; label done; begin goto done end.`,
    reject: true,
  },
  {
    name: 'reject-goto-out-of-a-routine',
    source: `program T; label done;
procedure P; begin goto done end;
begin P; done: WriteLn('here') end.`,
    reject: true,
  },
  {
    name: 'empty-case-branches-still-check-their-labels',
    source: `program T; var c: Char;
begin c := 'b'; case c of 'a': ; 'b': WriteLn('two'); else WriteLn('other') end end.`,
    output: ['two'],
  },
];
