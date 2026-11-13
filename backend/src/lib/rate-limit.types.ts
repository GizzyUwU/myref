export type Bucket = { count: number; resetAt: number };

export type RequestIPServer = {
  requestIP?: (request: Request) => { address: string } | null;
};
