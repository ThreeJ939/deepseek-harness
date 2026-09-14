/**
 * Core identity types for the auth-middleware package.
 * @module @deepseek-ai/dsh-host-auth-middleware/types
 */
/**
 * Brand a string as a {@link UserId}.
 * @param id - the raw user id string (typically a JWT `sub` claim).
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function UserId(id) {
    return id;
}
//# sourceMappingURL=types.js.map