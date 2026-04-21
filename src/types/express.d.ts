declare namespace Express {
  interface Request {
    params: any;
    query: any;
    body: any;
    user?: { id: string; email: string; role: string };
  }
}

export {};
