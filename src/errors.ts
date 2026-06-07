// Domain error types. cli.ts catches AiPipeError and prints only message;
// any other error prints stack. Spec §10 (error classification) is a separate
// concern handled at runtime by the plugin's
// ${CLAUDE_PLUGIN_DIR}/scripts/validate/classify-error-recovery.sh.

export type AiPipeErrorCode =
  | "E_TARGET_EXISTS"
  | "E_TEMPLATE_MISSING"
  | "E_VERSION_PARSE"
  | "E_VERSION_FILE_MISSING"
  // E_NOT_IMPLEMENTED is currently producer-less (all 12 commands shipped in
  // DEV6) — kept as a reserved code for future stubs rather than churning the
  // union on every roadmap phase.
  | "E_NOT_IMPLEMENTED"
  | "E_BAD_USAGE"
  | "E_VALIDATION"
  | "E_EVAL";

export class AiPipeError extends Error {
  readonly code: AiPipeErrorCode;
  readonly exitCode: number;

  constructor(code: AiPipeErrorCode, message: string, exitCode = 1) {
    super(message);
    this.name = "AiPipeError";
    this.code = code;
    this.exitCode = exitCode;
  }
}
