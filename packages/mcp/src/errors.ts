/** A failure the tool reports to the client as a tool error (isError: true), in plain words. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}
