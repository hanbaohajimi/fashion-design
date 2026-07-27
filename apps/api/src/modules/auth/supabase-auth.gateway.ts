import { Injectable } from "@nestjs/common";
import {
  createClient,
  type SupabaseClient,
  type User as SupabaseUser,
} from "@supabase/supabase-js";

import { AuthFlowError } from "./auth.errors";

interface SupabaseSessionResult {
  readonly accessToken: string;
  readonly expiresAt: number | undefined;
  readonly refreshToken: string;
  readonly user: SupabaseUser;
}

@Injectable()
export class SupabaseAuthGateway {
  private client?: SupabaseClient;

  async sendMagicLink(email: string, redirectTo: string): Promise<void> {
    const { error } = await this.getClient().auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo,
        shouldCreateUser: true,
      },
    });

    if (error) {
      throw new AuthFlowError(
        "EMAIL_SEND_FAILED",
        "登录邮件发送失败，请稍后重试。",
      );
    }
  }

  async verifyMagicLink(tokenHash: string): Promise<SupabaseSessionResult> {
    const { data, error } = await this.getClient().auth.verifyOtp({
      token_hash: tokenHash,
      type: "email",
    });

    if (error || !data.session || !data.user) {
      throw this.mapTokenError(error?.message);
    }

    return this.toSessionResult(data.session, data.user);
  }

  async refreshSession(refreshToken: string): Promise<SupabaseSessionResult> {
    const { data, error } = await this.getClient().auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session || !data.user) {
      throw this.mapTokenError(error?.message);
    }

    return this.toSessionResult(data.session, data.user);
  }

  async verifyAccessToken(accessToken: string): Promise<SupabaseUser> {
    const { data, error } = await this.getClient().auth.getClaims(accessToken);
    const claims = data?.claims;

    if (error || !claims?.sub || typeof claims.email !== "string") {
      throw this.mapTokenError(error?.message);
    }

    const metadata =
      typeof claims.user_metadata === "object" && claims.user_metadata
        ? claims.user_metadata
        : {};

    return {
      id: claims.sub,
      app_metadata: {},
      aud: typeof claims.aud === "string" ? claims.aud : "authenticated",
      created_at: "",
      email: claims.email,
      user_metadata: metadata,
    };
  }

  private getClient(): SupabaseClient {
    if (this.client) {
      return this.client;
    }

    const url = process.env.SUPABASE_URL;
    const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

    if (!url || !publishableKey) {
      throw new AuthFlowError(
        "AUTH_CONFIGURATION_ERROR",
        "Supabase Auth 未配置，请检查 SUPABASE_URL 和 SUPABASE_PUBLISHABLE_KEY。",
      );
    }

    this.client = createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });

    return this.client;
  }

  private mapTokenError(message?: string): AuthFlowError {
    const expired = message?.toLowerCase().includes("expired") ?? false;

    return new AuthFlowError(
      expired ? "TOKEN_EXPIRED" : "INVALID_TOKEN",
      expired ? "登录已过期，请重新登录。" : "登录凭证无效，请重新登录。",
    );
  }

  private toSessionResult(
    session: {
      access_token: string;
      expires_at?: number;
      refresh_token: string;
    },
    user: SupabaseUser,
  ): SupabaseSessionResult {
    return {
      accessToken: session.access_token,
      expiresAt: session.expires_at,
      refreshToken: session.refresh_token,
      user,
    };
  }
}
