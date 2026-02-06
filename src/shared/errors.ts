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

export class InvalidMemoryTypeError extends Error {
  constructor(type: string) {
    super(`Invalid memory type: ${type}`);
    this.name = "InvalidMemoryTypeError";
  }
}
