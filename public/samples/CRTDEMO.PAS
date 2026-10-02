{ CRTDEMO.PAS - a tour of the Crt unit, a screen at a time.

  Press any key for the next screen, or Esc to stop. Each screen shows a
  part of the unit: colors, windows, inserting and deleting lines, the
  cursor, the keyboard, sound and a little animation. }
program CrtDemo;

uses Crt;

var
  Quit: Boolean;

{ A double-line frame, drawn with the box characters of the PC's font. }
procedure Frame(X1, Y1, X2, Y2: Integer);
var
  X, Y: Integer;
begin
  GotoXY(X1, Y1); Write(#201);
  for X := X1 + 1 to X2 - 1 do Write(#205);
  Write(#187);
  for Y := Y1 + 1 to Y2 - 1 do
  begin
    GotoXY(X1, Y); Write(#186);
    GotoXY(X2, Y); Write(#186);
  end;
  GotoXY(X1, Y2); Write(#200);
  for X := X1 + 1 to X2 - 1 do Write(#205);
  Write(#188);
end;

{ Clears the whole screen and writes the title and hint lines. }
procedure Screen(Title: string);
begin
  Window(1, 1, 80, 25);
  TextBackground(Blue);
  TextColor(White);
  ClrScr;
  TextBackground(Cyan);
  TextColor(Black);
  GotoXY(1, 1); ClrEol;
  GotoXY(41 - Length(Title) div 2, 1); Write(Title);
  GotoXY(1, 25); ClrEol;
  GotoXY(22, 25); Write('Any key: next screen      Esc: quit');
  TextBackground(Blue);
  TextColor(White);
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
begin
  Screen('Turbo Pascal Crt unit');
  TextColor(Yellow);
  Frame(20, 5, 60, 19);
  GotoXY(31, 8); Write('C R T   D E M O');
  TextColor(LightCyan);
  GotoXY(26, 11); Write('Colors, windows and lines,');
  GotoXY(26, 12); Write('the cursor and the keyboard,');
  GotoXY(26, 13); Write('sound, and an animation.');
  TextColor(LightGray);
  GotoXY(26, 16); Write('Screen ', Lo(WindMax) + 1, ' x ', Hi(WindMax) + 1,
    ', text mode ', LastMode);
end;

{ Every foreground on every background: the attribute byte's two halves. }
procedure ColorScreen;
var
  Fore, Back: Integer;
begin
  Screen('TextColor and TextBackground');
  GotoXY(3, 3); Write('Back');
  for Fore := 0 to 15 do
  begin
    GotoXY(10 + Fore * 4, 3); Write(Fore:3);
  end;
  for Back := 0 to 7 do
  begin
    TextBackground(Blue);
    TextColor(White);
    GotoXY(3, 5 + Back * 2); Write(Back:3);
    for Fore := 0 to 15 do
    begin
      TextBackground(Back);
      TextColor(Fore);
      GotoXY(10 + Fore * 4, 5 + Back * 2); Write(' Ab ');
    end;
  end;
  TextBackground(Blue);
  TextColor(White + Blink);
  GotoXY(10, 22); Write('Adding Blink to a color makes it flash.');
  TextColor(White);
end;

{ Three windows, each scrolling its own lines. The cursor is the screen's,
  not a window's, so each window's row is kept here. }
procedure WindowScreen;
const
  Left: array[1..3] of Integer = (3, 29, 55);
  Paper: array[1..3] of Integer = (Red, Green, Magenta);
var
  Line, Which: Integer;
  Row: array[1..3] of Integer;
begin
  Screen('Window, and text scrolling in it');
  for Which := 1 to 3 do
  begin
    TextColor(White);
    Frame(Left[Which] - 1, 3, Left[Which] + 23, 22);
  end;
  for Line := 1 to 40 do
    for Which := 1 to 3 do
    begin
      Window(Left[Which], 4, Left[Which] + 22, 21);
      TextBackground(Paper[Which]);
      TextColor(Yellow);
      if Line = 1 then
      begin
        ClrScr;
        Row[Which] := 1;
      end;
      GotoXY(1, Row[Which]);
      WriteLn('Window ', Which, ', line ', Line);
      Row[Which] := WhereY;
      Delay(5);
    end;
  Window(1, 1, 80, 25);
  TextBackground(Blue);
  TextColor(White);
end;

{ Lines pushed down by InsLine and pulled up by DelLine. }
procedure LineScreen;
var
  I: Integer;
begin
  Screen('InsLine and DelLine');
  Window(10, 3, 70, 22);
  TextBackground(Black);
  ClrScr;
  for I := 1 to 20 do
  begin
    TextColor(I mod 15 + 1);
    GotoXY(1, I);
    Write('Line ', I);
  end;
  for I := 1 to 5 do
  begin
    GotoXY(1, 3);
    InsLine;
    TextColor(White);
    Write('Inserted line ', I);
    Delay(150);
  end;
  for I := 1 to 3 do
  begin
    GotoXY(1, 12);
    DelLine;
    Delay(150);
  end;
  Window(1, 1, 80, 25);
  TextBackground(Blue);
  TextColor(White);
end;

{ A spiral of characters placed with GotoXY, ring by ring inwards. }
procedure CursorScreen;
var
  Left, Top, Right, Bottom, X, Y, Count: Integer;

  procedure Put(X, Y: Integer);
  begin
    Inc(Count);
    GotoXY(X, Y);
    { Any color but the blue of the background. }
    TextColor(Count div 60 mod 14 + 2);
    Write(Chr(Ord('A') + Count mod 26));
    if Count mod 30 = 0 then Delay(5);
  end;

begin
  Screen('GotoXY, WhereX and WhereY');
  Left := 4; Top := 3; Right := 77; Bottom := 23;
  Count := 0;
  while (Left < Right - 20) and (Top < Bottom - 4) do
  begin
    for X := Left to Right do Put(X, Top);
    for Y := Top + 1 to Bottom do Put(Right, Y);
    for X := Right - 1 downto Left do Put(X, Bottom);
    for Y := Bottom - 1 downto Top + 1 do Put(Left, Y);
    Left := Left + 2; Top := Top + 2;
    Right := Right - 2; Bottom := Bottom - 2;
  end;
  TextColor(White);
  GotoXY(30, 13);
  Write('Here WhereX is ', WhereX, ', WhereY ', WhereY);
end;

{ The keys pressed, with the scan codes of the ones that send two. }
procedure KeyboardScreen;
var
  Key: Char;
  Count: Integer;
begin
  Screen('ReadKey');
  GotoXY(5, 3);
  Write('Press up to ten keys, arrows and function keys too; Enter ends.');
  Window(5, 5, 75, 22);
  Count := 0;
  repeat
    Key := ReadKey;
    Inc(Count);
    if Key = #0 then
    begin
      Key := ReadKey;
      WriteLn('Extended key, scan code ', Ord(Key));
    end
    else if Key >= ' ' then
      WriteLn('Key ''', Key, ''', character ', Ord(Key))
    else
      WriteLn('Control key, character ', Ord(Key));
  until (Key = #13) or (Key = #27) or (Count = 10);
  Quit := Key = #27;
  Window(1, 1, 80, 25);
end;

{ A scale played with Sound, Delay and NoSound. }
procedure SoundScreen;
const
  Notes: array[1..8] of Integer = (262, 294, 330, 349, 392, 440, 494, 523);
  Names: array[1..8] of string[2] = ('C', 'D', 'E', 'F', 'G', 'A', 'B', 'C');
var
  I: Integer;
begin
  Screen('Sound and NoSound');
  for I := 1 to 8 do
  begin
    TextColor(I + 7);
    GotoXY(6 + I * 8, 20 - I * 2);
    Write(Names[I], ' ', Notes[I], ' Hz');
    Sound(Notes[I]);
    Delay(150);
  end;
  NoSound;
  TextColor(White);
end;

{ A ball bouncing until a key is pressed, KeyPressed asking each frame. }
procedure BounceScreen;
var
  X, Y, DX, DY, Frames: Integer;
begin
  Screen('KeyPressed: press a key to stop the ball');
  X := 10; Y := 5; DX := 1; DY := 1;
  Frames := 0;
  repeat
    GotoXY(X, Y); TextColor(Yellow); Write('O');
    Delay(30);
    GotoXY(X, Y); Write(' ');
    if (X + DX < 2) or (X + DX > 79) then DX := -DX;
    if (Y + DY < 3) or (Y + DY > 23) then DY := -DY;
    X := X + DX;
    Y := Y + DY;
    Inc(Frames);
  until KeyPressed or (Frames = 300);
  if KeyPressed then Pause;
  TextColor(White);
  GotoXY(X, Y); Write('O');
  GotoXY(30, 12); Write('Stopped after ', Frames, ' frames.');
end;

procedure EndScreen;
begin
  Screen('The end');
  TextColor(Yellow);
  Frame(25, 9, 55, 15);
  GotoXY(34, 12); Write('Thank you');
end;

begin
  Quit := False;
  TitleScreen;
  Pause;
  if not Quit then begin ColorScreen; Pause end;
  if not Quit then begin WindowScreen; Pause end;
  if not Quit then begin LineScreen; Pause end;
  if not Quit then begin CursorScreen; Pause end;
  if not Quit then KeyboardScreen;
  if not Quit then begin SoundScreen; Pause end;
  if not Quit then begin BounceScreen; Pause end;
  if not Quit then begin EndScreen; Pause end;
  NormVideo;
  Window(1, 1, 80, 25);
  ClrScr;
end.
