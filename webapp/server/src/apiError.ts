import type { Response } from "express";

export interface ApiError {
  error: string;
  code?: string;
  railId?: string;
  traceId?: string;
  /** Extra context for rails (execute/materialize/cancel). */
  details?: string;
  /** Whether the client may retry the request. */
  retryable?: boolean;
}

/** Standard error codes for rails API. */
export const RAIL_ERROR_CODES = {
  WORKSPACE_REQUIRED: "WORKSPACE_REQUIRED",
  RAIL_NOT_FOUND: "RAIL_NOT_FOUND",
  RAIL_READ_ERROR: "RAIL_READ_ERROR",
  RAIL_ID_REQUIRED: "RAIL_ID_REQUIRED",
  RAIL_INVALID_TRANSITION: "RAIL_INVALID_TRANSITION",
  RAIL_WRONG_ARCHETYPE: "RAIL_WRONG_ARCHETYPE",
  RAIL_NO_CODE_TASKS: "RAIL_NO_CODE_TASKS",
  RAIL_EXECUTION_LIMIT: "RAIL_EXECUTION_LIMIT",
  RAIL_EXECUTE_ERROR: "RAIL_EXECUTE_ERROR",
  RAIL_MATERIALIZE_ERROR: "RAIL_MATERIALIZE_ERROR",
  RAIL_SANDBOX_MISSING: "RAIL_SANDBOX_MISSING",
  RAIL_VERIFICATION_REQUIRED: "RAIL_VERIFICATION_REQUIRED",
  RAIL_WRONG_ARCHETYPE_GREENFIELD: "RAIL_WRONG_ARCHETYPE",
  RAIL_CANCEL_ERROR: "RAIL_CANCEL_ERROR",
  RAIL_ROLLBACK_ERROR: "RAIL_ROLLBACK_ERROR",
} as const;

type ApiErrorMeta =
  | string
  | {
      code?: string;
      railId?: string;
      traceId?: string;
      details?: string;
      retryable?: boolean;
    };

export function sendError(
  res: Response,
  status: number,
  error: string,
  meta?: ApiErrorMeta
): Response<ApiError> {
  const payload: ApiError = { error };
  if (typeof meta === "string" && meta) {
    payload.code = meta;
  } else if (meta && typeof meta === "object") {
    if (meta.code) payload.code = meta.code;
    if (meta.railId) payload.railId = meta.railId;
    if (meta.traceId) payload.traceId = meta.traceId;
    if (meta.details) payload.details = meta.details;
    if (meta.retryable !== undefined) payload.retryable = meta.retryable;
  }
  return res.status(status).json(payload);
}

