import SignInButton from "@/components/auth/SignInButton";

// Public login page: a split layout with a green brand panel on the left and
// the Google sign-in on the right. Unauthenticated users land here.
export const metadata = {
  title: "Iniciar sesión · Facturín",
};

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-1 font-sans">
      {/* Left: green brand / welcome panel (hidden on small screens). */}
      <aside className="hidden flex-1 flex-col justify-between bg-green-600 p-12 text-white lg:flex">
        <span className="text-2xl font-bold tracking-tight">Facturín</span>
        <div className="flex flex-col gap-4">
          <h1 className="text-4xl font-bold leading-tight">
            Foto del ticket → tu factura, automática
          </h1>
          <p className="max-w-md text-lg text-green-50">
            Sube la foto de tu ticket y Facturín genera tu CFDI por ti. Sin
            portales, sin esperas.
          </p>
        </div>
        <p className="text-sm text-green-100">
          © {new Date().getFullYear()} Facturín
        </p>
      </aside>

      {/* Right: sign-in panel. */}
      <main className="flex flex-1 flex-col items-center justify-center bg-white px-6 py-12">
        <div className="flex w-full max-w-sm flex-col items-center gap-8 text-center">
          {/* Brand visible on small screens where the green panel is hidden. */}
          <span className="text-2xl font-bold tracking-tight text-green-600 lg:hidden">
            Facturín
          </span>
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-bold tracking-tight text-black">
              Bienvenido
            </h2>
            <p className="text-zinc-600">
              Inicia sesión para empezar a facturar tus tickets.
            </p>
          </div>
          <SignInButton />
        </div>
      </main>
    </div>
  );
}
