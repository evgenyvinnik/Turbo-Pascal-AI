{ BGIDEMO.PAS - a tour of the Graph unit, a screen at a time.

  Press any key for the next screen, or Esc to stop. Each screen shows a
  part of the unit: colors and the palette, lines, shapes, charts, fill
  patterns, polygons, the stroked fonts, viewports, images and XOR
  drawing. }
program BGIDemo;

uses Crt, Graph;

var
  Driver, Mode, Error: Integer;
  MaxX, MaxY: Integer;
  Quit: Boolean;

function Num(N: Longint): string;
var
  S: string;
begin
  Str(N, S);
  Num := S;
end;

{ The frame every screen draws: a title bar, a border and a hint line.
  Drawing then goes into the viewport inside them. }
procedure Screen(Title: string);
begin
  SetViewPort(0, 0, MaxX, MaxY, ClipOn);
  ClearDevice;
  SetLineStyle(SolidLn, 0, NormWidth);
  SetTextStyle(DefaultFont, HorizDir, 1);
  SetTextJustify(CenterText, CenterText);
  SetFillStyle(SolidFill, Blue);
  Bar(0, 0, MaxX, 20);
  SetColor(White);
  OutTextXY(MaxX div 2, 10, Title);
  SetFillStyle(SolidFill, LightGray);
  Bar(0, MaxY - 20, MaxX, MaxY);
  SetColor(Black);
  OutTextXY(MaxX div 2, MaxY - 10, 'Any key: next screen      Esc: quit');
  SetColor(White);
  Rectangle(0, 0, MaxX, MaxY);
  SetTextJustify(LeftText, TopText);
  SetViewPort(1, 21, MaxX - 1, MaxY - 21, ClipOn);
end;

{ Waits for a key; Esc ends the tour. }
procedure Pause;
var
  Key: Char;
begin
  Key := ReadKey;
  if Key = #0 then Key := ReadKey;
  Quit := Key = #27;
end;

procedure TitleScreen;
var
  R: Integer;
begin
  Screen('Turbo Pascal Graph unit');
  for R := 1 to 15 do
  begin
    SetColor(R);
    Circle(MaxX div 2, 250, R * 8);
  end;
  SetColor(Yellow);
  SetTextJustify(CenterText, TopText);
  SetTextStyle(TriplexFont, HorizDir, 4);
  OutTextXY(MaxX div 2, 10, 'Graph Demo');
  SetTextStyle(DefaultFont, HorizDir, 1);
  SetColor(LightCyan);
  OutTextXY(MaxX div 2, 70, 'Driver ' + GetDriverName + ', mode ' +
    GetModeName(GetGraphMode));
  OutTextXY(MaxX div 2, 86, Num(GetMaxX + 1) + ' x ' + Num(GetMaxY + 1) +
    ' dots in ' + Num(GetMaxColor + 1) + ' colors');
end;

{ The sixteen colors, then the palette turning through them. }
procedure ColorScreen;
var
  Palette, Start: PaletteType;
  Color, Step, Width: Integer;
begin
  Screen('Colors and the palette');
  Width := (MaxX - 40) div 16;
  for Color := 0 to 15 do
  begin
    SetFillStyle(SolidFill, Color);
    Bar(20 + Color * Width, 20, 20 + Color * Width + Width - 4, 260);
    SetColor(White);
    Rectangle(20 + Color * Width, 20, 20 + Color * Width + Width - 4, 260);
    OutTextXY(24 + Color * Width, 270, Num(Color));
  end;
  SetColor(LightGray);
  OutTextXY(20, 300, 'SetPalette turns the colors without drawing again.');
  GetPalette(Start);
  Palette := Start;
  for Step := 1 to 30 do
  begin
    for Color := 1 to 15 do
      SetPalette(Color, Start.Colors[(Color + Step - 1) mod 15 + 1]);
    Delay(40);
  end;
  SetAllPalette(Start);
end;

procedure LineScreen;
const
  Names: array[0..4] of string[10] =
    ('Solid', 'Dotted', 'Center', 'Dashed', 'User');
var
  Style, I, CX, CY: Integer;
begin
  Screen('Line styles and LineRel');
  for Style := 0 to 4 do
  begin
    SetColor(LightGray);
    OutTextXY(20, 20 + Style * 40, Names[Style]);
    SetColor(Yellow);
    SetLineStyle(Style, $F0F0, NormWidth);
    Line(100, 24 + Style * 40, 280, 24 + Style * 40);
    SetLineStyle(Style, $F0F0, ThickWidth);
    Line(100, 36 + Style * 40, 280, 36 + Style * 40);
  end;
  SetLineStyle(SolidLn, 0, NormWidth);
  CX := 460;
  CY := 180;
  for I := 0 to 35 do
  begin
    SetColor(I mod 15 + 1);
    MoveTo(CX, CY);
    LineRel(Round(150 * Cos(I * Pi / 18)), Round(150 * Sin(I * Pi / 18)));
  end;
end;

procedure ShapeScreen;
var
  I: Integer;
begin
  Screen('Circles, arcs, ellipses and sectors');
  SetColor(LightGreen);
  for I := 1 to 6 do
    Circle(110, 130, I * 15);
  SetColor(Yellow);
  for I := 0 to 7 do
    Arc(300, 130, I * 45, I * 45 + 30, 90);
  SetColor(LightCyan);
  Ellipse(480, 80, 0, 360, 120, 40);
  SetFillStyle(SolidFill, Magenta);
  FillEllipse(480, 200, 90, 50);
  SetFillStyle(HatchFill, LightRed);
  Sector(300, 310, 30, 300, 100, 60);
  SetColor(LightGray);
  OutTextXY(20, 390, 'Circle, Arc, Ellipse, FillEllipse and Sector');
end;

{ A pie chart labeled where each slice's arc ends, and a bar chart. }
procedure ChartScreen;
const
  Share: array[1..5] of Integer = (30, 25, 20, 15, 10);
  Sales: array[1..6] of Integer = (60, 110, 90, 150, 130, 180);
var
  I, Angle, Sweep: Integer;
  Ends: ArcCoordsType;
begin
  Screen('PieSlice and Bar3D');
  Angle := 0;
  for I := 1 to 5 do
  begin
    Sweep := Share[I] * 360 div 100;
    SetFillStyle(I + 1, I + 8);
    SetColor(White);
    PieSlice(170, 190, Angle, Angle + Sweep, 130);
    GetArcCoords(Ends);
    SetColor(I + 8);
    OutTextXY(Ends.XEnd, Ends.YEnd, ' ' + Num(Share[I]) + '%');
    Angle := Angle + Sweep;
  end;
  SetColor(White);
  Line(360, 330, 620, 330);
  for I := 1 to 6 do
  begin
    SetFillStyle(SolidFill, I + 8);
    Bar3D(340 + I * 40, 330 - Sales[I], 365 + I * 40, 330, 8, TopOn);
    OutTextXY(345 + I * 40, 340, Num(I));
  end;
end;

{ The twelve fill styles, a user pattern, and a flood fill. }
procedure FillScreen;
const
  Bricks: FillPatternType = ($FF, $80, $80, $80, $FF, $08, $08, $08);
var
  Style, X, Y: Integer;
begin
  Screen('Fill patterns and FloodFill');
  SetColor(White);
  for Style := 0 to 11 do
  begin
    X := 20 + (Style mod 6) * 100;
    Y := 20 + (Style div 6) * 110;
    SetFillStyle(Style, LightCyan);
    Bar(X, Y, X + 80, Y + 80);
    Rectangle(X, Y, X + 80, Y + 80);
    OutTextXY(X, Y + 86, 'Style ' + Num(Style));
  end;
  SetFillPattern(Bricks, LightRed);
  Bar(20, 250, 300, 370);
  Rectangle(20, 250, 300, 370);
  OutTextXY(20, 376, 'SetFillPattern');
  SetColor(Yellow);
  Circle(450, 300, 70);
  Line(380, 300, 520, 300);
  SetFillStyle(SolidFill, Green);
  FloodFill(450, 270, Yellow);
  SetColor(White);
  OutTextXY(380, 376, 'FloodFill');
end;

{ A star filled by FillPoly, and a zigzag DrawPoly draws. }
procedure PolygonScreen;
var
  Star: array[1..10] of PointType;
  Zigzag: array[1..9] of PointType;
  I, R: Integer;
begin
  Screen('FillPoly and DrawPoly');
  for I := 1 to 10 do
  begin
    if Odd(I) then R := 150 else R := 60;
    Star[I].X := 180 + Round(R * Sin(I * Pi / 5));
    Star[I].Y := 190 - Round(R * Cos(I * Pi / 5));
  end;
  SetColor(Yellow);
  SetFillStyle(SolidFill, Red);
  FillPoly(10, Star);
  for I := 1 to 9 do
  begin
    Zigzag[I].X := 360 + I * 28;
    if Odd(I) then Zigzag[I].Y := 80 else Zigzag[I].Y := 300;
  end;
  SetColor(LightGreen);
  SetLineStyle(SolidLn, 0, ThickWidth);
  DrawPoly(9, Zigzag);
  SetLineStyle(SolidLn, 0, NormWidth);
end;

{ The default font and the ten stroked ones, then text turned and placed. }
procedure TextScreen;
const
  Names: array[0..10] of string[12] =
    ('Default', 'Triplex', 'Small', 'SansSerif', 'Gothic', 'Script',
     'Simplex', 'TriplexScr', 'Complex', 'European', 'Bold');
var
  Font: Integer;
begin
  Screen('Fonts and text');
  for Font := 0 to 10 do
  begin
    SetColor(Font mod 7 + 9);
    if Font = 0 then SetTextStyle(Font, HorizDir, 2)
    else SetTextStyle(Font, HorizDir, 3);
    OutTextXY(10, 4 + Font * 35, Names[Font] + ' font');
  end;
  SetColor(White);
  SetTextStyle(TriplexFont, VertDir, 3);
  OutTextXY(600, 360, 'VertDir');
  SetTextStyle(DefaultFont, HorizDir, 1);
  SetColor(DarkGray);
  Line(470, 280, 470, 380);
  Line(400, 330, 540, 330);
  SetColor(Yellow);
  SetTextJustify(CenterText, CenterText);
  OutTextXY(470, 330, 'Centered');
  SetTextJustify(LeftText, TopText);
end;

{ Lines thrown at two viewports: one clips them, one does not. }
procedure ViewportScreen;
var
  I: Integer;
begin
  Screen('Viewports and clipping');
  SetColor(White);
  OutTextXY(20, 4, 'ClipOn: lines stop at the frame');
  OutTextXY(340, 4, 'ClipOff: lines run past it');
  { The frames, a dot outside the viewports below; this screen's own
    viewport starts at 1, 21. }
  Rectangle(19, 19, 291, 321);
  Rectangle(339, 119, 611, 221);
  SetViewPort(21, 41, 291, 341, ClipOn);
  for I := 1 to 60 do
  begin
    SetColor(Random(15) + 1);
    Line(Random(400) - 50, Random(400) - 50, Random(400) - 50, Random(400) - 50);
  end;
  SetViewPort(341, 141, 611, 241, ClipOff);
  for I := 1 to 12 do
  begin
    SetColor(Random(15) + 1);
    Line(Random(270), Random(98), Random(270), Random(98) + 60);
  end;
end;

{ A ball saved with GetImage, moved across the screen by PutImage XOR. }
procedure ImageScreen;
var
  Ball: Pointer;
  Size: Word;
  X, Y, DX, DY, Step: Integer;
begin
  Screen('GetImage and PutImage');
  SetColor(Yellow);
  SetFillStyle(SolidFill, Yellow);
  FillEllipse(20, 20, 16, 16);
  SetColor(Red);
  Circle(20, 20, 8);
  Size := ImageSize(4, 4, 36, 36);
  GetMem(Ball, Size);
  GetImage(4, 4, 36, 36, Ball^);
  PutImage(4, 4, Ball^, XORPut);
  SetColor(DarkGray);
  for X := 1 to 12 do
    Line(X * 50, 0, X * 50, 400);
  X := 10;
  Y := 10;
  DX := 6;
  DY := 4;
  for Step := 1 to 150 do
  begin
    PutImage(X, Y, Ball^, XORPut);
    Delay(10);
    PutImage(X, Y, Ball^, XORPut);
    if (X + DX < 0) or (X + DX > MaxX - 36) then DX := -DX;
    if (Y + DY < 0) or (Y + DY > MaxY - 76) then DY := -DY;
    X := X + DX;
    Y := Y + DY;
  end;
  PutImage(X, Y, Ball^, NormalPut);
  FreeMem(Ball, Size);
  SetColor(White);
  OutTextXY(20, 380, 'The ball crossed the grid without erasing it.');
end;

{ A radar sweep: each line drawn twice in XORPut leaves the screen as it was. }
procedure XorScreen;
var
  Step, CX, CY: Integer;
  X, Y: Integer;
begin
  Screen('SetWriteMode(XORPut)');
  CX := MaxX div 2;
  CY := 200;
  SetColor(Green);
  Circle(CX, CY, 150);
  Circle(CX, CY, 100);
  Circle(CX, CY, 50);
  SetWriteMode(XORPut);
  SetColor(LightGreen);
  for Step := 0 to 72 do
  begin
    X := CX + Round(150 * Cos(Step * Pi / 36));
    Y := CY - Round(150 * Sin(Step * Pi / 36));
    Line(CX, CY, X, Y);
    Delay(15);
    Line(CX, CY, X, Y);
  end;
  SetWriteMode(CopyPut);
  SetColor(White);
  OutTextXY(20, 380, 'Lines XORed twice leave no trace.');
end;

procedure EndScreen;
begin
  Screen('The end');
  SetColor(LightRed);
  SetTextJustify(CenterText, CenterText);
  SetTextStyle(GothicFont, HorizDir, 5);
  OutTextXY((MaxX - 2) div 2, 150, 'Thank you');
  SetTextStyle(DefaultFont, HorizDir, 1);
  SetColor(LightGray);
  OutTextXY((MaxX - 2) div 2, 260, 'Press any key to return to the IDE.');
end;

begin
  Driver := Detect;
  InitGraph(Driver, Mode, '');
  Error := GraphResult;
  if Error <> grOk then
  begin
    WriteLn('Graphics error: ', GraphErrorMsg(Error));
    Halt(1);
  end;
  MaxX := GetMaxX;
  MaxY := GetMaxY;
  Quit := False;
  TitleScreen;
  Pause;
  if not Quit then begin ColorScreen; Pause end;
  if not Quit then begin LineScreen; Pause end;
  if not Quit then begin ShapeScreen; Pause end;
  if not Quit then begin ChartScreen; Pause end;
  if not Quit then begin FillScreen; Pause end;
  if not Quit then begin PolygonScreen; Pause end;
  if not Quit then begin TextScreen; Pause end;
  if not Quit then begin ViewportScreen; Pause end;
  if not Quit then begin ImageScreen; Pause end;
  if not Quit then begin XorScreen; Pause end;
  if not Quit then begin EndScreen; Pause end;
  CloseGraph;
end.
