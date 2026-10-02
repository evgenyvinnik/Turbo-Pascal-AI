{ MOUSE.PAS - a little paint program on the mouse driver, INT 33h.

  Click a color, then draw with the left button; the right button erases.
  Click Clear to start again, and Quit (or press Esc) to stop. The mouse is
  reached as DOS programs reached it: Intr($33) with the function in AX. }
program MousePaint;

uses Crt, Dos, Graph;

const
  Top = 40;              { The drawing area starts below the toolbar. }
  Box = 30;              { A color box's width. }

var
  Driver, Mode: Integer;
  Regs: Registers;
  X, Y, LastX, LastY, ClickX, ClickY: Integer;
  Buttons, LastButtons: Word;
  Ink: Word;
  Done: Boolean;

function Num(N: Longint): string;
var
  S: string;
begin
  Str(N, S);
  Num := S;
end;

{ Function 0: resets the driver; AX is $FFFF when one is installed. }
function MouseReset: Boolean;
begin
  Regs.AX := 0;
  Intr($33, Regs);
  MouseReset := Regs.AX = $FFFF;
end;

procedure ShowMouse;
begin
  Regs.AX := 1;
  Intr($33, Regs);
end;

procedure HideMouse;
begin
  Regs.AX := 2;
  Intr($33, Regs);
end;

{ Function 3: the position in CX and DX, the buttons in BX. }
procedure ReadMouse(var X, Y: Integer; var Buttons: Word);
begin
  Regs.AX := 3;
  Intr($33, Regs);
  X := Regs.CX;
  Y := Regs.DX;
  Buttons := Regs.BX;
end;

{ Function 5: whether the left button was pressed since last asked, and
  where. A click can come and go between two readings of function 3; the
  driver counts it. }
function LeftClicked(var X, Y: Integer): Boolean;
begin
  Regs.AX := 5;
  Regs.BX := 0;
  Intr($33, Regs);
  X := Regs.CX;
  Y := Regs.DX;
  LeftClicked := Regs.BX > 0;
end;

{ Functions 7 and 8: the mouse stays in the drawing area and toolbar. }
procedure LimitMouse(Left, Top, Right, Bottom: Integer);
begin
  Regs.AX := 7; Regs.CX := Left; Regs.DX := Right;
  Intr($33, Regs);
  Regs.AX := 8; Regs.CX := Top; Regs.DX := Bottom;
  Intr($33, Regs);
end;

procedure Button(X1: Integer; Caption: string);
begin
  SetFillStyle(SolidFill, LightGray);
  Bar(X1, 6, X1 + 60, 30);
  SetColor(Black);
  Rectangle(X1, 6, X1 + 60, 30);
  OutTextXY(X1 + 30 - TextWidth(Caption) div 2, 15, Caption);
end;

procedure Toolbar;
var
  Color: Integer;
begin
  SetFillStyle(SolidFill, DarkGray);
  Bar(0, 0, GetMaxX, Top - 2);
  for Color := 0 to 15 do
  begin
    SetFillStyle(SolidFill, Color);
    Bar(6 + Color * Box, 6, 6 + Color * Box + Box - 4, 30);
  end;
  Button(GetMaxX - 140, 'Clear');
  Button(GetMaxX - 70, 'Quit');
end;

{ The chosen color framed, and where the mouse is. }
procedure Status;
begin
  SetFillStyle(SolidFill, Black);
  Bar(0, GetMaxY - 14, GetMaxX, GetMaxY);
  SetColor(White);
  OutTextXY(4, GetMaxY - 10, 'Color ' + Num(Ink) + '   Mouse ' + Num(X) + ', ' +
    Num(Y) + '   Buttons ' + Num(Buttons) + '   Left draws, right erases, Esc quits');
end;

procedure ClearPicture;
begin
  SetFillStyle(SolidFill, Black);
  Bar(0, Top, GetMaxX, GetMaxY - 16);
  SetColor(DarkGray);
  Rectangle(0, Top, GetMaxX, GetMaxY - 16);
end;

{ A click in the toolbar: a color, Clear or Quit. }
procedure Click(X, Y: Integer);
begin
  if (Y >= 6) and (Y <= 30) then
    if (X >= 6) and (X < 6 + 16 * Box) then
      Ink := (X - 6) div Box
    else if (X >= GetMaxX - 140) and (X <= GetMaxX - 80) then
    begin
      HideMouse;
      ClearPicture;
      ShowMouse;
    end
    else if (X >= GetMaxX - 70) and (X <= GetMaxX - 10) then
      Done := True;
end;

begin
  Driver := Detect;
  InitGraph(Driver, Mode, '');
  if not MouseReset then
  begin
    CloseGraph;
    WriteLn('No mouse driver is installed.');
    Halt(1);
  end;
  Toolbar;
  ClearPicture;
  LimitMouse(0, 0, GetMaxX, GetMaxY - 16);
  Ink := White;
  ShowMouse;
  ReadMouse(LastX, LastY, LastButtons);
  X := LastX; Y := LastY; Buttons := LastButtons;
  Status;
  Done := False;
  repeat
    if LeftClicked(ClickX, ClickY) and (ClickY < Top) then
      Click(ClickX, ClickY);
    ReadMouse(X, Y, Buttons);
    if (Buttons <> LastButtons) or (X <> LastX) or (Y <> LastY) then
    begin
      if (Buttons and 3 <> 0) and (Y > Top) and (LastY > Top) then
      begin
        { The driver's cursor is hidden while the picture is drawn on. }
        HideMouse;
        SetViewPort(1, Top + 1, GetMaxX - 1, GetMaxY - 17, ClipOn);
        if Buttons and 1 <> 0 then
        begin
          SetColor(Ink);
          SetLineStyle(SolidLn, 0, NormWidth);
        end
        else
        begin
          SetColor(Black);
          SetLineStyle(SolidLn, 0, ThickWidth);
        end;
        Line(LastX - 1, LastY - Top - 1, X - 1, Y - Top - 1);
        SetViewPort(0, 0, GetMaxX, GetMaxY, ClipOn);
        ShowMouse;
      end;
      Status;
      LastX := X;
      LastY := Y;
      LastButtons := Buttons;
    end;
    if KeyPressed then
      Done := ReadKey = #27;
    Delay(10);
  until Done;
  HideMouse;
  CloseGraph;
end.
