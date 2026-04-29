import { redirect } from "next/navigation";

import { buildLocalePath } from "@/i18n/config";
import { getPreferredLocale } from "@/i18n/server";

export const dynamic = "force-dynamic";

const RegisterRedirectPage = async () => {
  const locale = await getPreferredLocale();
  redirect(buildLocalePath(locale, "/register"));
};

export default RegisterRedirectPage;
