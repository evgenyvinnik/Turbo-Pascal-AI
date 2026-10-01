bits 16
cpu 186
; arithmetic and flags
mov ax, 0x7fff
add ax, 1          ; OF SF set
mov bx, ax
mov cx, 10
xor dx, dx
mov ax, 1000
mul cx             ; ax=10000
mov si, ax
mov ax, -7
cwd
mov cx, 2
idiv cx            ; ax=-3 dx=-1
mov di, ax
mov bp, dx
push 0x1234
pop dx
imul ax, di, 5     ; -15
shl ax, 3          ; -120
hlt
