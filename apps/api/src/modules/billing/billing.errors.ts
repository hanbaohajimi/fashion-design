import { HttpException, HttpStatus } from "@nestjs/common";

import { GENERATION_LIMIT_EXCEEDED } from "./billing.service";

export { GENERATION_LIMIT_EXCEEDED };

export class GenerationLimitExceededException extends HttpException {
  constructor() {
    super(GENERATION_LIMIT_EXCEEDED, HttpStatus.TOO_MANY_REQUESTS);
  }
}
