export class MemoryNotFoundError extends Error {
  constructor(id: string) {
    super(`Memory not found: ${id}`);
    this.name = "MemoryNotFoundError";
  }
}

export class PathTraversalError extends Error {
  constructor(path: string) {
    super(`Path traversal attempt blocked: ${path}`);
    this.name = "PathTraversalError";
  }
}

/** Full-text search could not run a query: nothing was left after sanitising, or FTS5 rejected it. */
export class FullTextQueryError extends Error {
  constructor(query: string, reason: string) {
    super(`Full-text search could not run ${JSON.stringify(query)}: ${reason}`);
    this.name = "FullTextQueryError";
  }
}

export class InvalidMemoryTypeError extends Error {
  constructor(type: string) {
    super(`Invalid memory type: ${type}`);
    this.name = "InvalidMemoryTypeError";
  }
}
