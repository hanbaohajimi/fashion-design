import type { User } from "@fashion/db";
import type { Request } from "express";

export interface AuthenticatedUser {
  readonly authUserId: string;
  readonly email: string;
  readonly userId: string;
}

export interface AuthenticatedRequest extends Request {
  auth: AuthenticatedUser;
}

export interface VerifiedIdentity {
  readonly authUserId: string;
  readonly avatar?: string;
  readonly email: string;
  readonly name?: string;
}

export interface AuthSession {
  readonly accessToken: string;
  readonly expiresAt: number | undefined;
  readonly refreshToken: string;
  readonly user: User;
}
