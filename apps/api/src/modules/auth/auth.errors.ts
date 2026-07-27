export type AuthErrorCode =
  | "ACCOUNT_DELETED"
  | "AUTH_CONFIGURATION_ERROR"
  | "EMAIL_SEND_FAILED"
  | "INVALID_ORIGIN"
  | "INVALID_TOKEN"
  | "TOKEN_EXPIRED";

export class AuthFlowError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthFlowError";
  }
}
