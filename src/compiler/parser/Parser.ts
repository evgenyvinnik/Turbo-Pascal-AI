/**
 * Recursive descent parser for Turbo Pascal
 * Parses token stream into Abstract Syntax Tree (AST)
 */

import { applyCompilerSwitches, DEFAULT_SWITCHES, type CompilerSwitches } from '../directives';
import { Lexer, Token } from '../lexer';
import { PascalError } from '../errors';
import { Node, NodeType, createNode, BlockNode, ProgramNode, UnitNode } from './Node';

export type ParserOptions = Partial<CompilerSwitches>;

/**
 * Parser class that implements a recursive descent parser for Pascal
 */
export class Parser {
  private switches: CompilerSwitches = { ...DEFAULT_SWITCHES };
  private interfaceDeclarations = false;
  private ioChecking = true;
  private overflowChecking = false;
  private lastCompoundEndLine = 1;
  private lastCompoundBeginLine = 1;
  /** The lexer providing tokens */
  private readonly lexer: Lexer;

  /** Current token being processed */
  private currentToken: Token;

  /**
   * Creates a new Parser
   * @param lexer - The lexer to read tokens from
   */
  constructor(lexer: Lexer, options: ParserOptions = {}) {
    this.switches = { ...DEFAULT_SWITCHES, ...options };
    this.ioChecking = options.ioChecking ?? true;
    this.overflowChecking = options.overflowChecking ?? false;
    this.lexer = lexer;
    this.currentToken = this.lexer.next();
    // Skip any initial comments
    this.skipComments();
  }

  private node(type: NodeType, props: Record<string, unknown> = {}, lineNumber?: number): Node {
    return createNode(type, { ...this.switches, ...props }, lineNumber);
  }

  /**
   * Parses the entire program
   * @returns The root AST node
   */
  parse(): ProgramNode {
    const program = this.parseProgram();
    if (!this.currentToken.isEof()) {
      throw new PascalError(
        `Unexpected token after program: '${this.currentToken.value}'`,
        this.lineNumber
      );
    }
    return program;
  }

  /** Parse a separately compiled unit; interface declarations are signatures. */
  parseUnit(): UnitNode {
    const line = this.lineNumber;
    this.expectReservedWord('unit');
    const name = this.expectIdentifier();
    this.expectSymbol(';');
    this.expectReservedWord('interface');
    const interfaceUses = this.isReservedWord('uses') ? this.parseUsesClause() : [];
    this.interfaceDeclarations = true;
    const interfaceSection = this.parseDeclarations();
    this.interfaceDeclarations = false;
    this.expectReservedWord('implementation');
    const implementationUses = this.isReservedWord('uses') ? this.parseUsesClause() : [];
    const implementationSection = this.parseDeclarations();
    const beginLineNumber = this.lineNumber;
    const statements = this.isReservedWord('begin') ? this.parseCompoundStatement() : [];
    if (!statements.length && this.isReservedWord('end')) this.advance();
    this.expectSymbol('.');
    if (!this.currentToken.isEof()) throw new PascalError('Unexpected token after unit', this.lineNumber);
    return { type: NodeType.UNIT, name, interfaceUses, implementationUses,
      interfaceSection, implementationSection, lineNumber: line,
      initialization: { type: NodeType.BLOCK, declarations: [], statements, beginLineNumber,
        endLineNumber: this.lastCompoundEndLine, lineNumber: beginLineNumber } };
  }

  /**
   * Gets the current line number
   */
  private get lineNumber(): number {
    return this.currentToken.lineNumber;
  }

  /**
   * Advances to the next non-comment token
   */
  private advance(): void {
    this.currentToken = this.lexer.next();
    this.skipComments();
  }

  /**
   * Skips comment tokens
   */
  private skipComments(): void {
    while (this.currentToken.isComment()) {
      applyCompilerSwitches(this.currentToken.value, this.switches);
      this.ioChecking = this.switches.ioChecking;
      this.overflowChecking = this.switches.overflowChecking;
      this.currentToken = this.lexer.next();
    }
  }

  /**
   * Checks if the current token matches a reserved word
   * @param word - The reserved word to check
   */
  private isReservedWord(word: string): boolean {
    return this.currentToken.isReservedWord(word);
  }

  /**
   * Checks if the current token matches a symbol
   * @param symbol - The symbol to check
   */
  private isSymbol(symbol: string): boolean {
    return this.currentToken.isSymbol(symbol);
  }

  /**
   * Expects a specific reserved word and advances
   * @param word - The expected reserved word
   * @throws PascalError if the expected word is not found
   */
  private expectReservedWord(word: string): void {
    if (!this.isReservedWord(word)) {
      throw new PascalError(
        this.currentToken.isEof() ? 'Unexpected end of file' : `Expected '${word}', found '${this.currentToken.value}'`,
        this.lineNumber
      );
    }
    this.advance();
  }

  /**
   * Expects a specific symbol and advances
   * @param symbol - The expected symbol
   * @throws PascalError if the expected symbol is not found
   */
  private expectSymbol(symbol: string): void {
    if (!this.isSymbol(symbol)) {
      throw new PascalError(
        this.currentToken.isEof() ? 'Unexpected end of file' : `Expected '${symbol}', found '${this.currentToken.value}'`,
        this.lineNumber
      );
    }
    this.advance();
  }

  /**
   * Expects an identifier and returns its value
   * @returns The identifier name
   * @throws PascalError if no identifier is found
   */
  private expectIdentifier(): string {
    if (!this.currentToken.isIdentifier()) {
      throw new PascalError(
        this.currentToken.isEof() ? 'Unexpected end of file' : `Expected identifier, found '${this.currentToken.value}'`,
        this.lineNumber
      );
    }
    const name = this.currentToken.value;
    this.advance();
    return name;
  }

  /**
   * Parses a Pascal program
   * program ::= ['program' identifier ['(' identifier-list ')'] ';'] block '.'
   * Turbo Pascal makes the heading optional; without one the name is empty.
   */
  private parseProgram(): ProgramNode {
    const line = this.lineNumber;

    let name = '';
    if (this.isReservedWord('program')) {
      this.advance();
      name = this.expectIdentifier();

      // Optional program parameters (e.g., program test(input, output);)
      if (this.isSymbol('(')) {
        this.advance();
        this.parseIdentifierList();
        this.expectSymbol(')');
      }

      this.expectSymbol(';');
    }

    // Optional uses clause
    let uses: string[] | undefined;
    if (this.isReservedWord('uses')) {
      uses = this.parseUsesClause();
    }

    const block = this.parseBlock();

    this.expectSymbol('.');

    return {
      type: NodeType.PROGRAM,
      name,
      uses,
      block,
      lineNumber: line,
    };
  }

  /**
   * Parses a uses clause
   * uses ::= 'uses' identifier-list ';'
   */
  private parseUsesClause(): string[] {
    this.expectReservedWord('uses');
    const units: string[] = [];

    units.push(this.expectIdentifier());
    while (this.isSymbol(',')) {
      this.advance();
      units.push(this.expectIdentifier());
    }

    this.expectSymbol(';');
    return units;
  }

  /**
   * Parses a block
   * block ::= declarations compound-statement
   */
  private parseBlock(): BlockNode {
    const line = this.lineNumber;
    const declarations = this.parseDeclarations();
    const statements = this.parseCompoundStatement();

    return {
      type: NodeType.BLOCK,
      declarations,
      statements,
      lineNumber: line,
      endLineNumber: this.lastCompoundEndLine,
      beginLineNumber: this.lastCompoundBeginLine,
    };
  }

  /**
   * Parses declarations section
   * declarations ::= [const-section] [type-section] [var-section] [proc-func-declarations]
   */
  private parseDeclarations(): Node[] {
    const declarations: Node[] = [];

    // Parse declaration sections in any order (Turbo Pascal allows this)
    for (;;) {
      if (this.isReservedWord('label')) {
        const line = this.lineNumber;
        this.advance();
        const labels: string[] = [];
        do {
          if (this.isSymbol(',')) this.advance();
          if (!this.currentToken.isIdentifier() && !this.currentToken.isNumber())
            throw new PascalError('Label expected', this.lineNumber);
          labels.push(this.currentToken.value);
          this.advance();
        } while (this.isSymbol(','));
        this.expectSymbol(';');
        declarations.push(this.node(NodeType.LABEL_DECLARATION, { labels }, line));
      } else if (this.isReservedWord('const')) {
        declarations.push(...this.parseConstSection());
      } else if (this.isReservedWord('type')) {
        declarations.push(...this.parseTypeSection());
      } else if (this.isReservedWord('var')) {
        declarations.push(...this.parseVarSection());
      } else if (this.isReservedWord('constructor') || this.isReservedWord('destructor')) {
        declarations.push(this.parseProcedureDeclaration());
      } else if (this.isReservedWord('procedure')) {
        declarations.push(this.parseProcedureDeclaration());
      } else if (this.isReservedWord('function')) {
        declarations.push(this.parseFunctionDeclaration());
      } else {
        break;
      }
    }

    return declarations;
  }

  /**
   * Parses constant declaration section
   * const-section ::= 'const' (const-declaration ';')+
   */
  private parseConstSection(): Node[] {
    this.expectReservedWord('const');
    const constants: Node[] = [];

    while (this.currentToken.isIdentifier()) {
      const line = this.lineNumber;
      const name = this.expectIdentifier();
      this.expectSymbol('=');
      const value = this.parseExpression();
      this.expectSymbol(';');

      constants.push(this.node(NodeType.CONST_DECLARATION, { name, value }, line));
    }

    return constants;
  }

  /**
   * Parses type declaration section
   * type-section ::= 'type' (type-declaration ';')+
   */
  private parseTypeSection(): Node[] {
    this.expectReservedWord('type');
    const types: Node[] = [];

    while (this.currentToken.isIdentifier()) {
      const line = this.lineNumber;
      const name = this.expectIdentifier();
      this.expectSymbol('=');
      const typeValue = this.parseType();
      this.expectSymbol(';');

      types.push(this.node(NodeType.TYPE_DECLARATION, { name, typeValue }, line));
    }

    return types;
  }

  /**
   * Parses variable declaration section
   * var-section ::= 'var' (var-declaration ';')+
   */
  private parseVarSection(): Node[] {
    this.expectReservedWord('var');
    const variables: Node[] = [];

    while (this.currentToken.isIdentifier()) {
      const line = this.lineNumber;
      const names = this.parseIdentifierList();
      this.expectSymbol(':');
      const varType = this.parseType();
      this.expectSymbol(';');

      variables.push(this.node(NodeType.VAR_DECLARATION, { names, varType }, line));
    }

    return variables;
  }

  /**
   * Parses a list of identifiers
   * identifier-list ::= identifier (',' identifier)*
   */
  private parseIdentifierList(): string[] {
    const names: string[] = [];
    names.push(this.expectIdentifier());

    while (this.isSymbol(',')) {
      this.advance();
      names.push(this.expectIdentifier());
    }

    return names;
  }

  /**
   * Parses a type specification
   */
  private parseType(): Node {
    const line = this.lineNumber;

    if (this.isReservedWord('procedure') || this.isReservedWord('function')) {
      const isFunction = this.isReservedWord('function'); this.advance();
      const parameters = this.isSymbol('(') ? this.parseParameterList() : [];
      let returnType: Node | undefined;
      if (isFunction) { this.expectSymbol(':'); returnType = this.parseType(); }
      return this.node(NodeType.PROCEDURAL_TYPE, { parameters, returnType }, line);
    }
    if (this.isReservedWord('packed')) {
      this.advance();
      return this.parseType();
    }

    // Simple type identifiers
    if (this.isReservedWord('integer') || this.currentToken.value.toLowerCase() === 'integer') {
      this.advance();
      return this.node(NodeType.INTEGER_TYPE, {}, line);
    }
    if (this.currentToken.value.toLowerCase() === 'real') {
      this.advance();
      return this.node(NodeType.REAL_TYPE, {}, line);
    }
    if (this.currentToken.value.toLowerCase() === 'boolean') {
      this.advance();
      return this.node(NodeType.BOOLEAN_TYPE, {}, line);
    }
    if (this.currentToken.value.toLowerCase() === 'char') {
      this.advance();
      return this.node(NodeType.CHAR_TYPE, {}, line);
    }

    // String type (may have length specifier)
    if (this.isReservedWord('string')) {
      const stringSwitches = { ...this.switches };
      this.advance();
      let length: number | undefined;
      if (this.isSymbol('[')) {
        this.advance();
        if (this.currentToken.isNumber()) {
          length = parseInt(this.currentToken.value, 10);
          this.advance();
        }
        this.expectSymbol(']');
      }
      return this.node(NodeType.STRING_TYPE, { length, ...stringSwitches }, line);
    }

    // Array type
    if (this.isReservedWord('array')) {
      return this.parseArrayType();
    }

    if (this.isReservedWord('object')) return this.parseObjectType();

    // Record type
    if (this.isReservedWord('record')) {
      return this.parseRecordType();
    }

    // Set type
    if (this.isReservedWord('set')) {
      return this.parseSetType();
    }

    // File type
    if (this.isReservedWord('file')) {
      return this.parseFileType();
    }

    // Pointer type
    if (this.isSymbol('^')) {
      this.advance();
      const baseType = this.parseType();
      return this.node(NodeType.POINTER_TYPE, { baseType }, line);
    }

    // Enumeration type
    if (this.isSymbol('(')) {
      return this.parseEnumType();
    }

    // Subrange or identifier type
    if (this.currentToken.isIdentifier()) {
      let name = this.expectIdentifier();
      if (this.isSymbol('.')) { this.advance(); name += '.' + this.expectIdentifier(); }

      // Check for subrange
      if (this.isSymbol('..')) {
        this.advance();
        const low = this.node(NodeType.IDENTIFIER, { name }, line);
        const high = this.parseSimpleExpression();
        return this.node(NodeType.SUBRANGE_TYPE, { low, high }, line);
      }

      return this.node(NodeType.IDENTIFIER, { name }, line);
    }

    // Ordinal subranges may start with a signed integer or character literal.
    if (
      this.currentToken.isNumber() ||
      this.currentToken.isString() ||
      this.isSymbol('-') ||
      this.isSymbol('+')
    ) {
      const low = this.parseSimpleExpression();
      this.expectSymbol('..');
      const high = this.parseSimpleExpression();
      return this.node(NodeType.SUBRANGE_TYPE, { low, high }, line);
    }

    throw new PascalError(`Expected type, found '${this.currentToken.value}'`, this.lineNumber);
  }

  /**
   * Parses an array type
   * array-type ::= 'array' '[' index-type (',' index-type)* ']' 'of' type
   */
  private parseArrayType(): Node {
    const line = this.lineNumber;
    this.expectReservedWord('array');
    this.expectSymbol('[');

    const indexTypes: Node[] = [];
    indexTypes.push(this.parseType());

    while (this.isSymbol(',')) {
      this.advance();
      indexTypes.push(this.parseType());
    }

    this.expectSymbol(']');
    this.expectReservedWord('of');
    const elementType = this.parseType();

    return this.node(NodeType.ARRAY_TYPE, { indexTypes, elementType }, line);
  }

  /**
   * Parses a record type
   * record-type ::= 'record' field-list 'end'
   */
  private parseRecordType(): Node {
    const line = this.lineNumber;
    this.expectReservedWord('record');

    const fields: Node[] = [];
    while (!this.isReservedWord('end')) {
      if (this.currentToken.isIdentifier()) {
        const fieldLine = this.lineNumber;
        const names = this.parseIdentifierList();
        this.expectSymbol(':');
        const varType = this.parseType();

        fields.push(this.node(NodeType.VAR_DECLARATION, { names, varType }, fieldLine));

        if (this.isSymbol(';')) {
          this.advance();
        }
      } else {
        break;
      }
    }

    this.expectReservedWord('end');
    return this.node(NodeType.RECORD_TYPE, { fields }, line);
  }

  /**
   * Parses a set type
   * set-type ::= 'set' 'of' type
   */
  private parseSetType(): Node {
    const line = this.lineNumber;
    this.expectReservedWord('set');
    this.expectReservedWord('of');
    const baseType = this.parseType();
    return this.node(NodeType.SET_TYPE, { baseType }, line);
  }

  /**
   * Parses a file type
   * file-type ::= 'file' ['of' type]
   */
  private parseFileType(): Node {
    const line = this.lineNumber;
    this.expectReservedWord('file');

    let componentType: Node | undefined;
    if (this.isReservedWord('of')) {
      this.advance();
      componentType = this.parseType();
    }

    return this.node(NodeType.FILE_TYPE, { componentType }, line);
  }

  /**
   * Parses an enumeration type
   * enum-type ::= '(' identifier (',' identifier)* ')'
   */
  private parseEnumType(): Node {
    const line = this.lineNumber;
    this.expectSymbol('(');

    const values = this.parseIdentifierList();

    this.expectSymbol(')');
    return this.node(NodeType.ENUM_TYPE, { values }, line);
  }

  /**
   * Parses a procedure declaration
   */
  private parseObjectType(): Node {
    const line = this.lineNumber;
    this.expectReservedWord('object');
    let ancestor: Node | undefined;
    if (this.isSymbol('(')) { this.advance(); ancestor = this.parseType(); this.expectSymbol(')'); }
    const fields: Node[] = [], methods: Node[] = [];
    let privateMember = false;
    while (!this.isReservedWord('end')) {
      if (['private', 'public'].includes(this.currentToken.value.toLowerCase())) {
        privateMember = this.currentToken.value.toLowerCase() === 'private'; this.advance(); continue;
      }
      if (['procedure', 'function', 'constructor', 'destructor'].some(word => this.isReservedWord(word))) {
        const old = this.interfaceDeclarations;
        this.interfaceDeclarations = true;
        const method = this.isReservedWord('function') ? this.parseFunctionDeclaration() : this.parseProcedureDeclaration();
        this.interfaceDeclarations = old;
        if (this.currentToken.value.toLowerCase() === 'virtual') {
          this.advance(); method.virtual = true;
          if (!this.isSymbol(';')) method.dynamicIndex = this.parseExpression();
          this.expectSymbol(';');
        }
        method.privateMember = privateMember;
        methods.push(method);
      } else {
        const fieldLine = this.lineNumber, names = this.parseIdentifierList();
        this.expectSymbol(':');
        const varType = this.parseType(); this.expectSymbol(';');
        fields.push(this.node(NodeType.VAR_DECLARATION, { names, varType, privateMember }, fieldLine));
      }
    }
    this.expectReservedWord('end');
    return this.node(NodeType.OBJECT_TYPE, { ancestor, fields, methods }, line);
  }

  private parseProcedureDeclaration(): Node { return this.parseRoutineDeclaration(false); }
  private parseFunctionDeclaration(): Node { return this.parseRoutineDeclaration(true); }

  private parseRoutineDeclaration(isFunction: boolean): Node {
    const line = this.lineNumber, routineKind = this.currentToken.value.toLowerCase();
    const headerFarCalls = this.switches.farCalls;
    this.advance();
    let name = this.expectIdentifier();
    if (this.isSymbol('.')) { this.advance(); name += '.' + this.expectIdentifier(); }
    const parameters = this.isSymbol('(') ? this.parseParameterList() : [];
    let returnType: Node | undefined;
    if (isFunction && this.isSymbol(':')) { this.advance(); returnType = this.parseType(); }
    this.expectSymbol(';');
    const type = isFunction ? NodeType.FUNCTION : NodeType.PROCEDURE;
    let farCalls = headerFarCalls || this.interfaceDeclarations;
    while (['far', 'near'].includes(this.currentToken.value.toLowerCase())) {
      farCalls = this.currentToken.value.toLowerCase() === 'far'; this.advance(); this.expectSymbol(';');
    }
    const props = { name, parameters, returnType, routineKind, farCalls };
    if (this.interfaceDeclarations) return this.node(type, { ...props, isForward: true }, line);
    if (this.isReservedWord('forward')) {
      this.advance(); this.expectSymbol(';');
      return this.node(type, { ...props, isForward: true }, line);
    }
    const block = this.parseBlock(); this.expectSymbol(';');
    return this.node(type, { ...props, block }, line);
  }

  /**
   * Parses a parameter list
   * parameter-list ::= '(' parameter-declaration (';' parameter-declaration)* ')'
   */
  private parseParameterList(): Node[] {
    this.expectSymbol('(');
    const parameters: Node[] = [];

    if (!this.isSymbol(')')) {
      parameters.push(...this.parseParameterDeclaration());

      while (this.isSymbol(';')) {
        this.advance();
        parameters.push(...this.parseParameterDeclaration());
      }
    }

    this.expectSymbol(')');
    return parameters;
  }

  /**
   * Parses a parameter declaration
   * parameter-declaration ::= ['var'] identifier-list ':' type
   */
  private parseParameterDeclaration(): Node[] {
    const line = this.lineNumber;
    const switches = { ...this.switches };
    const isVar = this.isReservedWord('var');
    if (isVar) {
      this.advance();
    }

    const names = this.parseIdentifierList();
    this.expectSymbol(':');
    const paramType = this.parseType();

    const nodeType = isVar ? NodeType.VAR_PARAMETER : NodeType.PARAMETER;
    return [this.node(nodeType, { names, paramType, ...switches }, line)];
  }

  /**
   * Parses a compound statement
   * compound-statement ::= 'begin' statement-list 'end'
   */
  private parseCompoundStatement(): Node[] {
    const beginLine = this.lineNumber;
    this.expectReservedWord('begin');
    const statements = this.parseStatementList();
    this.lastCompoundBeginLine = beginLine;
    this.lastCompoundEndLine = this.lineNumber;
    this.expectReservedWord('end');
    return statements;
  }

  /**
   * Parses a list of statements
   * statement-list ::= statement (';' statement)*
   */
  private parseStatementList(): Node[] {
    const statements: Node[] = [];

    // Handle empty statement list
    if (this.isReservedWord('end') || this.isReservedWord('until')) {
      return statements;
    }

    const stmt = this.parseStatement();
    if (stmt) {
      statements.push(stmt);
    }

    while (this.isSymbol(';')) {
      this.advance();
      if (this.isReservedWord('end') || this.isReservedWord('until')) {
        break;
      }
      const nextStmt = this.parseStatement();
      if (nextStmt) {
        statements.push(nextStmt);
      }
    }

    return statements;
  }

  /**
   * Parses a single statement
   */
  private parseStatement(): Node | null {
    const line = this.lineNumber;

    // Empty statement: nothing before a token that ends one. Turbo Pascal also
    // allows it before else, as in `if c then else S`.
    if (this.isSymbol(';') || this.isReservedWord('end') || this.isReservedWord('until') || this.isReservedWord('else')) {
      return null;
    }

    if (this.isReservedWord('goto')) {
      this.advance();
      if (!this.currentToken.isIdentifier() && !this.currentToken.isNumber())
        throw new PascalError('Label expected', this.lineNumber);
      const label = this.currentToken.value;
      this.advance();
      return this.node(NodeType.GOTO_STATEMENT, { label }, line);
    }
    if (this.currentToken.isNumber()) {
      const label = this.currentToken.value;
      this.advance();
      this.expectSymbol(':');
      return this.node(
        NodeType.LABELED_STATEMENT,
        { label, statement: this.parseStatement() },
        line
      );
    }

    // Compound statement
    if (this.isReservedWord('begin')) {
      const statements = this.parseCompoundStatement();
      return this.node(NodeType.BLOCK, { declarations: [], statements }, line);
    }

    // If statement
    if (this.isReservedWord('if')) {
      return this.parseIfStatement();
    }

    // Case statement
    if (this.isReservedWord('case')) {
      return this.parseCaseStatement();
    }

    // While statement
    if (this.isReservedWord('while')) {
      return this.parseWhileStatement();
    }

    // Repeat statement
    if (this.isReservedWord('repeat')) {
      return this.parseRepeatStatement();
    }

    // For statement
    if (this.isReservedWord('for')) {
      return this.parseForStatement();
    }

    // With statement
    if (this.isReservedWord('with')) {
      return this.parseWithStatement();
    }

    // Exit statement
    if (this.currentToken.value.toLowerCase() === 'exit') {
      this.advance();
      return this.node(NodeType.EXIT, {}, line);
    }

    if (this.isReservedWord('inherited')) {
      this.advance();
      const call = this.parseAssignmentOrCall();
      call.inherited = true;
      return call;
    }

    // Assignment or procedure call
    if (this.currentToken.isIdentifier()) {
      return this.parseAssignmentOrCall();
    }

    throw new PascalError(
      `Unexpected token in statement: '${this.currentToken.value}'`,
      this.lineNumber
    );
  }

  /**
   * Parses an if statement
   * if-statement ::= 'if' expression 'then' statement ['else' statement]
   */
  private parseIfStatement(): Node {
    const line = this.lineNumber;
    this.expectReservedWord('if');
    const condition = this.parseExpression();
    this.expectReservedWord('then');
    const thenBranch = this.parseStatement();

    let elseBranch: Node | undefined;
    if (this.isReservedWord('else')) {
      this.advance();
      elseBranch = this.parseStatement() ?? undefined;
    }

    return this.node(NodeType.IF_STATEMENT, { condition, thenBranch, elseBranch }, line);
  }

  /**
   * Parses a case statement
   * case-statement ::= 'case' expression 'of' case-list ['else' statement-list] 'end'
   */
  private parseCaseStatement(): Node {
    const line = this.lineNumber;
    this.expectReservedWord('case');
    const selector = this.parseExpression();
    this.expectReservedWord('of');

    const cases: { labels: Node[]; statement: Node }[] = [];

    while (!this.isReservedWord('end') && !this.isReservedWord('else')) {
      const labels: Node[] = [];
      labels.push(this.parseSetElement());

      while (this.isSymbol(',')) {
        this.advance();
        labels.push(this.parseSetElement());
      }

      this.expectSymbol(':');
      const statement = this.parseStatement();

      if (statement) {
        cases.push({ labels, statement });
      }

      if (this.isSymbol(';')) {
        this.advance();
      }
    }

    let elseClause: Node[] | undefined;
    if (this.isReservedWord('else')) {
      this.advance();
      elseClause = this.parseStatementList();
    }

    this.expectReservedWord('end');
    return this.node(NodeType.CASE_STATEMENT, { selector, cases, elseClause }, line);
  }

  /**
   * Parses a while statement
   * while-statement ::= 'while' expression 'do' statement
   */
  private parseWhileStatement(): Node {
    const line = this.lineNumber;
    this.expectReservedWord('while');
    const condition = this.parseExpression();
    this.expectReservedWord('do');
    const body = this.parseStatement();

    return this.node(NodeType.WHILE_STATEMENT, { condition, body }, line);
  }

  /**
   * Parses a repeat statement
   * repeat-statement ::= 'repeat' statement-list 'until' expression
   */
  private parseRepeatStatement(): Node {
    const line = this.lineNumber;
    this.expectReservedWord('repeat');
    const statements = this.parseStatementList();
    this.expectReservedWord('until');
    const condition = this.parseExpression();

    return this.node(NodeType.REPEAT_STATEMENT, { statements, condition }, line);
  }

  /**
   * Parses a for statement
   * for-statement ::= 'for' identifier ':=' expression ('to'|'downto') expression 'do' statement
   */
  private parseForStatement(): Node {
    const line = this.lineNumber;
    this.expectReservedWord('for');
    const variable = this.expectIdentifier();
    this.expectSymbol(':=');
    const start = this.parseExpression();

    let direction: 'to' | 'downto';
    if (this.isReservedWord('to')) {
      direction = 'to';
      this.advance();
    } else if (this.isReservedWord('downto')) {
      direction = 'downto';
      this.advance();
    } else {
      throw new PascalError(
        `Expected 'to' or 'downto', found '${this.currentToken.value}'`,
        this.lineNumber
      );
    }

    const end = this.parseExpression();
    this.expectReservedWord('do');
    const body = this.parseStatement();

    return this.node(NodeType.FOR_STATEMENT, { variable, start, end, direction, body }, line);
  }

  /**
   * Parses a with statement
   * with-statement ::= 'with' record-variable-list 'do' statement
   */
  private parseWithStatement(): Node {
    const line = this.lineNumber;
    this.expectReservedWord('with');

    const records: Node[] = [];
    records.push(this.parseVariable());

    while (this.isSymbol(',')) {
      this.advance();
      records.push(this.parseVariable());
    }

    this.expectReservedWord('do');
    const body = this.parseStatement();

    return this.node(NodeType.WITH_STATEMENT, { records, body }, line);
  }

  /**
   * Parses an assignment or procedure call
   */
  private parseAssignmentOrCall(): Node {
    const line = this.lineNumber;
    const switches = { ...this.switches };
    const target = this.parseVariable();

    if (target.type === NodeType.IDENTIFIER && this.isSymbol(':')) {
      this.advance();
      return this.node(
        NodeType.LABELED_STATEMENT,
        { label: target.name, statement: this.parseStatement() },
        line
      );
    }

    // Assignment
    if (this.isSymbol(':=')) {
      this.advance();
      const value = this.parseExpression();
      return this.node(NodeType.ASSIGNMENT, { target, value, ...switches }, line);
    }

    // If target is an identifier with arguments, it's already a call
    if (target.type === NodeType.CALL) {
      return target;
    }

    // Otherwise it's a procedure call without arguments
    if (target.type === NodeType.IDENTIFIER) {
      const identNode = target as unknown as { name: string };
      return this.node(
        NodeType.CALL,
        {
          name: identNode.name,
          arguments: [],
          ...switches,
          ioChecking: target.ioChecking,
          overflowChecking: target.overflowChecking,
        },
        line
      );
    }

    if (target.type === NodeType.FIELD_ACCESS) return this.node(NodeType.CALL, {
      name: target.field, receiver: target.record, arguments: [], ioChecking: this.ioChecking,
      overflowChecking: this.overflowChecking }, line);
    if ([NodeType.ARRAY_ACCESS, NodeType.POINTER_DEREF].includes(target.type)) return this.node(NodeType.CALL, {
      name: '$indirect', callee: target, arguments: [] }, line);
    return target;
  }

  /**
   * Parses a variable reference (may include array access, field access, etc.)
   */
  private parseVariable(): Node {
    const line = this.lineNumber;
    const switches = { ...this.switches };
    const ioChecking = this.ioChecking;
    const overflowChecking = this.overflowChecking;
    const name = this.expectIdentifier();

    let node: Node = this.node(NodeType.IDENTIFIER, { name, ...switches, ioChecking, overflowChecking }, line);

    // Check for function/procedure call
    if (this.isSymbol('(')) {
      this.advance();
      const args: Node[] = [];
      const allowFormatting = ['write', 'writeln', 'str'].includes(name.toLowerCase());

      if (!this.isSymbol(')')) {
        args.push(this.parseCallArgument(allowFormatting));
        while (this.isSymbol(',')) {
          this.advance();
          args.push(this.parseCallArgument(allowFormatting));
        }
      }

      this.expectSymbol(')');
      node = this.node(
        NodeType.CALL,
        { name, arguments: args, ...switches, ioChecking, overflowChecking },
        line
      );
    }

    // Handle array access, field access, pointer dereference
    for (;;) {
      if (this.isSymbol('[')) {
        this.advance();
        const indices: Node[] = [];
        indices.push(this.parseExpression());

        while (this.isSymbol(',')) {
          this.advance();
          indices.push(this.parseExpression());
        }

        this.expectSymbol(']');
        node = this.node(NodeType.ARRAY_ACCESS, { array: node, indices, ...switches }, line);
      } else if (this.isSymbol('.')) {
        this.advance();
        const field = this.expectIdentifier();
        node = this.node(NodeType.FIELD_ACCESS, { record: node, field, ...switches }, line);
      } else if (this.isSymbol('(')) {
        this.advance();
        const args: Node[] = [];
        if (!this.isSymbol(')')) {
          args.push(this.parseExpression());
          while (this.isSymbol(',')) { this.advance(); args.push(this.parseExpression()); }
        }
        this.expectSymbol(')');
        node = node.type === NodeType.FIELD_ACCESS
          ? this.node(NodeType.CALL, { name: node.field, receiver: node.record, arguments: args, ...switches, ioChecking, overflowChecking }, line)
          : this.node(NodeType.CALL, { name: '$indirect', callee: node, arguments: args, ...switches, ioChecking, overflowChecking }, line);
      } else if (this.isSymbol('^')) {
        this.advance();
        node = this.node(NodeType.POINTER_DEREF, { pointer: node }, line);
      } else {
        break;
      }
    }

    return node;
  }

  /** Write/WriteLn arguments can specify a field width and real precision. */
  private parseCallArgument(allowFormatting: boolean): Node {
    const line = this.lineNumber;
    const value = this.parseExpression();
    if (!allowFormatting || !this.isSymbol(':')) return value;
    this.advance();
    const width = this.parseExpression();
    let precision: Node | undefined;
    if (this.isSymbol(':')) {
      this.advance();
      precision = this.parseExpression();
    }
    return this.node(NodeType.FORMATTED_ARGUMENT, { value, width, precision }, line);
  }

  /**
   * Parses an expression
   * expression ::= simple-expression [relational-operator simple-expression]
   */
  private parseExpression(): Node {
    const line = this.lineNumber;
    let left = this.parseSimpleExpression();

    if (this.isRelationalOperator()) {
      const operator = this.currentToken.value.toLowerCase();
      const switches = { ...this.switches };
      const overflowChecking = this.overflowChecking;
      this.advance();
      const right = this.parseSimpleExpression();
      left = this.node(NodeType.BINARY_OP, { operator, left, right, ...switches, overflowChecking }, line);
    }

    return left;
  }

  /**
   * Checks if current token is a relational operator
   */
  private isRelationalOperator(): boolean {
    if (this.isReservedWord('in')) return true;
    return (
      this.isSymbol('=') ||
      this.isSymbol('<>') ||
      this.isSymbol('<') ||
      this.isSymbol('>') ||
      this.isSymbol('<=') ||
      this.isSymbol('>=')
    );
  }

  /**
   * Parses a simple expression
   * simple-expression ::= [sign] term (adding-operator term)*
   */
  private parseSimpleExpression(): Node {
    const line = this.lineNumber;

    // Handle unary sign
    let sign: string | null = null;
    const overflowChecking = this.overflowChecking;
    if (this.isSymbol('+') || this.isSymbol('-')) {
      sign = this.currentToken.value;
      this.advance();
    }

    let left = this.parseTerm();

    // Apply unary sign
    if (sign === '-') {
      left = this.node(
        NodeType.UNARY_OP,
        { operator: '-', operand: left, overflowChecking },
        line
      );
    }

    // Handle adding operators
    while (this.isAddingOperator()) {
      const operator = this.currentToken.value.toLowerCase();
      const switches = { ...this.switches };
      const overflowChecking = this.overflowChecking;
      this.advance();
      const right = this.parseTerm();
      left = this.node(NodeType.BINARY_OP, { operator, left, right, ...switches, overflowChecking }, line);
    }

    return left;
  }

  /**
   * Checks if current token is an adding operator
   */
  private isAddingOperator(): boolean {
    return (
      this.isSymbol('+') ||
      this.isSymbol('-') ||
      this.isReservedWord('or') ||
      this.isReservedWord('xor')
    );
  }

  /**
   * Parses a term
   * term ::= factor (multiplying-operator factor)*
   */
  private parseTerm(): Node {
    const line = this.lineNumber;
    let left = this.parseFactor();

    while (this.isMultiplyingOperator()) {
      const operator = this.currentToken.value.toLowerCase();
      const switches = { ...this.switches };
      const overflowChecking = this.overflowChecking;
      this.advance();
      const right = this.parseFactor();
      left = this.node(NodeType.BINARY_OP, { operator, left, right, ...switches, overflowChecking }, line);
    }

    return left;
  }

  /**
   * Checks if current token is a multiplying operator
   */
  private isMultiplyingOperator(): boolean {
    return (
      this.isSymbol('*') ||
      this.isSymbol('/') ||
      this.isReservedWord('div') ||
      this.isReservedWord('mod') ||
      this.isReservedWord('shl') ||
      this.isReservedWord('shr') ||
      this.isReservedWord('and')
    );
  }

  /**
   * Parses a factor
   * factor ::= variable | number | string | 'nil' | 'not' factor | '(' expression ')' | set-literal
   */
  private parseFactor(): Node {
    const line = this.lineNumber;

    if (this.isReservedWord('inherited')) {
      this.advance();
      const target = this.parseVariable();
      if (target.type === NodeType.CALL) { target.inherited = true; return target; }
      return this.node(NodeType.CALL, { name: target.name, arguments: [], inherited: true }, line);
    }
    if (this.isReservedWord('string')) return this.parseType();

    // Number literal
    if (this.currentToken.isNumber()) {
      const value = parseFloat(this.currentToken.value);
      const isReal =
        this.currentToken.value.includes('.') ||
        this.currentToken.value.toLowerCase().includes('e');
      this.advance();
      return this.node(NodeType.NUMBER, { value, isReal }, line);
    }

    // String literal
    if (this.currentToken.isString()) {
      let value = this.currentToken.value;
      this.advance();
      while (this.currentToken.isString()) {
        value += this.currentToken.value;
        this.advance();
      }
      return this.node(NodeType.STRING, { value }, line);
    }

    // Nil
    if (this.isReservedWord('nil')) {
      this.advance();
      return this.node(NodeType.NIL, {}, line);
    }

    // Boolean literals (true/false are typically identifiers in Pascal)
    if (this.currentToken.value.toLowerCase() === 'true') {
      this.advance();
      return this.node(NodeType.BOOLEAN, { value: true }, line);
    }
    if (this.currentToken.value.toLowerCase() === 'false') {
      this.advance();
      return this.node(NodeType.BOOLEAN, { value: false }, line);
    }

    // Not operator
    if (this.isReservedWord('not')) {
      const overflowChecking = this.overflowChecking;
      this.advance();
      const operand = this.parseFactor();
      return this.node(NodeType.UNARY_OP, { operator: 'not', operand, overflowChecking }, line);
    }

    // Address-of operator
    if (this.isSymbol('@')) {
      this.advance();
      const operand = this.parseVariable();
      return this.node(NodeType.ADDRESS_OF, { operand }, line);
    }

    // Parenthesized expression
    if (this.isSymbol('(')) {
      this.advance();
      const expr = this.parseExpression();
      this.expectSymbol(')');
      return expr;
    }

    // Set literal
    if (this.isSymbol('[')) {
      return this.parseSetLiteral();
    }

    // Variable or function call
    if (this.currentToken.isIdentifier()) {
      return this.parseVariable();
    }

    throw new PascalError(
      `Unexpected token in expression: '${this.currentToken.value}'`,
      this.lineNumber
    );
  }

  /**
   * Parses a set literal
   * set-literal ::= '[' [set-element (',' set-element)*] ']'
   */
  private parseSetLiteral(): Node {
    const line = this.lineNumber;
    this.expectSymbol('[');

    const elements: Node[] = [];

    if (!this.isSymbol(']')) {
      elements.push(this.parseSetElement());

      while (this.isSymbol(',')) {
        this.advance();
        elements.push(this.parseSetElement());
      }
    }

    this.expectSymbol(']');
    return this.node(NodeType.SET_LITERAL, { elements }, line);
  }

  /**
   * Parses a set element (may be a range)
   * set-element ::= expression ['..' expression]
   */
  private parseSetElement(): Node {
    const line = this.lineNumber;
    const low = this.parseExpression();

    if (this.isSymbol('..')) {
      this.advance();
      const high = this.parseExpression();
      return this.node(NodeType.RANGE, { low, high }, line);
    }

    return low;
  }
}
