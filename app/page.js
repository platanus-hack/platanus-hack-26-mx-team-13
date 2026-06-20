import SignInButton from "@/components/SignInButton";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 font-sans">
      <main className="flex w-full max-w-xl flex-col items-center gap-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-black sm:text-5xl">
          Foto del ticket → tu factura, automática
        </h1>
        <p className="text-lg text-zinc-600">
          Sube la foto de tu ticket y Facturín genera tu factura por ti.
        </p>
        <SignInButton />
      </main>
    </div>
  );
}
