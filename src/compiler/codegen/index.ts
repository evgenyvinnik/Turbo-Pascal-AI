/**
 * Code generation module barrel export
 *
 * Exports the bytecode container and compiler for generating P-machine bytecode
 * from a Pascal AST.
 */

export { Bytecode, type INative } from './Bytecode';
export {
  Compiler,
  // NodeType intentionally not exported - use NodeType from parser module
  type INode,
} from './Compiler';
