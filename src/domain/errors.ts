/** Application errors carry an HTTP status and a stable machine-readable code. */
export class AppError extends Error {
  constructor(
    public status: 400 | 401 | 402 | 403 | 404 | 409 | 413 | 422 | 500 | 503,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const Errors = {
  validation: (details: unknown) => new AppError(422, 'VALIDATION_FAILED', 'Request validation failed', details),
  unauthenticated: () => new AppError(401, 'UNAUTHENTICATED', 'Please log in to continue'),
  forbidden: (msg = 'You do not have permission to do this') => new AppError(403, 'FORBIDDEN', msg),
  notFound: (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`),
  locked: () => new AppError(403, 'CONTENT_LOCKED', 'Subscribe or buy this book to read it'),
  alreadyOwned: () => new AppError(409, 'ALREADY_OWNED', 'You already own this book'),
  alreadySubscribed: () => new AppError(409, 'ALREADY_SUBSCRIBED', 'You already have an active subscription'),
  notPurchasable: () => new AppError(409, 'NOT_PURCHASABLE', 'This book is not available for purchase'),
  paymentFailed: (reason: string) => new AppError(402, 'PAYMENT_FAILED', reason),
  paymentInProgress: () => new AppError(409, 'PAYMENT_IN_PROGRESS', 'A payment for this is already being processed'),
  keyReuse: () => new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request'),
  /** The price the customer was shown is not what it costs now (e.g. the offer ended mid-checkout). Nothing was charged. */
  priceChanged: (price: number) =>
    new AppError(409, 'PRICE_CHANGED', 'The price changed while you were checking out. Nothing was charged.', { price }),
  conflict: (msg: string) => new AppError(409, 'CONFLICT', msg),
  payloadTooLarge: (limit: string) => new AppError(413, 'PAYLOAD_TOO_LARGE', `The request is too large. The limit is ${limit}.`),
};
