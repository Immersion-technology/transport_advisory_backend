import { Request } from 'express';

export interface AuthRequest extends Omit<Request, 'params' | 'query'> {
  user?: {
    id: string;
    email: string;
    role: string;
  };
  params: any;
  query: any;
}

export interface JwtPayload {
  id: string;
  email: string;
  role: string;
}

export interface PaginationQuery {
  page?: string;
  limit?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}
