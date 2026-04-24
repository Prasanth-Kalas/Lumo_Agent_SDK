/**
 * Well-known error shape. Agents return these; the shell maps them to
 * user-facing copy.
 */
export class LumoAgentError extends Error {
    code;
    detail;
    trace_id;
    constructor(code, message, opts) {
        super(message);
        this.name = "LumoAgentError";
        this.code = code;
        this.detail = opts?.detail;
        this.trace_id = opts?.trace_id;
    }
    toJSON() {
        return {
            code: this.code,
            message: this.message,
            detail: this.detail,
            at: new Date().toISOString(),
            trace_id: this.trace_id,
        };
    }
}
/**
 * The shell's user-facing copy for each error code. Agents may override on a
 * per-tool basis but this is the sensible default.
 */
export const DEFAULT_USER_COPY = {
    invalid_input: "I got confused by the request — could you rephrase it?",
    missing_pii: "I need a bit more info from your profile before I can do this.",
    unsupported_region: "That service isn't available in your region yet.",
    confirmation_required: "Let me show you a summary first — please confirm before I proceed.",
    confirmation_mismatch: "Something changed since I showed you the summary — let me refresh it.",
    not_available: "That option isn't available right now.",
    price_changed: "The price changed while we were talking — want me to re-quote?",
    out_of_stock: "That item just sold out.",
    upstream_timeout: "Our partner took too long to respond — try again in a moment?",
    upstream_error: "Our partner hit an error — I'll retry shortly.",
    rate_limited: "I'm moving a little fast — give me a second and try again.",
    payment_failed: "The payment didn't go through. Want to try a different card?",
    payment_declined: "Your card was declined. Want to try a different card?",
    refund_failed: "The refund didn't go through — I'll flag this to our team.",
    connection_required: "You'll need to connect that app first. Open the Marketplace and hit Connect.",
    connection_refresh_failed: "Your connection to that app expired. Reconnect from the Marketplace and I'll pick it back up.",
    internal_error: "Something broke on my end. I've logged it — please try again.",
};
//# sourceMappingURL=errors.js.map