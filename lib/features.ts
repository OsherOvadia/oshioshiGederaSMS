/**
 * Runtime feature switches.
 *
 * Every function here reads `process.env` on each call rather than at module
 * load or, worse, inlining the value into a statically rendered page. That is
 * what keeps a single switch authoritative: the browser is told what mode it is
 * in by /api/signup/start at request time, so a cached page can never offer a
 * flow the server has stopped accepting.
 *
 * Note that Vercel injects environment variables into a deployment when it is
 * built, so changing one in the dashboard still needs a redeploy (Deployments →
 * ⋯ → Redeploy) before the running functions see it.
 */

/** Values that mean "off". Anything else (including a typo) means "on". */
const FALSY = new Set(["0", "false", "off", "no", "disabled", ""]);

function envFlag(name: string, whenUnset: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return whenUnset;
  return !FALSY.has(raw.trim().toLowerCase());
}

/**
 * Whether joining the club requires answering an SMS code.
 *
 * Defaults to **off** when unset, which is how the app behaved before phone
 * verification existed. That default is deliberate: the club's entire purpose
 * is collecting signups, and defaulting to "on" would mean a fresh deploy — or
 * one where the variable was forgotten — silently refuses every new member
 * whenever the SMS gateway is unreachable.
 *
 * Turning it on is therefore an explicit decision, made when the gateway is
 * known to be up. Set REQUIRE_PHONE_VERIFICATION=true to enable it.
 *
 * Note that one-membership-per-number is enforced regardless of this switch:
 * `customers.phone` is the primary key, and both /api/signup/start and
 * /api/submit reject a number that already belongs to an active member. What
 * this switch controls is only whether the person signing up must *prove* the
 * number is theirs.
 */
export function isPhoneVerificationRequired(): boolean {
  return envFlag("REQUIRE_PHONE_VERIFICATION", false);
}
