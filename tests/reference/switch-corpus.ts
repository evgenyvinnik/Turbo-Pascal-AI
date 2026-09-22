import type { ReferenceCase } from './corpus';

export const switchCases: ReferenceCase[] = [
  { name: 'switch-boolean-short-circuit-default', source: `program P;var n:Integer;b:Boolean;
function Touch:Boolean;begin Inc(n);Touch:=True end;
begin n:=0;b:=False and Touch;b:=True or Touch;WriteLn(n,',',b)end.`, output: ['0,TRUE'] },
  { name: 'switch-boolean-full-evaluation-and-lexical-override', source: `{$B+}program P;var n:Integer;b:Boolean;
function Touch:Boolean;begin Inc(n);Touch:=True end;
begin n:=0;b:=False and Touch;b:=True or Touch;WriteLn(n);{$B-}b:=False and Touch;WriteLn(n)end.`, output: ['2', '2'] },
  { name: 'switch-boolean-keeps-integer-bitwise-eager', source: `program P;var n,x:Integer;
function Touch:Integer;begin Inc(n);Touch:=7 end;
begin n:=0;x:=0 and Touch;WriteLn(n,',',x);x:=3 or Touch;WriteLn(n,',',x)end.`, output: ['1,0', '2,7'] },
  { name: 'switch-range-disabled-storage-widths', source: `{$R-}program P;var b:Byte;s:ShortInt;w:Word;i:Integer;n:LongInt;
begin n:=258;b:=n;n:=130;s:=n;n:=-1;w:=n;n:=65535;i:=n;WriteLn(b,',',s,',',w,',',i)end.`, output: ['2,-126,65535,-1'] },
  { name: 'switch-range-disabled-subrange', source: `{$R-}program P;type Small=1..9;var s:Small;i:Integer;
begin i:=10;s:=i;WriteLn(s)end.`, output: ['10'] },
  { name: 'switch-var-strings-relaxed', source: `{$V-}program P;var s:string[5];
procedure Change(var t:string);begin t:='ok'end;
begin s:='a';Change(s);WriteLn(s)end.`, output: ['ok'] },
  { name: 'switch-var-strings-strict', source: `{$V+}program P;var s:string[5];
procedure Change(var t:string);begin t:='ok'end;
begin Change(s)end.`, reject: true },
  { name: 'switch-open-strings-var-capacity', source: `{$P+}program P;var s:string[5];
procedure Change(var t:string);begin WriteLn(High(t),',',SizeOf(t),',',Length(t));t:='123456789';WriteLn(t)end;
begin s:='a';Change(s);WriteLn(s)end.`, output: ['5,6,1','12345','12345'] },
  { name: 'switch-open-strings-forwarded-capacity', source: `{$P+}program P;var s:string[3];
procedure Inner(var t:string);begin WriteLn(High(t));t:='abcdef'end;
procedure Outer(var t:string);begin Inner(t);WriteLn(High(t))end;
begin s:='a';Outer(s);WriteLn(s)end.`, output: ['3','3','abc'] },
  { name: 'switch-open-strings-value-copy', source: `{$P+}program P;var s:string[4];
procedure CopyOf(t:string);begin WriteLn(High(t),',',SizeOf(t));t:='123456';WriteLn(t)end;
begin s:='xy';CopyOf(s);WriteLn(s)end.`, output: ['255,256','123456','xy'] },
  { name: 'switch-open-strings-value-literal-and-character', source: `{$P+}program P;
procedure CopyOf(t:string);begin WriteLn(High(t),',',SizeOf(t),',',t);t:='changed';WriteLn(t)end;
begin CopyOf('abc');CopyOf('x')end.`, output: ['255,256,abc','changed','255,256,x','changed'] },
  { name: 'switch-open-strings-procedural-signature', source: `{$P+}{$F+}program P;
type Callback=procedure(var s:string);var cb:Callback;s:string[3];
procedure Change(var t:string);begin WriteLn(High(t));t:='abcdef'end;
begin cb:=Change;s:='a';cb(s);WriteLn(s)end.`, output: ['3','abc'] },
  { name: 'switch-openstring-explicit-independent-of-p', source: `{$P-}program P;var s:string[4];
procedure Change(var t:OpenString);begin WriteLn(High(t),',',SizeOf(t));t:='abcdef'end;
begin s:='a';Change(s);WriteLn(s)end.`, output: ['4,5','abcd'] },
  { name: 'switch-var-string-type-alias-keeps-declared-capacity', source: `{$P+}program P;type Text5=string[5];var s:Text5;
procedure Change(var t:Text5);begin WriteLn(High(t),',',SizeOf(t));t:='abcdef'end;
begin s:='a';Change(s);WriteLn(s)end.`, output: ['5,6','abcde'] },
  { name: 'switch-openstring-value-is-ordinary-string', source: `{$P+}program P;
procedure CopyOf(t:OpenString);begin WriteLn(High(t),',',SizeOf(t),',',t)end;
begin CopyOf('abc')end.`, output: ['255,256,abc'] },
  { name: 'switch-openstring-user-type-shadows-system-identifier', source: `program P;type OpenString=Integer;var n:Integer;
procedure Change(var value:OpenString);begin Inc(value)end;
begin n:=3;Change(n);WriteLn(n)end.`, output: ['4'] },
  { name: 'switch-open-string-alias-retains-declaration-mode', source: `{$P+}{$V+}program P;type Wide=string[255];{$P-}var s:string[3];
procedure Change(var t:Wide);begin WriteLn(High(t),',',SizeOf(t));t:='abcdef'end;
begin s:='a';Change(s);WriteLn(s)end.`, output: ['3,4','abc'] },
  { name: 'switch-closed-string-alias-retains-declaration-mode', source: `{$P-}{$V+}program P;type Wide=string;{$P+}var s:string[3];
procedure Change(var t:Wide);begin t:='a'end;
begin Change(s)end.`, reject: true },
  { name: 'switch-extended-syntax-discards-function-results', source: `program P;var n:Integer;
type Counter=function:Integer;
{$F+}function Bump:Integer;begin Inc(n);Bump:=n end;{$F-}
function Name:string;begin Inc(n);Name:='x' end;
var c:Counter;
begin n:=0;Bump;Bump;Name;c:=Bump;c;WriteLn(n)end.`, output: ['4'] },
  { name: 'switch-extended-syntax-off-requires-results', source: `{$X-}program P;
function F:Integer;begin F:=1 end;begin F end.`, reject: true },
  { name: 'switch-extended-syntax-excludes-system-functions', source: `program P;var s:string;
begin s:='abc';Length(s)end.`, reject: true },
];
