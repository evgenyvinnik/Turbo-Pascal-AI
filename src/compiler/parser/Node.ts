/**
 * Node types for Pascal AST
 */
export enum NodeType {
  // Program structure
  PROGRAM = 'program',
  UNIT = 'unit',
  USES = 'uses',

  // Declarations
  CONST_DECLARATION = 'constDeclaration',
  TYPED_CONST_DECLARATION = 'typedConstDeclaration',
  VAR_DECLARATION = 'varDeclaration',
  TYPE_DECLARATION = 'typeDeclaration',
  LABEL_DECLARATION = 'labelDeclaration',
  PROCEDURE = 'procedure',
  FUNCTION = 'function',

  // Types
  IDENTIFIER = 'identifier',
  INTEGER_TYPE = 'integerType',
  REAL_TYPE = 'realType',
  BOOLEAN_TYPE = 'booleanType',
  CHAR_TYPE = 'charType',
  STRING_TYPE = 'stringType',
  ARRAY_TYPE = 'arrayType',
  RECORD_TYPE = 'recordType',
  OBJECT_TYPE = 'objectType',
  PROCEDURAL_TYPE = 'proceduralType',
  UNIT_INITIALIZATION = 'unitInitialization',
  SET_TYPE = 'setType',
  POINTER_TYPE = 'pointerType',
  SUBRANGE_TYPE = 'subrangeType',
  /** A parameter's `array of T`, which takes arrays of any bounds. */
  OPEN_ARRAY_TYPE = 'openArrayType',
  ENUM_TYPE = 'enumType',
  FILE_TYPE = 'fileType',

  // Statements
  BLOCK = 'block',
  ASSIGNMENT = 'assignment',
  CALL = 'call',
  IF_STATEMENT = 'ifStatement',
  CASE_STATEMENT = 'caseStatement',
  WHILE_STATEMENT = 'whileStatement',
  REPEAT_STATEMENT = 'repeatStatement',
  FOR_STATEMENT = 'forStatement',
  WITH_STATEMENT = 'withStatement',
  GOTO_STATEMENT = 'gotoStatement',
  LABELED_STATEMENT = 'labeledStatement',
  EXIT = 'exit',

  // Expressions
  BINARY_OP = 'binaryOp',
  UNARY_OP = 'unaryOp',
  NUMBER = 'number',
  STRING = 'string',
  BOOLEAN = 'boolean',
  NIL = 'nil',
  ARRAY_ACCESS = 'arrayAccess',
  FIELD_ACCESS = 'fieldAccess',
  POINTER_DEREF = 'pointerDeref',
  ADDRESS_OF = 'addressOf',
  SET_LITERAL = 'setLiteral',
  RANGE = 'range',
  /** A typed constant's array value: `(1, 2, 3)`. */
  ARRAY_CONSTANT = 'arrayConstant',
  /** A typed constant's record value: `(X: 1; Y: 2)`. */
  RECORD_CONSTANT = 'recordConstant',

  // Parameters
  PARAMETER = 'parameter',
  VAR_PARAMETER = 'varParameter',
  FORMATTED_ARGUMENT = 'formattedArgument',
}

/**
 * Base interface for all AST nodes
 */
export interface Node {
  /** The type of the node */
  type: NodeType;
  /** The line number where this node starts (1-based) */
  lineNumber?: number | undefined;
  /** Allow additional properties for specific node types */
  [key: string]: unknown;
}

/**
 * Program node representing an entire Pascal program
 */
export interface ProgramNode extends Node {
  type: NodeType.PROGRAM;
  name: string;
  uses?: string[] | undefined;
  block: BlockNode;
}

/**
 * Unit node representing a Pascal unit
 */
export interface UnitNode extends Node {
  type: NodeType.UNIT;
  name: string;
  interfaceSection: Node[];
  implementationSection: Node[];
  interfaceUses: string[];
  implementationUses: string[];
  initialization: BlockNode;
}

/**
 * Block node containing declarations and statements
 */
export interface BlockNode extends Node {
  type: NodeType.BLOCK;
  declarations: Node[];
  statements: Node[];
  endLineNumber?: number;
  beginLineNumber?: number;
}

/**
 * Constant declaration node
 */
export interface ConstDeclarationNode extends Node {
  type: NodeType.CONST_DECLARATION;
  name: string;
  value: Node;
}

/**
 * Typed constant declaration node: `name: type = value`, an initialized
 * variable with static storage
 */
export interface TypedConstDeclarationNode extends Node {
  type: NodeType.TYPED_CONST_DECLARATION;
  name: string;
  constType: Node;
  value: Node;
}

/** The elements of a typed constant array, in index order */
export interface ArrayConstantNode extends Node {
  type: NodeType.ARRAY_CONSTANT;
  elements: Node[];
}

/** The fields given in a typed constant record, in declaration order */
export interface RecordConstantNode extends Node {
  type: NodeType.RECORD_CONSTANT;
  fields: { name: string; value: Node }[];
}

/**
 * Variable declaration node
 */
export interface VarDeclarationNode extends Node {
  type: NodeType.VAR_DECLARATION;
  names: string[];
  varType: Node;
  /** `absolute V`: the variables share V's storage. */
  absolute?: string;
}

/**
 * Type declaration node
 */
export interface TypeDeclarationNode extends Node {
  type: NodeType.TYPE_DECLARATION;
  name: string;
  typeValue: Node;
}

/**
 * Procedure declaration node
 */
export interface ProcedureNode extends Node {
  type: NodeType.PROCEDURE;
  name: string;
  parameters: Node[];
  block?: BlockNode;
  isForward?: boolean;
}

/**
 * Function declaration node
 */
export interface FunctionNode extends Node {
  type: NodeType.FUNCTION;
  name: string;
  parameters: Node[];
  returnType?: Node;
  block?: BlockNode;
  isForward?: boolean;
}

/**
 * Identifier node
 */
export interface IdentifierNode extends Node {
  type: NodeType.IDENTIFIER;
  name: string;
}

/**
 * Array type node
 */
export interface ArrayTypeNode extends Node {
  type: NodeType.ARRAY_TYPE;
  indexTypes: Node[];
  elementType: Node;
}

/**
 * Record type node
 */
export interface RecordTypeNode extends Node {
  type: NodeType.RECORD_TYPE;
  fields: VarDeclarationNode[];
  /** `case [Tag:] T of ...`: fields that share storage, one case at a time. */
  variant?: VariantPart;
}

/** A record's variant part */
export interface VariantPart {
  lineNumber: number;
  /** The tag field, when the variant part names one. */
  tagName?: string;
  tagType: Node;
  cases: VariantCase[];
}

/** One case of a variant part: its labels and its own field list */
export interface VariantCase {
  labels: Node[];
  fields: VarDeclarationNode[];
  variant?: VariantPart;
}

/**
 * Set type node
 */
export interface SetTypeNode extends Node {
  type: NodeType.SET_TYPE;
  baseType: Node;
}

/**
 * Pointer type node
 */
export interface PointerTypeNode extends Node {
  type: NodeType.POINTER_TYPE;
  baseType: Node;
}

/**
 * Subrange type node
 */
export interface SubrangeTypeNode extends Node {
  type: NodeType.SUBRANGE_TYPE;
  low: Node;
  high: Node;
}

/**
 * Enumeration type node
 */
export interface EnumTypeNode extends Node {
  type: NodeType.ENUM_TYPE;
  values: string[];
}

/**
 * File type node
 */
export interface FileTypeNode extends Node {
  type: NodeType.FILE_TYPE;
  componentType?: Node;
}

/**
 * Assignment statement node
 */
export interface AssignmentNode extends Node {
  type: NodeType.ASSIGNMENT;
  target: Node;
  value: Node;
}

/**
 * Procedure/function call node
 */
export interface CallNode extends Node {
  type: NodeType.CALL;
  name: string;
  arguments: Node[];
  receiver?: Node | undefined;
  callee?: Node;
  inherited?: boolean;
}

/** A Write/WriteLn value with an optional real precision and a field width. */
export interface FormattedArgumentNode extends Node {
  type: NodeType.FORMATTED_ARGUMENT;
  value: Node;
  width: Node;
  precision?: Node;
}

/**
 * If statement node
 */
export interface IfStatementNode extends Node {
  type: NodeType.IF_STATEMENT;
  condition: Node;
  /** Null for an empty statement, as in `if c then ;`. */
  thenBranch: Node | null;
  elseBranch?: Node;
}

/**
 * Case statement node
 */
export interface CaseStatementNode extends Node {
  type: NodeType.CASE_STATEMENT;
  selector: Node;
  /** An arm's statement is null when empty, as in `1: ;`. */
  cases: { labels: Node[]; statement: Node | null }[];
  elseClause?: Node[];
}

/**
 * While statement node
 */
export interface WhileStatementNode extends Node {
  type: NodeType.WHILE_STATEMENT;
  condition: Node;
  /** Null for an empty statement, as in `while c do ;`. */
  body: Node | null;
}

/**
 * Repeat statement node
 */
export interface RepeatStatementNode extends Node {
  type: NodeType.REPEAT_STATEMENT;
  statements: Node[];
  condition: Node;
}

/**
 * For statement node
 */
export interface ForStatementNode extends Node {
  type: NodeType.FOR_STATEMENT;
  variable: string;
  start: Node;
  end: Node;
  direction: 'to' | 'downto';
  /** Null for an empty statement, as in `while c do ;`. */
  body: Node | null;
}

/**
 * With statement node
 */
export interface WithStatementNode extends Node {
  type: NodeType.WITH_STATEMENT;
  records: Node[];
  /** Null for an empty statement, as in `while c do ;`. */
  body: Node | null;
}

/**
 * Goto statement node
 */
export interface GotoStatementNode extends Node {
  type: NodeType.GOTO_STATEMENT;
  label: string;
}

/**
 * Binary operation node
 */
export interface BinaryOpNode extends Node {
  type: NodeType.BINARY_OP;
  operator: string;
  left: Node;
  right: Node;
}

/**
 * Unary operation node
 */
export interface UnaryOpNode extends Node {
  type: NodeType.UNARY_OP;
  operator: string;
  operand: Node;
}

/**
 * Number literal node
 */
export interface NumberNode extends Node {
  type: NodeType.NUMBER;
  value: number;
  isReal: boolean;
}

/**
 * String literal node
 */
export interface StringNode extends Node {
  type: NodeType.STRING;
  value: string;
}

/**
 * Boolean literal node
 */
export interface BooleanNode extends Node {
  type: NodeType.BOOLEAN;
  value: boolean;
}

/**
 * Nil literal node
 */
export interface NilNode extends Node {
  type: NodeType.NIL;
}

/**
 * Array access node
 */
export interface ArrayAccessNode extends Node {
  type: NodeType.ARRAY_ACCESS;
  array: Node;
  indices: Node[];
}

/**
 * Field access node
 */
export interface FieldAccessNode extends Node {
  type: NodeType.FIELD_ACCESS;
  record: Node;
  field: string;
}

/**
 * Pointer dereference node
 */
export interface PointerDerefNode extends Node {
  type: NodeType.POINTER_DEREF;
  pointer: Node;
}

/**
 * Address-of node
 */
export interface AddressOfNode extends Node {
  type: NodeType.ADDRESS_OF;
  operand: Node;
}

/**
 * Set literal node
 */
export interface SetLiteralNode extends Node {
  type: NodeType.SET_LITERAL;
  elements: Node[];
}

/**
 * Range node (used in subranges and sets)
 */
export interface RangeNode extends Node {
  type: NodeType.RANGE;
  low: Node;
  high: Node;
}

/**
 * Parameter node
 */
export interface ParameterNode extends Node {
  type: NodeType.PARAMETER;
  names: string[];
  /** Absent for an untyped `const` parameter. */
  paramType: Node | null;
  /** A `const` parameter, which the routine cannot change. */
  constant?: boolean;
}

/**
 * Var parameter node (pass by reference)
 */
export interface VarParameterNode extends Node {
  type: NodeType.VAR_PARAMETER;
  names: string[];
  /** Absent for an untyped `var` parameter. */
  paramType: Node | null;
}

/** An open array parameter's type: `array of T` */
export interface OpenArrayTypeNode extends Node {
  type: NodeType.OPEN_ARRAY_TYPE;
  elementType: Node;
}

/**
 * Creates a new AST node with the given type and properties
 * @param type - The node type
 * @param props - Additional properties for the node
 * @param lineNumber - The line number where this node starts
 * @returns A new Node object
 */
export function createNode(
  type: NodeType,
  props: Record<string, unknown> = {},
  lineNumber?: number
): Node {
  return { type, lineNumber, ...props };
}
