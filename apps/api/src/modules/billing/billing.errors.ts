import { HttpException, HttpStatus } from "@nestjs/common";

export const GENERATION_LIMIT_EXCEEDED = {
  code: "GEN_LIMIT_EXCEEDED",
  message: "本月免费生成次数已用完",
  remaining: 0,
} as const;

export class GenerationLimitExceededException extends HttpException {
  constructor() {
    super(GENERATION_LIMIT_EXCEEDED, HttpStatus.TOO_MANY_REQUESTS);
  }
}
