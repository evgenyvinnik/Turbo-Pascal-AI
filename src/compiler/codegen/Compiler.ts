/**
 * Compiler from parse tree to bytecode
 *
 * Takes an AST from the parser and generates P-machine bytecode.
 * Handles all Pascal constructs including expressions, statements,
 * procedures, functions, and more.
 */

import { PascalError } from '../errors/PascalError';
import { inst, Opcode, TypeCode, MARK_SIZE } from '../types';
import { Bytecode, INative } from './Bytecode';
import type { Token } from '../lexer/Token';

/**
 * Node type constants matching the parser's AST node types
 */
export enum NodeType {
  // Basic types
  IDENTIFIER = 0,
  NUMBER = 1,
  STRING = 2,
  BOOLEAN = 3,
  POINTER = 4,

  // Program structures
  PROGRAM = 10,
  PROCEDURE = 11,
  FUNCTION = 12,
  USES = 13,
  VAR = 14,
  RANGE = 15,
  BLOCK = 16,
  PARAMETER = 17,
  CAST = 18,
  CONST = 19,

  // Statements
  ASSIGNMENT = 20,
  PROCEDURE_CALL = 21,
  REPEAT = 22,
  FOR = 23,
  IF = 24,
  EXIT = 25,
  FIELD = 26,
  WHILE = 27,
  TYPED_CONST = 28,

  // Unary operators
  NOT = 30,
  NEGATIVE = 31,

  // Binary operators
  ADDITION = 40,
  SUBTRACTION = 41,
  MULTIPLICATION = 42,
  DIVISION = 43,
  EQUALITY = 44,
  INEQUALITY = 45,
  LESS_THAN = 46,
  GREATER_THAN = 47,
  LESS_THAN_OR_EQUAL_TO = 48,
  GREATER_THAN_OR_EQUAL_TO = 49,
  AND = 50,
  OR = 51,
  INTEGER_DIVISION = 52,
  MOD = 53,

  // Field and array access
  FIELD_DESIGNATOR = 54,
  FUNCTION_CALL = 60,
  ARRAY = 61,
  TYPE = 62,
  ADDRESS_OF = 63,
  DEREFERENCE = 64,

  // Type definitions
  SIMPLE_TYPE = 70,
  ENUM_TYPE = 71,
  RECORD_TYPE = 73,
  ARRAY_TYPE = 74,
  SET_TYPE = 75,
  SUBPROGRAM_TYPE = 76,
}

/**
 * Interface for a symbol in the symbol table
 */
export interface ISymbol {
  name: string;
  type: INode;
  address: number;
  isNative: boolean;
  value: INode | null;
  byReference: boolean;
}

/**
 * Interface for a symbol lookup result
 */
export interface ISymbolLookup {
  symbol: ISymbol;
  level: number;
}

/**
 * Interface for raw data in typed constants
 */
export interface IRawData {
  data: number[];
  length: number;
  simpleTypeCodes: number[];
}

/**
 * Interface for a symbol table
 */
export interface ISymbolTable {
  native: INative;
  totalVariableSize: number;
  totalParameterSize: number;
}

/**
 * Interface representing an AST node
 */
export interface INode {
  nodeType: NodeType;
  token: Token | null;
  symbolTable?: ISymbolTable;
  expressionType?: INode;
  symbol?: ISymbol;
  symbolLookup?: ISymbolLookup;

  // For PROGRAM, PROCEDURE, FUNCTION
  name?: INode;
  declarations?: INode[];
  block?: INode;

  // For BLOCK
  statements?: INode[];

  // For CAST
  expression?: INode;
  type?: INode;

  // For ASSIGNMENT
  lhs?: INode;
  rhs?: INode;

  // For PROCEDURE_CALL, FUNCTION_CALL
  argumentList?: INode[];

  // For REPEAT, WHILE
  // expression already defined

  // For FOR
  variable?: INode;
  fromExpr?: INode;
  toExpr?: INode;
  body?: INode;
  downto?: boolean;

  // For IF
  thenStatement?: INode;
  elseStatement?: INode | null;

  // For WHILE
  statement?: INode;

  // For TYPED_CONST
  rawData?: IRawData;

  // For FIELD_DESIGNATOR
  field?: INode;

  // For ARRAY
  indices?: INode[];

  // For types
  typeCode?: TypeCode | number;
  typeName?: string;
  ranges?: INode[];
  elementType?: INode;
  parameters?: INode[];
  returnType?: INode;
  fields?: INode[];
  offset?: number;

  // Methods
  print?(): string;
  getNumber?(): number;
  getBoolean?(): boolean;
  getSimpleTypeCode?(): number;
  isSimpleType?(typeCode: number): boolean;
  getTypeSize?(): number;
  getTotalParameterSize?(): number;
  getRangeLowBound?(): number;
  getRangeHighBound?(): number;
  getRangeSize?(): number;
}

/**
 * Compiler class that generates bytecode from an AST
 */
export class Compiler {
  /**
   * Stack of lists of addresses of unconditional jumps (UJP) instructions
   * that should go to the end of the function/procedure in an Exit statement.
   * Each outer element represents a nested function/procedure we're compiling.
   * The inner list is an unordered list of addresses to update when we get to
   * the end of the function/procedure and know its last address.
   */
  private exitInstructions: number[][] = [];

  /**
   * Creates a new Compiler instance
   */
  constructor() {
    this.exitInstructions = [];
  }

  /**
   * Compile an AST to bytecode.
   * @param root - The root node of the AST (typically a PROGRAM node)
   * @returns The compiled Bytecode object
   */
  compile(root: INode): Bytecode {
    const bytecode = new Bytecode(root.symbolTable?.native ?? null);

    // Start at the root and recurse
    this.generateBytecode(bytecode, root, null);

    // Generate top-level calling code
    bytecode.setStartAddress();
    bytecode.add(
      Opcode.MST,
      0,
      0,
      'start of program -----------------'
    );
    bytecode.add(
      Opcode.CUP,
      0,
      root.symbol?.address ?? 0,
      'call main program'
    );
    bytecode.add(Opcode.STP, 0, 0, 'program end');

    return bytecode;
  }

  /**
   * Generate bytecode for a node and its children.
   * @param bytecode - The bytecode container
   * @param node - The AST node to compile
   * @param symbolTable - The current symbol table
   */
  private generateBytecode(
    bytecode: Bytecode,
    node: INode,
    symbolTable: ISymbolTable | null
  ): void {
    switch (node.nodeType) {
      case NodeType.IDENTIFIER:
        this.generateIdentifierBytecode(bytecode, node);
        break;

      case NodeType.NUMBER:
        this.generateNumberBytecode(bytecode, node);
        break;

      case NodeType.STRING:
        this.generateStringBytecode(bytecode, node);
        break;

      case NodeType.BOOLEAN:
        this.generateBooleanBytecode(bytecode, node);
        break;

      case NodeType.POINTER:
        this.generatePointerBytecode(bytecode);
        break;

      case NodeType.PROGRAM:
      case NodeType.PROCEDURE:
      case NodeType.FUNCTION:
        this.generateSubprogramBytecode(bytecode, node);
        break;

      case NodeType.USES:
      case NodeType.VAR:
      case NodeType.PARAMETER:
      case NodeType.CONST:
      case NodeType.ARRAY_TYPE:
      case NodeType.TYPE:
        // Nothing to generate for these declaration nodes
        break;

      case NodeType.BLOCK:
        this.generateBlockBytecode(bytecode, node, symbolTable);
        break;

      case NodeType.CAST:
        this.generateCastBytecode(bytecode, node, symbolTable);
        break;

      case NodeType.ASSIGNMENT:
        this.generateAssignmentBytecode(bytecode, node, symbolTable);
        break;

      case NodeType.PROCEDURE_CALL:
      case NodeType.FUNCTION_CALL:
        this.generateCallBytecode(bytecode, node, symbolTable);
        break;

      case NodeType.REPEAT:
        this.generateRepeatBytecode(bytecode, node, symbolTable);
        break;

      case NodeType.FOR:
        this.generateForBytecode(bytecode, node, symbolTable);
        break;

      case NodeType.IF:
        this.generateIfBytecode(bytecode, node, symbolTable);
        break;

      case NodeType.EXIT:
        this.generateExitBytecode(bytecode);
        break;

      case NodeType.WHILE:
        this.generateWhileBytecode(bytecode, node, symbolTable);
        break;

      case NodeType.TYPED_CONST:
        this.generateTypedConstBytecode(bytecode, node);
        break;

      case NodeType.NOT:
        this.generateNotBytecode(bytecode, node, symbolTable);
        break;

      case NodeType.NEGATIVE:
        this.generateNegativeBytecode(bytecode, node, symbolTable);
        break;

      case NodeType.ADDITION:
        this.generateNumericBinaryBytecode(
          bytecode,
          node,
          symbolTable,
          'add',
          Opcode.ADI,
          Opcode.ADR
        );
        break;

      case NodeType.SUBTRACTION:
        this.generateNumericBinaryBytecode(
          bytecode,
          node,
          symbolTable,
          'subtract',
          Opcode.SBI,
          Opcode.SBR
        );
        break;

      case NodeType.MULTIPLICATION:
        this.generateNumericBinaryBytecode(
          bytecode,
          node,
          symbolTable,
          'multiply',
          Opcode.MPI,
          Opcode.MPR
        );
        break;

      case NodeType.DIVISION:
        this.generateNumericBinaryBytecode(
          bytecode,
          node,
          symbolTable,
          'divide',
          null,
          Opcode.DVR
        );
        break;

      case NodeType.FIELD_DESIGNATOR:
        this.generateAddressBytecode(bytecode, node, symbolTable);
        bytecode.add(
          Opcode.LDI,
          node.expressionType?.getSimpleTypeCode?.() ?? 0,
          0,
          'load value of record field'
        );
        break;

      case NodeType.ARRAY:
        this.generateAddressBytecode(bytecode, node, symbolTable);
        bytecode.add(
          Opcode.LDI,
          node.expressionType?.getSimpleTypeCode?.() ?? 0,
          0,
          'load value of array element'
        );
        break;

      case NodeType.ADDRESS_OF:
        if (node.variable) {
          this.generateAddressBytecode(bytecode, node.variable, symbolTable);
        }
        break;

      case NodeType.DEREFERENCE:
        if (node.variable) {
          this.generateBytecode(bytecode, node.variable, symbolTable);
          bytecode.add(
            Opcode.LDI,
            node.expressionType?.getSimpleTypeCode?.() ?? 0,
            0,
            'load value pointed to by pointer'
          );
        }
        break;

      case NodeType.EQUALITY:
        this.generateComparisonBinaryBytecode(
          bytecode,
          node,
          symbolTable,
          'equals',
          Opcode.EQU
        );
        break;

      case NodeType.INEQUALITY:
        this.generateComparisonBinaryBytecode(
          bytecode,
          node,
          symbolTable,
          'not equals',
          Opcode.NEQ
        );
        break;

      case NodeType.LESS_THAN:
        this.generateComparisonBinaryBytecode(
          bytecode,
          node,
          symbolTable,
          'less than',
          Opcode.LES
        );
        break;

      case NodeType.GREATER_THAN:
        this.generateComparisonBinaryBytecode(
          bytecode,
          node,
          symbolTable,
          'greater than',
          Opcode.GRT
        );
        break;

      case NodeType.LESS_THAN_OR_EQUAL_TO:
        this.generateComparisonBinaryBytecode(
          bytecode,
          node,
          symbolTable,
          'less than or equal to',
          Opcode.LEQ
        );
        break;

      case NodeType.GREATER_THAN_OR_EQUAL_TO:
        this.generateComparisonBinaryBytecode(
          bytecode,
          node,
          symbolTable,
          'greater than or equal to',
          Opcode.GEQ
        );
        break;

      case NodeType.AND:
        this.generateComparisonBinaryBytecode(
          bytecode,
          node,
          symbolTable,
          'and',
          Opcode.AND
        );
        break;

      case NodeType.OR:
        this.generateComparisonBinaryBytecode(
          bytecode,
          node,
          symbolTable,
          'or',
          Opcode.IOR
        );
        break;

      case NodeType.INTEGER_DIVISION:
        this.generateNumericBinaryBytecode(
          bytecode,
          node,
          symbolTable,
          'divide',
          Opcode.DVI,
          null
        );
        break;

      case NodeType.MOD:
        this.generateNumericBinaryBytecode(
          bytecode,
          node,
          symbolTable,
          'mod',
          Opcode.MOD,
          null
        );
        break;

      default:
        throw new PascalError(`can't compile unknown node ${node.nodeType}`);
    }
  }

  /**
   * Generate bytecode for an identifier reference.
   */
  private generateIdentifierBytecode(bytecode: Bytecode, node: INode): void {
    const name = node.token?.value ?? 'unknown';
    const symbolLookup = node.symbolLookup;

    if (!symbolLookup) {
      throw new PascalError(`no symbol lookup for identifier ${name}`);
    }

    if (symbolLookup.symbol.byReference) {
      // Symbol is by reference. Must get its address first.
      bytecode.add(
        Opcode.LVA,
        symbolLookup.level,
        symbolLookup.symbol.address,
        `address of ${name}`
      );
      bytecode.add(
        Opcode.LDI,
        symbolLookup.symbol.type.typeCode ?? 0,
        0,
        `value of ${name}`
      );
    } else {
      // Load value directly is more efficient than address + load
      if (symbolLookup.symbol.type.nodeType === NodeType.SIMPLE_TYPE) {
        let opcode: Opcode;
        switch (symbolLookup.symbol.type.typeCode) {
          case TypeCode.A:
            opcode = Opcode.LVA;
            break;
          case TypeCode.B:
            opcode = Opcode.LVB;
            break;
          case TypeCode.C:
            opcode = Opcode.LVC;
            break;
          case TypeCode.I:
            opcode = Opcode.LVI;
            break;
          case TypeCode.R:
            opcode = Opcode.LVR;
            break;
          case TypeCode.S:
            // A string is not a character, but there's no opcode
            // for loading a string. Re-use LVC.
            opcode = Opcode.LVC;
            break;
          default:
            throw new PascalError(
              `can't make code to get ${symbolLookup.symbol.type.print?.() ?? 'type'}`,
              node.token?.lineNumber
            );
        }
        bytecode.add(
          opcode,
          symbolLookup.level,
          symbolLookup.symbol.address,
          `value of ${name}`
        );
      } else {
        // This is a more complex type, and apparently it's being
        // passed by value, so we push the entire thing onto the stack.
        const size = symbolLookup.symbol.type.getTypeSize?.() ?? 1;
        // For large parameters it would be more
        // space-efficient (but slower) to have a loop.
        for (let i = 0; i < size; i++) {
          bytecode.add(
            Opcode.LVI,
            symbolLookup.level,
            symbolLookup.symbol.address + i,
            `value of ${name} at index ${i}`
          );
        }
      }
    }
  }

  /**
   * Generate bytecode for a number literal.
   */
  private generateNumberBytecode(bytecode: Bytecode, node: INode): void {
    const v = node.getNumber?.() ?? parseFloat(node.token?.value ?? '0');
    const cindex = bytecode.addConstant(v);

    // See if we're an integer or real
    const typeCode = (v | 0) === v ? TypeCode.I : TypeCode.R;

    bytecode.add(Opcode.LDC, typeCode, cindex, `constant value ${v}`);
  }

  /**
   * Generate bytecode for a string literal.
   */
  private generateStringBytecode(bytecode: Bytecode, node: INode): void {
    const v = node.token?.value ?? '';
    const cindex = bytecode.addConstant(v);
    bytecode.add(Opcode.LDC, TypeCode.S, cindex, `string '${v}'`);
  }

  /**
   * Generate bytecode for a boolean literal.
   */
  private generateBooleanBytecode(bytecode: Bytecode, node: INode): void {
    const v = node.token?.value ?? 'false';
    const boolValue = node.getBoolean?.() ?? v.toLowerCase() === 'true';
    bytecode.add(Opcode.LDC, TypeCode.B, boolValue ? 1 : 0, `boolean ${v}`);
  }

  /**
   * Generate bytecode for a nil pointer.
   */
  private generatePointerBytecode(bytecode: Bytecode): void {
    const cindex = bytecode.addConstant(0);
    bytecode.add(Opcode.LDC, TypeCode.A, cindex, 'nil pointer');
  }

  /**
   * Generate bytecode for a program, procedure, or function.
   */
  private generateSubprogramBytecode(bytecode: Bytecode, node: INode): void {
    const isFunction = node.nodeType === NodeType.FUNCTION;
    const name = node.name?.token?.value ?? 'unknown';

    // Begin a new frame for exit statements
    this.beginExitFrame();

    // Generate each procedure and function in declarations
    if (node.declarations) {
      for (const declaration of node.declarations) {
        if (
          declaration.nodeType === NodeType.PROCEDURE ||
          declaration.nodeType === NodeType.FUNCTION
        ) {
          this.generateBytecode(bytecode, declaration, node.symbolTable ?? null);
        }
      }
    }

    // Generate code for entry to block
    if (node.symbol) {
      node.symbol.address = bytecode.getNextAddress();
    }

    const frameSize =
      MARK_SIZE +
      (node.symbolTable?.totalVariableSize ?? 0) +
      (node.symbolTable?.totalParameterSize ?? 0);

    bytecode.add(
      Opcode.ENT,
      0,
      frameSize,
      `start of ${name} -----------------`
    );

    // Generate code for typed constants
    if (node.declarations) {
      for (const declaration of node.declarations) {
        if (declaration.nodeType === NodeType.TYPED_CONST) {
          this.generateBytecode(bytecode, declaration, node.symbolTable ?? null);
        }
      }
    }

    // Generate code for block
    if (node.block) {
      this.generateBytecode(bytecode, node.block, node.symbolTable ?? null);
    }

    // End the frame for exit statements
    const ujpAddresses = this.endExitFrame();
    const rtnAddress = bytecode.getNextAddress();

    const returnTypeCode = isFunction
      ? node.expressionType?.returnType?.getSimpleTypeCode?.() ?? TypeCode.P
      : TypeCode.P;

    bytecode.add(Opcode.RTN, returnTypeCode, 0, `end of ${name}`);

    // Update all of the UJP statements to point to RTN
    for (const ujpAddress of ujpAddresses) {
      bytecode.setOperand2(ujpAddress, rtnAddress);
    }
  }

  /**
   * Generate bytecode for a block of statements.
   */
  private generateBlockBytecode(
    bytecode: Bytecode,
    node: INode,
    symbolTable: ISymbolTable | null
  ): void {
    if (node.statements) {
      for (const statement of node.statements) {
        this.generateBytecode(bytecode, statement, symbolTable);
      }
    }
  }

  /**
   * Generate bytecode for a type cast.
   */
  private generateCastBytecode(
    bytecode: Bytecode,
    node: INode,
    symbolTable: ISymbolTable | null
  ): void {
    if (node.expression) {
      this.generateBytecode(bytecode, node.expression, symbolTable);
    }

    const fromType = node.expression?.expressionType;
    const toType = node.type;

    if (
      fromType?.isSimpleType?.(TypeCode.I) &&
      toType?.isSimpleType?.(TypeCode.R)
    ) {
      bytecode.add(Opcode.FLT, 0, 0, 'cast to float');
    } else {
      throw new PascalError(
        `don't know how to compile a cast from ${fromType?.print?.() ?? 'unknown'} to ${toType?.print?.() ?? 'unknown'}`,
        node.token?.lineNumber
      );
    }
  }

  /**
   * Generate bytecode for an assignment statement.
   */
  private generateAssignmentBytecode(
    bytecode: Bytecode,
    node: INode,
    symbolTable: ISymbolTable | null
  ): void {
    // Push address of LHS onto stack
    if (node.lhs) {
      this.generateAddressBytecode(bytecode, node.lhs, symbolTable);
    }

    // Push RHS onto stack
    if (node.rhs) {
      this.generateBytecode(bytecode, node.rhs, symbolTable);
    }

    // We don't look at the type code when executing, but might as
    // well set it anyway.
    const storeTypeCode = node.rhs?.expressionType?.getSimpleTypeCode?.() ?? 0;

    bytecode.add(
      Opcode.STI,
      storeTypeCode,
      0,
      `store into ${node.lhs?.print?.() ?? 'lhs'}`
    );
  }

  /**
   * Generate bytecode for a procedure or function call.
   */
  private generateCallBytecode(
    bytecode: Bytecode,
    node: INode,
    symbolTable: ISymbolTable | null
  ): void {
    const isFunction = node.nodeType === NodeType.FUNCTION_CALL;
    const declType = isFunction ? 'function' : 'procedure';
    const symbolLookup = node.name?.symbolLookup;
    const symbol = symbolLookup?.symbol;

    if (!symbol) {
      throw new PascalError(`no symbol for ${declType} call`);
    }

    if (!symbol.isNative) {
      bytecode.add(
        Opcode.MST,
        symbolLookup!.level,
        0,
        `set up mark for ${declType}`
      );
    }

    // Push arguments
    if (node.argumentList) {
      for (const argument of node.argumentList) {
        const argNode = argument as INode & { byReference?: boolean };
        if (argNode.byReference) {
          this.generateAddressBytecode(bytecode, argument, symbolTable);
        } else {
          this.generateBytecode(bytecode, argument, symbolTable);
        }
      }
    }

    // See if this is a user procedure/function or native procedure/function
    if (symbol.isNative) {
      // The CSP index is stored in the address field
      const index = symbol.address;
      bytecode.add(
        Opcode.CSP,
        node.argumentList?.length ?? 0,
        index,
        `call system ${declType} ${symbol.name}`
      );
    } else {
      // Call procedure/function
      const parameterSize = symbol.type.getTotalParameterSize?.() ?? 0;
      bytecode.add(
        Opcode.CUP,
        parameterSize,
        symbol.address,
        `call ${node.name?.print?.() ?? symbol.name}`
      );
    }
  }

  /**
   * Generate bytecode for a repeat/until loop.
   */
  private generateRepeatBytecode(
    bytecode: Bytecode,
    node: INode,
    symbolTable: ISymbolTable | null
  ): void {
    const topOfLoop = bytecode.getNextAddress();
    bytecode.addComment(topOfLoop, 'top of repeat loop');

    if (node.block) {
      this.generateBytecode(bytecode, node.block, symbolTable);
    }

    if (node.expression) {
      this.generateBytecode(bytecode, node.expression, symbolTable);
    }

    bytecode.add(Opcode.FJP, 0, topOfLoop, 'jump to top of repeat');
  }

  /**
   * Generate bytecode for a for loop.
   */
  private generateForBytecode(
    bytecode: Bytecode,
    node: INode,
    symbolTable: ISymbolTable | null
  ): void {
    const varNode = node.variable;
    if (!varNode) return;

    // Assign start value
    this.generateAddressBytecode(bytecode, varNode, symbolTable);
    if (node.fromExpr) {
      this.generateBytecode(bytecode, node.fromExpr, symbolTable);
    }
    bytecode.add(Opcode.STI, 0, 0, `store into ${varNode.print?.() ?? 'var'}`);

    // Comparison
    const topOfLoop = bytecode.getNextAddress();
    this.generateBytecode(bytecode, varNode, symbolTable);
    if (node.toExpr) {
      this.generateBytecode(bytecode, node.toExpr, symbolTable);
    }
    bytecode.add(
      node.downto ? Opcode.LES : Opcode.GRT,
      TypeCode.I,
      0,
      "see if we're done with the loop"
    );
    const jumpInstruction = bytecode.getNextAddress();
    bytecode.add(Opcode.TJP, 0, 0, 'yes, jump to end');

    // Body
    if (node.body) {
      this.generateBytecode(bytecode, node.body, symbolTable);
    }

    // Increment/decrement variable
    this.generateAddressBytecode(bytecode, varNode, symbolTable);
    this.generateBytecode(bytecode, varNode, symbolTable);
    if (node.downto) {
      bytecode.add(Opcode.DEC, TypeCode.I, 0, 'decrement loop variable');
    } else {
      bytecode.add(Opcode.INC, TypeCode.I, 0, 'increment loop variable');
    }
    bytecode.add(Opcode.STI, 0, 0, `store into ${varNode.print?.() ?? 'var'}`);

    // Jump back to top
    bytecode.add(Opcode.UJP, 0, topOfLoop, 'jump to top of loop');

    const endOfLoop = bytecode.getNextAddress();

    // Fix up earlier jump
    bytecode.setOperand2(jumpInstruction, endOfLoop);
  }

  /**
   * Generate bytecode for an if statement.
   */
  private generateIfBytecode(
    bytecode: Bytecode,
    node: INode,
    symbolTable: ISymbolTable | null
  ): void {
    const hasElse = node.elseStatement !== null && node.elseStatement !== undefined;

    // Do comparison
    if (node.expression) {
      this.generateBytecode(bytecode, node.expression, symbolTable);
    }
    const skipThenInstruction = bytecode.getNextAddress();
    bytecode.add(
      Opcode.FJP,
      0,
      0,
      hasElse ? 'false, jump to else' : 'false, jump past body'
    );

    // Then block
    if (node.thenStatement) {
      this.generateBytecode(bytecode, node.thenStatement, symbolTable);
    }
    let skipElseInstruction = -1;
    if (hasElse) {
      skipElseInstruction = bytecode.getNextAddress();
      bytecode.add(Opcode.UJP, 0, 0, 'jump past else');
    }

    // Else block
    const falseAddress = bytecode.getNextAddress();
    if (hasElse && node.elseStatement) {
      this.generateBytecode(bytecode, node.elseStatement, symbolTable);
    }

    // Fix up earlier jumps
    bytecode.setOperand2(skipThenInstruction, falseAddress);
    if (hasElse && skipElseInstruction !== -1) {
      const endOfIf = bytecode.getNextAddress();
      bytecode.setOperand2(skipElseInstruction, endOfIf);
    }
  }

  /**
   * Generate bytecode for an exit statement.
   */
  private generateExitBytecode(bytecode: Bytecode): void {
    // Return from procedure or function. We don't yet have the address
    // of the last instruction in this function, so we keep track of these
    // in an array and deal with them at the end.
    const address = bytecode.getNextAddress();
    bytecode.add(Opcode.UJP, 0, 0, 'return from function/procedure');
    this.addExitInstruction(address);
  }

  /**
   * Generate bytecode for a while loop.
   */
  private generateWhileBytecode(
    bytecode: Bytecode,
    node: INode,
    symbolTable: ISymbolTable | null
  ): void {
    // Generate the expression test
    const topOfLoop = bytecode.getNextAddress();
    bytecode.addComment(topOfLoop, 'top of while loop');
    if (node.expression) {
      this.generateBytecode(bytecode, node.expression, symbolTable);
    }

    // Jump over the statement if the expression was false
    const jumpInstruction = bytecode.getNextAddress();
    bytecode.add(Opcode.FJP, 0, 0, 'if false, exit while loop');

    // Generate the statement
    if (node.statement) {
      this.generateBytecode(bytecode, node.statement, symbolTable);
    }
    bytecode.add(Opcode.UJP, 0, topOfLoop, 'jump to top of while loop');

    // Fix up earlier jump
    const endOfLoop = bytecode.getNextAddress();
    bytecode.setOperand2(jumpInstruction, endOfLoop);
  }

  /**
   * Generate bytecode for typed constants.
   */
  private generateTypedConstBytecode(bytecode: Bytecode, node: INode): void {
    // These are just initialized variables. Copy the values to their stack location.
    if (!node.rawData || !node.symbol) return;

    const constAddress = bytecode.addTypedConstants(node.rawData.data);

    for (let i = 0; i < node.rawData.length; i++) {
      const typeCode = node.rawData.simpleTypeCodes[i] ?? TypeCode.I;

      bytecode.add(
        Opcode.LDA,
        0,
        node.symbol.address + i,
        `address of ${node.name?.print?.() ?? 'const'} on stack (element ${i})`
      );
      // It's absurd to create this many constants, one for each
      // address in the const pool, but I don't see another
      // straightforward way to do it.
      const cindex = bytecode.addConstant(constAddress + i);
      bytecode.add(
        Opcode.LDC,
        TypeCode.A,
        cindex,
        `address of ${node.name?.print?.() ?? 'const'} in const area (element ${i})`
      );
      bytecode.add(Opcode.LDI, typeCode, 0, 'value of element');
      bytecode.add(Opcode.STI, typeCode, 0, 'write value');
    }
  }

  /**
   * Generate bytecode for logical NOT.
   */
  private generateNotBytecode(
    bytecode: Bytecode,
    node: INode,
    symbolTable: ISymbolTable | null
  ): void {
    if (node.expression) {
      this.generateBytecode(bytecode, node.expression, symbolTable);
    }
    bytecode.add(Opcode.NOT, 0, 0, 'logical not');
  }

  /**
   * Generate bytecode for unary minus.
   */
  private generateNegativeBytecode(
    bytecode: Bytecode,
    node: INode,
    symbolTable: ISymbolTable | null
  ): void {
    if (node.expression) {
      this.generateBytecode(bytecode, node.expression, symbolTable);
    }
    if (node.expression?.expressionType?.isSimpleType?.(TypeCode.R)) {
      bytecode.add(Opcode.NGR, 0, 0, 'real sign inversion');
    } else {
      bytecode.add(Opcode.NGI, 0, 0, 'integer sign inversion');
    }
  }

  /**
   * Generate bytecode for binary arithmetic operations.
   */
  private generateNumericBinaryBytecode(
    bytecode: Bytecode,
    node: INode,
    symbolTable: ISymbolTable | null,
    opName: string,
    integerOpcode: Opcode | null,
    realOpcode: Opcode | null
  ): void {
    if (node.lhs) {
      this.generateBytecode(bytecode, node.lhs, symbolTable);
    }
    if (node.rhs) {
      this.generateBytecode(bytecode, node.rhs, symbolTable);
    }

    if (node.expressionType?.nodeType === NodeType.SIMPLE_TYPE) {
      switch (node.expressionType.typeCode) {
        case TypeCode.I:
          if (integerOpcode === null) {
            throw new PascalError(
              `can't ${opName} integers`,
              node.token?.lineNumber
            );
          }
          bytecode.add(integerOpcode, 0, 0, `${opName} integers`);
          break;
        case TypeCode.R:
          if (realOpcode === null) {
            throw new PascalError(
              `can't ${opName} reals`,
              node.token?.lineNumber
            );
          }
          bytecode.add(realOpcode, 0, 0, `${opName} reals`);
          break;
        default:
          throw new PascalError(
            `can't ${opName} operands of type ${inst.typeCodeToName(node.expressionType.typeCode ?? 0)}`,
            node.token?.lineNumber
          );
      }
    } else {
      throw new PascalError(
        `can't ${opName} operands of type ${node.expressionType?.print?.() ?? 'unknown'}`,
        node.token?.lineNumber
      );
    }
  }

  /**
   * Generate bytecode for comparison operations.
   */
  private generateComparisonBinaryBytecode(
    bytecode: Bytecode,
    node: INode,
    symbolTable: ISymbolTable | null,
    opName: string,
    opcode: Opcode
  ): void {
    if (node.lhs) {
      this.generateBytecode(bytecode, node.lhs, symbolTable);
    }
    if (node.rhs) {
      this.generateBytecode(bytecode, node.rhs, symbolTable);
    }

    const opType = node.lhs?.expressionType;
    if (opType?.nodeType === NodeType.SIMPLE_TYPE) {
      bytecode.add(opcode, opType.typeCode ?? 0, 0, opName);
    } else {
      throw new PascalError(
        `can't do ${opName} operands of type ${opType?.print?.() ?? 'unknown'}`,
        node.token?.lineNumber
      );
    }
  }

  /**
   * Generate bytecode to push the address of a node onto the stack.
   */
  private generateAddressBytecode(
    bytecode: Bytecode,
    node: INode,
    symbolTable: ISymbolTable | null
  ): void {
    switch (node.nodeType) {
      case NodeType.IDENTIFIER: {
        const symbolLookup = node.symbolLookup;
        if (!symbolLookup) {
          throw new PascalError(
            `no symbol lookup for identifier`,
            node.token?.lineNumber
          );
        }

        let opcode: Opcode;
        if (symbolLookup.symbol.byReference) {
          // By reference, the address is all we need
          opcode = Opcode.LVA;
        } else {
          // Load its address
          opcode = Opcode.LDA;
        }
        bytecode.add(
          opcode,
          symbolLookup.level,
          symbolLookup.symbol.address,
          `address of ${node.print?.() ?? 'identifier'}`
        );
        break;
      }

      case NodeType.ARRAY: {
        const arrayType = node.variable?.expressionType;
        if (!arrayType || !node.indices) break;

        // We compute the strides of the nested arrays as we go
        const strides: number[] = [];

        // Start with the array's element size
        strides.push(arrayType.elementType?.getTypeSize?.() ?? 1);

        for (let i = 0; i < node.indices.length; i++) {
          // Generate value of index
          this.generateBytecode(bytecode, node.indices[i]!, symbolTable);

          // Subtract lower bound
          const low = arrayType.ranges?.[i]?.getRangeLowBound?.() ?? 0;
          const cindex = bytecode.addConstant(low);
          bytecode.add(Opcode.LDC, TypeCode.I, cindex, `lower bound ${low}`);
          bytecode.add(Opcode.SBI, 0, 0, 'subtract lower bound');

          // Add new stride
          const size = arrayType.ranges?.[i]?.getRangeSize?.() ?? 1;
          strides.push(strides[strides.length - 1]! * size);

          // This would be a good place to do a runtime bounds check
        }

        // Pop the last stride, we don't need it (represents size of entire array)
        strides.pop();

        // Look up address of array
        if (node.variable) {
          this.generateAddressBytecode(bytecode, node.variable, symbolTable);
        }

        for (let i = 0; i < node.indices.length; i++) {
          // Compute address of the slice or element
          const stride = strides.pop() ?? 1;
          bytecode.add(
            Opcode.IXA,
            0,
            stride,
            `address of array ${i === node.indices.length - 1 ? 'element' : 'slice'} (size ${stride})`
          );
        }
        break;
      }

      case NodeType.FIELD_DESIGNATOR: {
        // Look up address of record
        if (node.variable) {
          this.generateAddressBytecode(bytecode, node.variable, symbolTable);
        }

        // Add the offset of the field
        const offset = node.field?.offset ?? 0;
        const cindex = bytecode.addConstant(offset);
        bytecode.add(
          Opcode.LDC,
          TypeCode.I,
          cindex,
          `offset of field "${node.field?.name?.print?.() ?? 'field'}"`
        );
        bytecode.add(Opcode.ADI, 0, 0, 'add offset to record address');
        break;
      }

      case NodeType.DEREFERENCE:
        // Just push the value of the pointer
        if (node.variable) {
          this.generateBytecode(bytecode, node.variable, symbolTable);
        }
        break;

      default:
        throw new PascalError(
          `unknown LHS node ${node.print?.() ?? node.nodeType}`,
          node.token?.lineNumber
        );
    }
  }

  /**
   * Start a frame for tracking exit statements in a function/procedure.
   */
  private beginExitFrame(): void {
    this.exitInstructions.push([]);
  }

  /**
   * Add an address of an instruction to update once we know the end of the function.
   */
  private addExitInstruction(address: number): void {
    if (this.exitInstructions.length > 0) {
      this.exitInstructions[this.exitInstructions.length - 1]!.push(address);
    }
  }

  /**
   * End a frame for a function/procedure, returning a list of addresses of UJP
   * instructions to update.
   */
  private endExitFrame(): number[] {
    return this.exitInstructions.pop() ?? [];
  }
}

export default Compiler;
