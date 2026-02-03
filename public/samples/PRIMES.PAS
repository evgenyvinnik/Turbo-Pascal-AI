program PrimeNumbers;
{ Find prime numbers up to a given limit }

var
  limit, i, j: Integer;
  isPrime: Boolean;
  count: Integer;

begin
  WriteLn('Prime Number Finder');
  WriteLn('===================');
  WriteLn;

  Write('Enter upper limit: ');
  ReadLn(limit);
  WriteLn;

  if limit < 2 then
  begin
    WriteLn('No prime numbers below 2.');
  end
  else
  begin
    WriteLn('Prime numbers up to ', limit, ':');
    WriteLn;
    count := 0;

    for i := 2 to limit do
    begin
      isPrime := True;

      for j := 2 to i - 1 do
      begin
        if (i mod j) = 0 then
        begin
          isPrime := False;
          Break;
        end;
      end;

      if isPrime then
      begin
        Write(i:5);
        Inc(count);
        if (count mod 10) = 0 then
          WriteLn;
      end;
    end;

    WriteLn;
    WriteLn;
    WriteLn('Total: ', count, ' prime numbers found.');
  end;

  WriteLn;
  WriteLn('Press any key to exit...');
  ReadLn;
end.
