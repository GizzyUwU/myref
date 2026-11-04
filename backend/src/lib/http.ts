export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function badRequest(message: string): never {
  throw new HttpError(400, message);
}

export function unauthorized(message = "Not signed in"): never {
  throw new HttpError(401, message);
}

export function forbidden(message = "Not allowed"): never {
  throw new HttpError(403, message);
}

export function notFound(message = "Not found"): never {
  throw new HttpError(404, message);
}
