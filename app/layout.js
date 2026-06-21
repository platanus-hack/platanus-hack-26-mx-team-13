import "./globals.css";

export const metadata = {
  title: "Facturín — Foto del ticket, tu factura automática",
  description: "Sube la foto de tu ticket y Facturín genera tu factura CFDI 4.0 automáticamente. Sin capturar nada a mano.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
