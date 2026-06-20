import { handlers } from "@/libs/core/auth";

// NextAuth v5: the route handler re-exports GET/POST from `handlers`
// (NOT the v4 default export).
export const { GET, POST } = handlers;
