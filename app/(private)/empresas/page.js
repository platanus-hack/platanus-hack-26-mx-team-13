import { Toaster } from "react-hot-toast";
import { auth } from "@/libs/core/auth";
import connectMongoose from "@/libs/core/mongoose";
import Company from "@/models/Company";
import User from "@/models/User";
import EmpresasView from "@/components/empresas/EmpresasView";

// Reads the session and queries MongoDB — never prerender it.
export const dynamic = "force-dynamic";

// "Mis Empresas" — manage the user's constancias/empresas. Server-loads the active
// companies + the user's default so the list paints without a flash; EmpresasView
// then owns mutations (add / set-default / delete) and re-fetches.
export default async function EmpresasPage() {
  const session = await auth();

  let companies = [];
  let defaultCompanyId = null;
  try {
    await connectMongoose();
    const [docs, user] = await Promise.all([
      Company.find({ userId: session.user.id, isActive: { $ne: false } }).sort({
        createdAt: -1,
      }),
      User.findById(session.user.id).select("defaultCompanyId").lean(),
    ]);
    // Serialize through toJSON (id, ISO dates) so it crosses the server→client boundary.
    companies = docs.map((d) => JSON.parse(JSON.stringify(d)));
    defaultCompanyId = user?.defaultCompanyId ? String(user.defaultCompanyId) : null;
  } catch {
    // A load failure shouldn't break the page; the user can still add a constancia.
    companies = [];
    defaultCompanyId = null;
  }

  return (
    <>
      <EmpresasView
        initialCompanies={companies}
        initialDefaultId={defaultCompanyId}
      />
      <Toaster position="bottom-center" />
    </>
  );
}
