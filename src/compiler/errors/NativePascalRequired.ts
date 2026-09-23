/** Assembly or machine code beyond what the P-machine runs: the program
 * goes to the native DOS compiler instead. */
export class NativePascalRequired extends Error {
  constructor(
    readonly filename: string,
    readonly reason = 'Inline assembly requires the native DOS compiler'
  ) {
    super(reason);
  }
}
