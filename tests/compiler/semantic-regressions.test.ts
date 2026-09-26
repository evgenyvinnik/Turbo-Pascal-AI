import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler/codegen/Compiler';
import { Parser, Lexer, Stream } from '../../src/compiler';
import { Machine, MachineState } from '../../src/compiler/runtime/Machine';

const compile = (source: string) =>
  new Compiler().compile(new Parser(new Lexer(new Stream(source))).parse());
function execute(source: string, input: string[] = []): string[] {
  const machine = new Machine(compile(source), { maxInstructions: 100_000 });
  machine.setInput(input);
  machine.run();
  expect(machine.getState()).toBe(MachineState.STOPPED);
  return machine.getOutput();
}

describe('Pascal semantic interactions', () => {
  it('keeps nested value records independent while VAR fields alias the original record', () => {
    expect(
      execute(`program ValuesAndAliases;
      type Row=array[1..3]of Integer; Item=record values:Row;tag:String[3]end;
      var original:Item;
      procedure Change(value:Item;var target:Item;var alias:Integer);
      begin value.values[1]:=99;target.values[2]:=value.values[1]+value.values[2];
        alias:=alias+1;value.tag:='new' end;
      begin original.values[1]:=1;original.values[2]:=2;original.values[3]:=3;original.tag:='old';
        Change(original,original,original.values[2]);
        WriteLn(original.values[1],',',original.values[2],',',original.values[3],',',original.tag)
      end.`)
    ).toEqual(['1,102,3,old']);
  });

  it('resolves three lexical levels independently inside recursive activations', () => {
    expect(
      execute(`program StaticLinks;
      function Outer(seed:Integer):Integer;
      var acc:Integer;
        function Recur(depth:Integer):Integer;
        var saved:Integer;
          procedure Bump(var cell:Integer);
          begin cell:=cell+seed;acc:=acc+1 end;
        begin saved:=acc;if depth=0 then Recur:=saved
          else begin Bump(saved);Recur:=saved+Recur(depth-1)end end;
      begin acc:=1;Outer:=Recur(3)+acc end;
      begin WriteLn(Outer(5),',',Outer(2))end.`)
    ).toEqual(['29,20']);
  });

  it('evaluates each character address once and preserves pointer and VAR aliases', () => {
    expect(
      execute(`program CharacterAliases;
      type CharacterPointer=^Char;
      var s:String[5];p:CharacterPointer;calls:Integer;
      function NextIndex:Integer;begin Inc(calls);NextIndex:=2 end;
      procedure Change(var left,right:Char);
      begin left:='X';right:=Succ(left)end;
      begin s:='abcde';calls:=0;p:=@s[2];Change(s[NextIndex],s[NextIndex]);
        WriteLn(s,',',calls,',',p^);p^:='Z';WriteLn(s)
      end.`)
    ).toEqual(['aYcde,2,Y', 'aZcde']);
  });

  it('reads a character VAR parameter from the current whole-string value', () => {
    expect(
      execute(`program WholeStringAlias;
      type Text5=String[5];var s:Text5;
      procedure Change(var c:Char;var whole:Text5);
      begin c:='Q';whole:='12345';WriteLn(c);c:='Z' end;
      begin s:='abcde';Change(s[2],s);WriteLn(s)end.`)
    ).toEqual(['2', '1Z345']);
  });

  it('commits character input through aliased references without replacing the whole string', () => {
    expect(
      execute(
        `program CharacterInput;var s:String[3];
      begin s:='abc';ReadLn(s[1],s[1]);Inc(s[2]);WriteLn(s)end.`,
        ['XY']
      )
    ).toEqual(['Ycc']);
  });

  it('preserves assigned backing bytes when the length byte changes through VAR', () => {
    expect(
      execute(`program LengthByte;var s:String[3];
      procedure Shorten(var size:Char);begin size:=#1;WriteLn(Length(s));size:=#3 end;
      begin s:='abc';Shorten(s[0]);WriteLn(s)end.`)
    ).toEqual(['1', 'abc']);
  });

  it('addresses initialized short-string bytes independently of the current length', () => {
    // Confirmed against Free Pascal 3.2.2 in TP mode, with a fully initialized buffer.
    expect(
      execute(`program CharacterBacking;var s:String[3];
      begin s:='abc';s[0]:=#1;s[3]:='Z';WriteLn(Ord(s[3]),',',Length(s));
        s[0]:=#3;WriteLn(s)end.`)
    ).toEqual(['90,1', 'abZ']);
    expect(() =>
      execute(`program CharacterBounds;var s:String[3];
      begin s:='abc';s[4]:='Z'end.`)
    ).toThrow(/String index out of bounds/);
  });

  it('copies initialized backing bytes with aggregate assignment and value parameters', () => {
    // Record copies include the whole fixed-size short-string field; unlike a
    // standalone value-string argument, its trailing bytes are defined here.
    expect(
      execute(`program AggregateBacking;
      type Item=record text:String[3]end;var a,b:Item;
      procedure Show(value:Item);begin value.text[0]:=#3;WriteLn(value.text)end;
      begin a.text:='abc';a.text[0]:=#1;b:=a;b.text[0]:=#3;WriteLn(b.text);Show(a)end.`)
    ).toEqual(['abc', 'abc']);
  });

  it('keeps short-string value parameters truncated and independent', () => {
    expect(
      execute(`program StringValues;
      type SmallText=String[3];var s:String[8];
      procedure Edit(value:SmallText);begin WriteLn(value);value:='xyz';WriteLn(value)end;
      begin s:='abcdef';Edit(s);WriteLn(s)end.`)
    ).toEqual(['abc', 'xyz', 'abcdef']);
    expect(() =>
      compile(`program StringReferences;
      type SmallText=String[3];var s:String[8];
      procedure Edit(var value:SmallText);begin value:='xyz'end;
      begin Edit(s)end.`)
    ).toThrow(/matching capacities/);
  });

  it('folds Boolean, character, numeric and set comparisons consistently', () => {
    expect(
      execute(`program ConstantLogic;
      const First=(2<3) and not False;Second=('a'<'b') xor (5=6);
        Member=3 in [1..4];Subset=[1,4]<=[1..4];Mixed=(2<=2.0)and(True>False);
      begin WriteLn(First,',',Second,',',Member,',',Subset,',',Mixed)end.`)
    ).toEqual(['TRUE,TRUE,TRUE,TRUE,TRUE']);
  });

  it('keeps enum subranges compatible with their own family in arrays, sets and comparisons', () => {
    expect(
      execute(`program EnumFamily;
      type Color=(red,green,blue);Alias=Color;Cool=green..blue;
        Palette=set of Color;Weights=array[Color]of Integer;
      var c:Alias;shade:Cool;chosen:Palette;weight:Weights;total:Integer;
      begin chosen:=[red,blue];weight[red]:=3;weight[green]:=4;weight[blue]:=5;
        total:=0;for c:=red to blue do if c in chosen then Inc(total,weight[c]);
        shade:=green;Inc(shade);WriteLn(total,',',Ord(shade),',',shade>=green)
      end.`)
    ).toEqual(['8,2,TRUE']);
  });

  it.each([
    'x:=b1',
    'x:=1',
    'n:=a1+1',
    'n:=a1 or a2',
    'WriteLn(a1=b1)',
    'values[b1]:=4',
    'bits:=[b1]',
    'WriteLn(b1 in bits)',
  ])('rejects mixing distinct enum families or arithmetic: %s', (statement) => {
    expect(() =>
      compile(`program EnumErrors;
      type A=(a1,a2);B=(b1,b2);ValuesA=array[A]of Integer;BitsA=set of A;
      var x:A;n:Integer;values:ValuesA;bits:BitsA;
      begin ${statement} end.`)
    ).toThrow();
  });

  it('retains ordinal loop semantics for character and Boolean counters', () => {
    expect(
      execute(`program OrdinalLoops;var c:Char;b:Boolean;sum:Integer;
      begin sum:=0;for c:='c' downto 'a' do Write(c);
        for b:=False to True do if b then Inc(sum,10)else Inc(sum,1);
        WriteLn(',',sum)end.`)
    ).toEqual(['cba,11']);
  });

  it('rejects overlapping case ranges and repeated labels even within one branch', () => {
    expect(() =>
      compile(`program CaseOverlap;var n:Integer;
      begin n:=2;case n of 1..3:WriteLn(1);3..5:WriteLn(2)end end.`)
    ).toThrow(/overlapping case label/);
    expect(() =>
      compile(`program CaseDuplicate;var ch:Char;
      begin ch:='b';case ch of 'a'..'c','b':WriteLn(1)end end.`)
    ).toThrow(/overlapping case label/);
    expect(() =>
      compile(`program CaseReversed;var n:Integer;
      begin n:=2;case n of 3..1:WriteLn(1)end end.`)
    ).toThrow(/lower bound/);
  });

  it('rejects mixed enum families and invalid endpoints in constant set constructors', () => {
    expect(() =>
      compile(`program MixedConstantSet;
      type A=(a1,a2);B=(b1,b2);const Mixed=[a1,b1];begin end.`)
    ).toThrow(/enumeration/);
    expect(() => compile('program SetEndpoint;const Bad=[300..1];begin end.')).toThrow(
      /Set element out of range/
    );
  });
});
