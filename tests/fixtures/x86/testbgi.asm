; TESTBGI: a small BGI 2.0 graphics driver for the tests, written here from
; the driver interface, in the layout Borland's drivers have: the far entry
; at 0, which calls the function SI names through the vector table with DS
; set to the driver's segment; 'CB' after it; EMULATE, the five bytes the
; Graph unit takes over for what a driver leaves to it, at 10h.
;
; One mode: 320x200 in 256 colours, through BIOS mode 13h. It draws lines,
; bars and dots itself, clipped to the clip rectangle, and leaves flood fill
; and text to the kernel.
bits 16
cpu 186
org 0

entry:  push ds                 ; 1E
        push cs                 ; 0E
        pop ds                  ; 1F
        cld                     ; FC
        push bp                 ; 55
        call [si + vectors]     ; FF 94 lo hi: the table's offset is at 7
        pop bp
        pop ds
        retf
        db 'CB', 0, 2
emulate: ret                    ; at 10h
        dw 0, 0

vectors:
        dw install              ; 0  install
        dw init                 ; 1  init
        dw clear                ; 2  clear
        dw post                 ; 3  post
        dw move                 ; 4  move
        dw draw                 ; 5  draw
        dw vect                 ; 6  vect
        dw emulate              ; 7  reserved
        dw emulate              ; 8  bar3d
        dw patbar               ; 9  patbar
        dw emulate              ; 10 arc
        dw emulate              ; 11 pieslice
        dw emulate              ; 12 filled ellipse
        dw nothing              ; 13 palette
        dw nothing              ; 14 all palette
        dw colour               ; 15 colour
        dw fillstyle            ; 16 fill style
        dw nothing              ; 17 line style
        dw nothing              ; 18 text style
        dw emulate              ; 19 text
        dw nothing              ; 20 text size
        dw emulate              ; 21 reserved
        dw emulate              ; 22 flood fill
        dw getpixel             ; 23 get pixel
        dw putpixel             ; 24 put pixel
        dw nothing              ; 25 bitmap util
        dw nothing              ; 26 save bitmap
        dw nothing              ; 27 restore bitmap
        dw setclip              ; 28 set clip
        dw colourquery          ; 29 colour query

status:                         ; the device status table
        db 0                    ; status
        db 0                    ; device type
        dw 319, 199             ; resolution
        dw 319, 199             ; effective resolution
        dw 9000, 7000           ; inches x 1000
        dw 8333                 ; aspect ratio x 10000
        db 8, 8, 90h, 90h
modename: db 16, 'TEST 320x200x256'

drawcolour: db 15
fillcolour: db 15
fillpattern: db 1
cpx:    dw 0
cpy:    dw 0
clipx1: dw 0
clipy1: dw 0
clipx2: dw 319
clipy2: dw 199

nothing: ret

; INSTALL: AL=0 install for mode CL, ES:BX the status table; AL=1, CX the
; number of modes; AL=2, ES:BX the name of mode CL.
install:
        cmp al, 1
        jne .notcount
        mov cx, 1
        ret
.notcount:
        push cs
        pop es
        cmp al, 2
        jne .install
        mov bx, modename
        ret
.install:
        mov byte [status], 0
        test cl, cl
        jz .ok
        mov byte [status], -10  ; grInvalidMode
.ok:    mov bx, status
        ret

init:   mov ax, 13h
        int 10h
        ret

post:   mov ax, 3
        int 10h
        ret

clear:  push es
        mov ax, 0a000h
        mov es, ax
        xor di, di
        xor ax, ax
        mov cx, 32000
        rep stosw
        pop es
        ret

move:   mov [cpx], ax
        mov [cpy], bx
        ret

draw:   mov cx, [cpx]
        mov dx, [cpy]
        mov [cpx], ax
        mov [cpy], bx
        xchg ax, cx
        xchg bx, dx
        ; fall through: a line from AX,BX to CX,DX

; VECT: a line from (AX,BX) to (CX,DX), by Bresenham's steps.
vect:   mov [x1], ax
        mov [y1], bx
        mov [x2], cx
        mov [y2], dx
        mov si, cx
        sub si, ax
        mov word [sx], 1
        jge .xpositive
        neg si
        mov word [sx], -1
.xpositive:
        mov [ddx], si           ; |x2 - x1|
        mov si, dx
        sub si, bx
        mov word [sy], 1
        jge .ypositive
        neg si
        mov word [sy], -1
.ypositive:
        neg si
        mov [ddy], si           ; -|y2 - y1|
        add si, [ddx]
        mov [err], si
.loop:  mov ax, [x1]
        mov bx, [y1]
        mov dl, [drawcolour]
        call plot
        mov ax, [x1]
        cmp ax, [x2]
        jne .step
        mov ax, [y1]
        cmp ax, [y2]
        je .done
.step:  mov ax, [err]
        add ax, ax              ; e2 = 2 * error
        cmp ax, [ddy]
        jl .noxstep
        mov si, [ddy]
        add [err], si
        mov si, [sx]
        add [x1], si
.noxstep:
        cmp ax, [ddx]
        jg .noystep
        mov si, [ddx]
        add [err], si
        mov si, [sy]
        add [y1], si
.noystep:
        jmp .loop
.done:  ret

; PLOT: the dot at (AX,BX) in colour DL, if it is inside the clip rectangle.
plot:   cmp ax, [clipx1]
        jl .out
        cmp ax, [clipx2]
        jg .out
        cmp bx, [clipy1]
        jl .out
        cmp bx, [clipy2]
        jg .out
        push es
        push di
        push dx
        mov di, ax
        mov ax, 320
        mul bx
        add di, ax
        mov ax, 0a000h
        mov es, ax
        pop dx
        mov [es:di], dl
        pop di
        pop es
.out:   ret

putpixel:
        call plot
        ret

; GETPIXEL: DL the colour of the dot at (AX,BX).
getpixel:
        push es
        mov di, ax
        mov ax, 320
        mul bx
        add di, ax
        mov ax, 0a000h
        mov es, ax
        mov dl, [es:di]
        pop es
        ret

; PATBAR: the bar (AX,BX)-(CX,DX) in the fill colour, or colour 0 for the
; empty fill; every other pattern is drawn solid.
patbar: mov [x1], ax
        mov [y1], bx
        mov [x2], cx
        mov [y2], dx
        mov dl, [fillcolour]
        cmp byte [fillpattern], 0
        jne .colour
        xor dl, dl
.colour:
        mov bx, [y1]
.row:   cmp bx, [y2]
        jg .done
        mov ax, [x1]
.dot:   cmp ax, [x2]
        jg .nextrow
        push ax
        push bx
        push dx
        call plot
        pop dx
        pop bx
        pop ax
        inc ax
        jmp .dot
.nextrow:
        inc bx
        jmp .row
.done:  ret

colour: mov [drawcolour], al
        mov [fillcolour], ah
        ret

fillstyle:
        mov [fillpattern], al
        ret

setclip:
        mov [clipx1], ax
        mov [clipy1], bx
        mov [clipx2], cx
        mov [clipy2], dx
        ret

; COLOURQUERY: AL=0, CX the highest colour.
colourquery:
        test al, al
        jnz .table
        xor bx, bx
        mov cx, 255
.table: ret

x1:     dw 0
y1:     dw 0
x2:     dw 0
y2:     dw 0
sx:     dw 0
sy:     dw 0
ddx:    dw 0
ddy:    dw 0
err:    dw 0
