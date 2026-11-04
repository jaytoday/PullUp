import { Suspense } from "react";
import { LoginView } from "@/components/login/login-view";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <Suspense>
      <LoginView headline="CI that knows when to ask" />
    </Suspense>
  );
}
