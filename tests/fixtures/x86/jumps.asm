; Near jumps and calls, which land relative to the instruction after their
; displacement: forward, then backward past a short jump's reach.
bits 16
cpu 186
org 0
start:
  xor ax, ax
  jmp near forward
  mov ax, 0xdead        ; jumped over
back:
  add ax, 2             ; 7
  call near twice       ; 14
  hlt
twice:
  add ax, ax
  ret
  times 200 nop
forward:
  mov ax, 5
  jmp near back
