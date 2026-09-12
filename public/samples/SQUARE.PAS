program Hello;

Procedure Square(Index : Integer; Var Result : Integer);
Begin
     Result := Index * Index;
End;

Var
   Res : Integer;

begin
     writeln('----- SQUARE OF 7 -----');
     Square(7, Res);
     writeln(Res);
     readln;
end.
