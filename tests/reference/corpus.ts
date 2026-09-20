import { languageCases } from './language-corpus';
import { switchCases } from './switch-corpus';
/** Portable TP-mode programs, checked against an independent Free Pascal run. */
export interface ReferenceCase {
  name: string;
  source: string;
  input?: string;
  output?: string[];
  reject?: true;
  units?: Record<string, string>;
}

export const curatedCases: ReferenceCase[] = [
  {
    name: 'constant-boolean-comparison-membership',
    source: `program T;
const A=True and not False; B=(2<3) and ('a'<'b'); C=4 in [1,3..5];
  D=(False xor True) or False;
begin WriteLn(A,',',B,',',C,',',D)end.`,
    output: ['TRUE,TRUE,TRUE,TRUE'],
  },
  {
    name: 'nested-lexical-scope-and-var-forwarding',
    source: `program T;
var x:Integer;
procedure Outer(var target:Integer);
var x:Integer;
procedure Inner(var alias:Integer); begin alias:=alias+x; x:=x+1 end;
begin x:=4;Inner(target);Inner(target);WriteLn(x) end;
begin x:=10;Outer(x);WriteLn(x)end.`,
    output: ['6', '19'],
  },
  {
    name: 'same-variable-var-aliases',
    source: `program T;var n:Integer;
procedure P(var a,b:Integer); begin a:=a+2;b:=b*3;WriteLn(a,',',b)end;
begin n:=5;P(n,n);WriteLn(n)end.`, output: ['21,21', '21'],
  },
  {
    name: 'array-value-snapshot-before-var-mutation',
    source: `program T;type Vec=array[1..3]of Integer;
var a:Vec;
procedure P(copy:Vec;var original:Vec);
begin original[2]:=9;copy[1]:=7;WriteLn(copy[1],',',copy[2],',',original[1],',',original[2])end;
begin a[1]:=1;a[2]:=2;a[3]:=3;P(a,a);WriteLn(a[1],',',a[2],',',a[3])end.`,
    output: ['7,2,1,9', '1,9,3'],
  },
  {
    name: 'recursive-local-preservation',
    source: `program T;
function F(n:Integer):Integer;
var saved,left:Integer;
begin saved:=n;if n<2 then F:=n else begin left:=F(n-1);F:=left+F(n-2)+saved end end;
begin WriteLn(F(7))end.`, output: ['79'],
  },
  {
    name: 'for-bound-evaluated-once',
    source: `program T;var calls,i,total:Integer;
function Limit:Integer;begin calls:=calls+1;Limit:=4 end;
begin calls:=0;total:=0;for i:=1 to Limit do total:=total+i;
WriteLn(calls,',',total)end.`, output: ['1,10'],
  },
  {
    name: 'repeat-continue-and-case-ranges',
    source: `program T;var i,total:Integer;
begin i:=0;total:=0;repeat i:=i+1;if i mod 2=0 then Continue;
case i of 1..3:total:=total+10;5:total:=total+20;else total:=total+30 end
until i=8;WriteLn(i,',',total)end.`, output: ['8,70'],
  },
  {
    name: 'enum-subranges-array-index-and-sets',
    source: `program T;type Day=(mon,tue,wed,thu,fri,sat,sun);Work=tue..fri;
Days=set of Day;var a:array[Day]of Integer;d:Work;s:Days;
begin s:=[tue..thu,sun];for d:=tue to fri do a[d]:=Ord(d)*3;
WriteLn(a[tue],',',a[fri],',',wed in s,',',fri in s)end.`,
    output: ['3,12,TRUE,FALSE'],
  },
  {
    name: 'short-string-truncation-and-var-char-alias',
    source: `program T;var s:String[4];
procedure P(var a,b:Char);begin a:=UpCase(a);b:=Chr(Ord(b)+1)end;
begin s:='abcdef';P(s[2],s[2]);WriteLn(s,',',Length(s))end.`, output: ['aCcd,4'],
  },
  {
    name: 'string-length-byte-retains-backing-characters',
    source: `program T;var s:String[3];begin s:='abc';s[0]:=#1;s[0]:=#3;WriteLn(s)end.`,
    output: ['abc'],
  },
  {
    name: 'with-record-precedence-and-value-copy',
    source: `program T;type Rec=record x,y:Integer end;var a,b:Rec;
begin a.x:=1;a.y:=2;b:=a;with a,b do begin x:=x+8;y:=a.x+y end;
WriteLn(a.x,',',a.y,',',b.x,',',b.y)end.`, output: ['1,2,9,3'],
  },
  {
    name: 'read-readln-token-and-line-boundary',
    source: `program T;var a,b:Integer;s:String;
begin Read(a,b);ReadLn(s);WriteLn(a,',',b,',',s);ReadLn(s);WriteLn(s)end.`,
    input: '12 -7 tail\nnext line\n', output: ['12,-7, tail', 'next line'],
  },
  {
    name: 'virtual-text-file-roundtrip',
    source: `program T;var f:Text;n:Integer;s:String;
begin Assign(f,'roundtrip.txt');Rewrite(f);WriteLn(f,42);WriteLn(f,'kept');Close(f);
Reset(f);ReadLn(f,n);ReadLn(f,s);WriteLn(n,',',s,',',Eof(f));Close(f);Erase(f)end.`,
    output: ['42,kept,TRUE'],
  },
  {
    name: 'exit-return-and-forward-function',
    source: `program T;
function Twice(x:Integer):Integer;forward;
function Choice(x:Integer):Integer;
begin Choice:=7;if x<0 then Exit;Choice:=Twice(x)end;
function Twice(x:Integer):Integer;begin Twice:=x*2 end;
begin WriteLn(Choice(-1),',',Choice(6))end.`, output: ['7,12'],
  },
];

export const rejectedCases: ReferenceCase[] = [
  ['distinct-enum-assignment', 'type A=(a1,a2);B=(b1,b2);var x:A;begin x:=b1 end.'],
  ['enum-integer-assignment', 'type A=(a1,a2);var x:A;begin x:=1 end.'],
  ['distinct-enum-comparison', 'type A=(a1,a2);B=(b1,b2);begin WriteLn(a1=b1)end.'],
  ['enum-arithmetic', 'type A=(a1,a2);var x:A;begin x:=a1;WriteLn(x+1)end.'],
  ['distinct-enum-array-index', 'type A=(a1,a2);B=(b1,b2);var x:array[A]of Integer;begin x[b1]:=4 end.'],
  ['distinct-enum-set-membership', 'type A=(a1,a2);B=(b1,b2);S=set of A;var x:S;begin x:=[a1];WriteLn(b1 in x)end.'],
  ['var-string-capacity-mismatch', "type S=String[3];var v:S;procedure P(var s:String);begin s:='abcdef'end;begin P(v)end."],
  ['constant-used-as-var-argument', 'const n=7;procedure P(var x:Integer);begin x:=8 end;begin P(n)end.'],
  ['overlapping-case-labels', 'var n:Integer;begin n:=2;case n of 1..3:WriteLn(1);3..5:WriteLn(2)end end.'],
].map(([name, body]) => ({ name: name!, source: `program T;${body}`, reject: true }));

/** Independent expected results use JS sorting/set operations, not Pascal VM code. */
export function generatedCases(count = 32): ReferenceCase[] {
  let seed = 0x5eed1234;
  const random = (limit: number) => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) % limit;
  };
  return Array.from({ length: count }, (_, caseIndex) => {
    const values = Array.from({ length: 6 }, () => random(61) - 30);
    const left = [...new Set(Array.from({ length: 9 }, () => random(64)))];
    const right = [...new Set(Array.from({ length: 9 }, () => random(64)))];
    const dividend = random(2001) - 1000, divisor = random(13) + 1;
    const quotient = Math.trunc(dividend / divisor), remainder = dividend - quotient * divisor;
    const union = [...new Set([...left, ...right])];
    const intersection = left.filter(value => right.includes(value));
    const difference = left.filter(value => !right.includes(value));
    const sorted = [...values].sort((a, b) => a - b);
    return {
      name: `generated-sort-sets-arithmetic-${String(caseIndex + 1).padStart(2, '0')}`,
      source: `program Corpus;type Vec=array[-2..3]of Integer;SmallSet=set of 0..63;
var a:Vec;i,j,key,sum,u,v,w:Integer;s,t:SmallSet;
begin ${values.map((value, index) => `a[${index - 2}]:=${value};`).join('')}
for i:=-1 to 3 do begin key:=a[i];j:=i-1;
while j>=-2 do begin if a[j]<=key then Break;a[j+1]:=a[j];j:=j-1 end;a[j+1]:=key end;
WriteLn(a[-2],',',a[-1],',',a[0],',',a[1],',',a[2],',',a[3]);
sum:=0;for i:=-2 to 3 do sum:=sum+a[i]*a[i];WriteLn(sum);
s:=[${left.join(',')}];t:=[${right.join(',')}];u:=0;v:=0;w:=0;
for i:=0 to 63 do begin if i in (s+t)then u:=u+1;if i in (s*t)then v:=v+1;if i in (s-t)then w:=w+1 end;
WriteLn(u,',',v,',',w);i:=${dividend};j:=${divisor};WriteLn(i div j,',',i mod j)end.`,
      output: [sorted.join(','), String(values.reduce((sum, value) => sum + value * value, 0)),
        `${union.length},${intersection.length},${difference.length}`, `${quotient},${remainder}`],
    };
  });
}

export const referenceCases = [...curatedCases, ...rejectedCases, ...generatedCases(), ...languageCases, ...switchCases];
