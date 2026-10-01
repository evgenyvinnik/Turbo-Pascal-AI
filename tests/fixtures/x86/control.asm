bits 16
cpu 186
org 0
start:
  ; rep movsb copies "HELLO" to buf, repe cmpsb compares
  cld
  mov si, msg
  mov di, buf
  mov cx, 5
  rep movsb
  mov si, msg
  mov di, buf
  mov cx, 5
  repe cmpsb            ; equal -> ZF=1, CX=0
  mov ax, cx            ; 0
  ; scasb finds 'L'
  mov di, msg
  mov al, 'L'
  mov cx, 5
  repne scasb
  mov bx, di            ; msg+3
  sub bx, msg           ; 3
  ; loop sums 1..10
  xor dx, dx
  mov cx, 10
l1: add dx, cx
  loop l1               ; dx = 55
  ; far call
  call 0x1000:farproc
  ; rcl through carry
  stc
  mov al, 0x80
  rcl al, 1             ; al=1, CF=1
  adc dl, 0             ; dl += 1 -> 56+? (dl after far = dl+1)
  ; daa: 0x19 + 0x28 = 0x47 BCD
  mov al, 0x19
  add al, 0x28
  daa
  mov ah, al
  ; les
  les di, [farptr]      ; di=0x5678 es=0x1234
  mov si, es
  ; enter/leave, pusha/popa
  enter 4, 0
  pusha
  mov bp, 0
  popa
  leave
  ; int 0x60 through IVT -> handler sets cx=0xbeef
  push ds
  xor cx, cx
  mov ds, cx
  mov word [0x180], handler
  mov word [0x182], 0x1000
  pop ds
  int 0x60
  hlt
farproc:
  inc dx                ; 56
  retf
handler:
  mov cx, 0xbeef
  iret
msg: db "HELLO"
buf: times 5 db 0
farptr: dw 0x5678, 0x1234
