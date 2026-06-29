// resolveCompanyForTicket — pick which Company (empresa/constancia) invoices a
// ticket. A user can hold several constancias (their own, an employee's, multiple
// businesses); the right one is chosen by precedence:
//
//   1. ticket.companyId      — the empresa explicitly selected at upload time.
//   2. user.defaultCompanyId — the user's default empresa.
//   3. most-recently-created active Company for the user (legacy fallback, so
//      existing tickets uploaded before this feature still invoice).
//
// Every candidate is scoped to { userId, isActive: true } so a soft-deleted or
// cross-user company can never resolve. Returns a lean Company doc or null. The
// caller is responsible for connecting mongoose first (this only queries).

import Company from "@/models/Company";
import User from "@/models/User";

/**
 * @param {Object} args
 * @param {{ companyId?: any }|null} [args.ticket] - The ticket being invoiced.
 * @param {string} args.userId - Owner of the ticket (also keys the companies).
 * @param {{ defaultCompanyId?: any }|null} [args.user] - Pre-loaded user, to avoid a refetch.
 * @returns {Promise<Object|null>} A lean Company doc, or null when the user has none.
 */
export async function resolveCompanyForTicket({ ticket, userId, user } = {}) {
  // 1. Explicit per-ticket choice.
  if (ticket?.companyId) {
    const byTicket = await Company.findOne({
      _id: ticket.companyId,
      userId,
      isActive: true,
    }).lean();
    if (byTicket) return byTicket;
  }

  // 2. User default (load the user only if the caller didn't pass it).
  const u =
    user ?? (await User.findById(userId).select("defaultCompanyId").lean());
  if (u?.defaultCompanyId) {
    const byDefault = await Company.findOne({
      _id: u.defaultCompanyId,
      userId,
      isActive: true,
    }).lean();
    if (byDefault) return byDefault;
  }

  // 3. Legacy fallback: most-recently-created active company.
  return Company.findOne({ userId, isActive: true })
    .sort({ createdAt: -1 })
    .lean();
}

export default resolveCompanyForTicket;
