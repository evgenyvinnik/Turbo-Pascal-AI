program Fibonacci;
{ Calculate Fibonacci numbers }

var
  n, i: Integer;
  a, b, temp: LongInt;

begin
  WriteLn('Fibonacci Number Calculator');
  WriteLn('===========================');
  WriteLn;

  Write('Enter how many Fibonacci numbers to display: ');
  ReadLn(n);
  WriteLn;

  if n <= 0 then
  begin
    WriteLn('Please enter a positive number.');
  end
  else
  begin
    a := 0;
    b := 1;

    WriteLn('Fibonacci sequence:');
    for i := 1 to n do
    begin
      WriteLn('F(', i, ') = ', a);
      temp := a + b;
      a := b;
      b := temp;
    end;
  end;

  WriteLn;
  WriteLn('Press any key to exit...');
  ReadLn;
end.
