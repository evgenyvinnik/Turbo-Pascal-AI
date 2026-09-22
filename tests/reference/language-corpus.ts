import type { ReferenceCase } from './corpus';

/** Language extension fixtures also run against FPC -Mtp; unit files are real inputs. */
export const languageCases: ReferenceCase[] = [
  { name: 'unit-interface-private-state-and-qualified-names',
    units: { Counter: `unit Counter; interface var Value:Integer;
      procedure Bump; function Twice(x:Integer):Integer;
      implementation var Secret:Integer;
      procedure Bump;begin Inc(Value)end;
      function Twice;begin Twice:=x*2+Secret end;
      begin Value:=7;Secret:=1 end.` },
    source: `program Corpus;uses Counter;begin WriteLn(Counter.Value,':',Twice(3));Counter.Bump;WriteLn(Value)end.`, output: ['7:7','8'] },
  { name: 'unit-diamond-initialization-once-in-dependency-order',
    units: {
      Shared: `unit Shared;interface var Count:Integer;procedure Bump;implementation procedure Bump;begin Inc(Count)end;begin Count:=1;WriteLn('shared')end.`,
      Left: `unit Left;interface uses Shared;procedure L;implementation procedure L;begin Bump end;begin Bump;WriteLn('left')end.`,
      Right: `unit Right;interface uses Shared;procedure R;implementation procedure R;begin Bump end;begin Bump;WriteLn('right')end.`,
    }, source: `program Corpus;uses Left,Right,Shared;begin L;R;WriteLn(Count)end.`, output: ['shared','left','right','5'] },
  { name: 'unit-name-collision-last-used-and-explicit-qualification',
    units: { First: `unit First;interface const N=1;implementation end.`, Second: `unit Second;interface const N=2;implementation end.` },
    source: `program Corpus;uses First,Second;var Local:Integer;begin Local:=N;WriteLn(Local,',',First.N,',',Second.N)end.`, output:['2,1,2'] },
  { name:'unit-exported-types-and-variable-aliasing', units: { Values: `unit Values;interface type Vector=array[1..2]of Integer;var Data:Vector;procedure Change(var v:Vector);implementation procedure Change;begin Inc(v[1]);v[2]:=v[1]*2 end;begin Data[1]:=3 end.` },
    source:`program Corpus;uses Values;var copy:Values.Vector;begin Change(Values.Data);copy:=Data;copy[1]:=99;WriteLn(Data[1],',',copy[2])end.`,output:['4,8'] },
  { name:'unit-implementation-dependency-cycle', units:{ Alpha:`unit Alpha;interface procedure A;implementation uses Beta;procedure A;begin WriteLn(B)end;end.`, Beta:`unit Beta;interface function B:Integer;implementation uses Alpha;function B;begin B:=7 end;end.` }, source:`program Corpus;uses Alpha;begin A end.`,output:['7'] },
  { name:'object-fields-inherited-constructor-and-virtual-dispatch', source:`program Corpus;
    type TBase=object Value:Integer;constructor Init(n:Integer);function Get:Integer;virtual;procedure Bump;end;
    TChild=object(TBase) Extra:Integer;constructor Init(n:Integer);function Get:Integer;virtual;end;PB=^TBase;
    var b:TBase;c:TChild;p:PB;
    constructor TBase.Init(n:Integer);begin Value:=n end;
    function TBase.Get:Integer;begin Get:=Value end;
    procedure TBase.Bump;begin Inc(Value);WriteLn(Get)end;
    constructor TChild.Init(n:Integer);begin inherited Init(n);Extra:=10 end;
    function TChild.Get:Integer;begin Get:=Value+Extra end;
    begin b.Init(2);c.Init(5);p:=@c;WriteLn(b.Get,':',c.Get,':',p^.Get);p^.Bump;WriteLn(c.Value)end.`,output:['2:15:15','16','6'] },
  { name:'object-new-dispose-and-inherited-function',source:`program Corpus;
    type TBase=object n:Integer;constructor Init(v:Integer);function Get:Integer;virtual;destructor Done;virtual;end;
    TChild=object(TBase) function Get:Integer;virtual;end;PChild=^TChild;
    var p:PChild;
    constructor TBase.Init(v:Integer);begin n:=v end;
    function TBase.Get:Integer;begin Get:=n end;
    destructor TBase.Done;begin WriteLn('done:',Get)end;
    function TChild.Get:Integer;begin Get:=inherited Get+10 end;
    begin New(p,Init(4));WriteLn(p^.Get);Dispose(p,Done);p:=New(PChild,Init(7));WriteLn(p^.Get);Dispose(p,Done)end.`,output:['14','done:14','17','done:17'] },
  { name:'object-method-parameters-and-nested-self',source:`program Corpus;
    type TItem=object value:Integer;procedure SetValue(newValue:Integer);function Sum(n:Integer):Integer;end;
    var item:TItem;
    procedure TItem.SetValue(newValue:Integer);procedure AssignIt;begin Self.value:=newValue end;begin AssignIt end;
    function TItem.Sum(n:Integer):Integer;begin if n=0 then Sum:=value else Sum:=value+Sum(n-1)end;
    begin item.SetValue(3);WriteLn(item.Sum(4))end.`,output:['15'] },
  { name:'object-value-copy-and-base-var-virtual-dispatch',source:`program Corpus;
    type TBase=object value:Integer;constructor Init(n:Integer);function Get:Integer;virtual;end;
    TChild=object(TBase)function Get:Integer;virtual;end;
    var a,b:TChild;
    constructor TBase.Init(n:Integer);begin value:=n end;
    function TBase.Get:Integer;begin Get:=value end;
    function TChild.Get:Integer;begin Get:=value*2 end;
    procedure Change(var item:TBase);begin Inc(item.value);WriteLn(item.Get)end;
    begin a.Init(4);b.Init(0);b:=a;Change(a);WriteLn(a.Get,',',b.Get)end.`,output:['10','10,8'] },
  { name:'unit-exported-object-private-method-implementation',units:{Items:`unit Items;interface type TItem=object Value:Integer;constructor Init(n:Integer);function Get:Integer;end;implementation const Offset=5;constructor TItem.Init(n:Integer);begin Value:=n end;function TItem.Get:Integer;begin Get:=Value+Offset end;end.`}, source:`program Corpus;uses Items;var item:Items.TItem;begin item.Init(3);WriteLn(item.Get)end.`,output:['8'] },
  { name:'reject-unit-private-export',units:{Hidden:`unit Hidden;interface procedure PublicProc;implementation var Secret:Integer;procedure PublicProc;begin Secret:=1 end;end.`},source:`program Corpus;uses Hidden;begin WriteLn(Hidden.Secret)end.`,reject:true },
  { name:'reject-transitive-unit-identifier',units:{InnerUnit:`unit InnerUnit;interface const HiddenValue=3;implementation end.`,OuterUnit:`unit OuterUnit;interface uses InnerUnit;const VisibleValue=1;implementation end.`},source:`program Corpus;uses OuterUnit;begin WriteLn(HiddenValue)end.`,reject:true },
  { name:'reject-object-virtual-signature-mismatch',source:`program Corpus;type TBase=object procedure Run(n:Integer);virtual;end;TChild=object(TBase)procedure Run(n:Char);virtual;end;begin end.`,reject:true },
  { name:'reject-object-unrelated-pointer-assignment',source:`program Corpus;type TA=object x:Integer;end;TB=object x:Integer;end;PA=^TA;PB=^TB;var a:PA;b:PB;begin a:=b end.`,reject:true },
  { name:'reject-object-unimplemented-method',source:`program Corpus;type TItem=object procedure Run;end;var item:TItem;begin item.Run end.`,reject:true },
  { name:'object-constructor-fail-boolean-and-new-cleanup',source:`program Corpus;
    type TBase=object constructor Init(ok:Boolean);end;
    TChild=object(TBase)constructor Init(ok:Boolean);end;PChild=^TChild;
    var p:PChild;x:TChild;
    constructor TBase.Init(ok:Boolean);begin if not ok then Fail;WriteLn('base')end;
    constructor TChild.Init(ok:Boolean);begin if not inherited Init(ok) then Fail;WriteLn('child')end;
    begin New(p,Init(False));WriteLn(p=nil);WriteLn(x.Init(False));
      p:=New(PChild,Init(True));WriteLn(p=nil);Dispose(p)end.`,output:['TRUE','FALSE','base','child','FALSE'] },
  { name:'object-qualified-ancestor-call',source:`program Corpus;
    type TBase=object constructor Init;function Get:Integer;virtual;end;
    TChild=object(TBase)function Get:Integer;virtual;end;var item:TChild;
    constructor TBase.Init;begin end;function TBase.Get:Integer;begin Get:=3 end;
    function TChild.Get:Integer;begin Get:=TBase.Get+4 end;
    begin item.Init;WriteLn(item.Get)end.`,output:['7'] },
  { name:'procedural-variables-callback-params-and-structured-calls',source:`program Corpus;
    type TProc=procedure(var n:Integer);TFunc=function(n:Integer):Integer;TZero=function:Integer;
    Table=array[1..2]of TFunc;Holder=record Run:TProc end;
    var p:TProc;f:TFunc;z:TZero;list:Table;h:Holder;n:Integer;
    procedure Bump(var n:Integer);far;begin Inc(n)end;
    function Twice(n:Integer):Integer;far;begin Twice:=n*2 end;
    function Triple(n:Integer):Integer;far;begin Triple:=n*3 end;
    function Seven:Integer;far;begin Seven:=7 end;
    function Apply(fn:TFunc;n:Integer):Integer;begin Apply:=fn(n)+fn(n+1)end;
    procedure Replace(var fn:TFunc);begin fn:=Triple end;
    begin n:=3;p:=Bump;p(n);f:=Twice;WriteLn(n,':',f(5),':',Apply(f,2));Replace(f);WriteLn(f(5));
      list[1]:=Twice;list[2]:=Triple;WriteLn(list[1](4),',',list[2](4));h.Run:=p;h.Run(n);WriteLn(n);
      z:=Seven;WriteLn(z+1);p:=nil;WriteLn(Assigned(p))end.`,output:['4:10:10','15','8,12','5','8','FALSE'] },
  { name:'unit-exported-routine-as-callback',units:{Callbacks:`unit Callbacks;interface procedure Bump(var n:Integer);implementation procedure Bump;begin Inc(n)end;end.`},
    source:`program Corpus;uses Callbacks;type TProc=procedure(var n:Integer);var callback:TProc;n:Integer;
      begin n:=4;callback:=Callbacks.Bump;callback(n);WriteLn(n)end.`,output:['5'] },
  { name:'procedural-selection-evaluated-once',source:`program Corpus;{$F+}
    type TProc=procedure;Table=array[1..2]of TProc;var calls:Integer;list:Table;
    procedure One;begin WriteLn('one')end;procedure Two;begin WriteLn('two')end;
    function Select:Integer;begin Inc(calls);Select:=2 end;
    begin calls:=0;list[1]:=One;list[2]:=Two;list[Select]();WriteLn(calls)end.`,output:['two','1'] },
  { name:'reject-procedural-signature-mismatch',source:`program Corpus;type TProc=procedure(n:Integer);var callback:TProc;
    procedure Bad(n:Char);far;begin end;begin callback:=Bad end.`,reject:true },
  { name:'reject-nested-procedural-value',source:`program Corpus;type TProc=procedure;var callback:TProc;
    procedure Outer;procedure Inner;far;begin end;begin callback:=Inner end;begin Outer end.`,reject:true },
  // The program heading is optional in Turbo Pascal.
  { name:'program-without-heading',source:`var i:Integer;begin for i:=1 to 3 do Write(i);WriteLn end.`,output:['123'] },
  { name:'program-without-heading-declarations-first',source:`const N=2;type T=array[1..N]of Integer;var a:T;
    procedure Show;begin WriteLn(a[1]+a[2])end;begin a[1]:=20;a[2]:=22;Show end.`,output:['42'] },
  { name:'program-without-heading-empty',source:`begin end.`,output:[] },
  { name:'program-without-heading-uses-first',units:{Helper:`unit Helper;interface function Twice(n:Integer):Integer;
    implementation function Twice(n:Integer):Integer;begin Twice:=n*2 end;end.`},
    source:`uses Helper;begin WriteLn(Twice(21))end.`,output:['42'] },
  { name:'program-heading-with-parameters',source:`program P(input,output);begin WriteLn('still fine')end.`,output:['still fine'] },
];
